/**
 * Phase 2.7 integration probe: full HTTP path through the auth proxy.
 *
 * Boots the Squire express app on a random port, uploads an image via the
 * service layer, then exercises GET /api/objects/:id/download for every
 * variant + the error cases. Asserts headers, mime, and byte sanity.
 *
 * Stages:
 *   1. Synth 2400x1800 PNG, createObject
 *   2. GET /download                              → image/png, original bytes
 *   3. GET /download?variant=display              → image/webp, smaller
 *   4. GET /download?variant=thumb                → image/webp, smallest
 *   5. GET /download?variant=bogus                → 400
 *   6. GET /download?disposition=inline           → Content-Disposition: inline
 *   7. Cleanup (DB row + 3 backend keys)
 *
 * Throwaway probe — safe to delete after Phase 2.
 */
import sharp from 'sharp';
import express from 'express';
import { createServer, type Server } from 'http';
import {
  createObject,
  deleteObject,
} from '../src/services/storage/objects.js';
import { backendFor } from '../src/services/storage/backends/index.js';
import { closePool } from '../src/db/pool.js';
import objectsRouter from '../src/api/routes/objects.js';

// Minimal app — just the objects router, isolated from Squire's full boot
// (mandrel client init, embeddings, scheduled jobs, etc.) so this probe
// runs fast and isn't sensitive to unrelated infra being up.
const app = express();
app.use(express.json());
app.use('/api/objects', objectsRouter);

interface VariantInfo {
  key: string;
  mime: string;
  width: number;
  height: number;
  bytes: number;
}

function assertEq<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) throw new Error(`${label}: expected ${String(expected)}, got ${String(actual)}`);
}

async function main() {
  console.log('[0] boot server on random port');
  const server: Server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  const base = `http://127.0.0.1:${port}`;
  console.log(`  listening on ${base}`);

  let objectId: string | undefined;
  let variants: Partial<Record<string, VariantInfo>> = {};
  let storageType = '';
  let storagePath = '';

  try {
    console.log('[1] synth + createObject');
    const png = await sharp({
      create: { width: 2400, height: 1800, channels: 3, background: { r: 50, g: 180, b: 90 } },
    }).png().toBuffer();
    const { object } = await createObject({
      name: 'route-probe',
      filename: `route-probe-${Date.now()}.png`,
      mimeType: 'image/png',
      data: png,
      source: 'upload',
    });
    objectId = object.id;
    storageType = object.storage_type;
    storagePath = object.storage_path;
    variants = (object.metadata as { variants?: Partial<Record<string, VariantInfo>> }).variants ?? {};
    console.log(`  id=${objectId} variants=${Object.keys(variants).join(',')}`);

    console.log('[2] GET /download (original)');
    {
      const r = await fetch(`${base}/api/objects/${objectId}/download`);
      assertEq(r.status, 200, '  status');
      assertEq(r.headers.get('content-type'), 'image/png', '  content-type');
      const bytes = Buffer.from(await r.arrayBuffer());
      assertEq(bytes.length, png.length, '  body length');
      assertEq(bytes.equals(png), true, '  bytes match');
      console.log(`  ok (${bytes.length} bytes, mime=image/png)`);
    }

    console.log('[3] GET /download?variant=display');
    {
      const r = await fetch(`${base}/api/objects/${objectId}/download?variant=display`);
      assertEq(r.status, 200, '  status');
      assertEq(r.headers.get('content-type'), 'image/webp', '  content-type');
      const bytes = Buffer.from(await r.arrayBuffer());
      if (bytes.length >= png.length) throw new Error(`display should be smaller than original; got ${bytes.length} vs ${png.length}`);
      const meta = await sharp(bytes).metadata();
      assertEq(meta.width, 1920, '  display width');
      assertEq(meta.height, 1440, '  display height');
      console.log(`  ok (${bytes.length} bytes, 1920x1440 webp)`);
    }

    console.log('[4] GET /download?variant=thumb');
    {
      const r = await fetch(`${base}/api/objects/${objectId}/download?variant=thumb`);
      assertEq(r.status, 200, '  status');
      assertEq(r.headers.get('content-type'), 'image/webp', '  content-type');
      const bytes = Buffer.from(await r.arrayBuffer());
      const meta = await sharp(bytes).metadata();
      assertEq(meta.width, 256, '  thumb width');
      assertEq(meta.height, 192, '  thumb height');
      console.log(`  ok (${bytes.length} bytes, 256x192 webp)`);
    }

    console.log('[5] GET /download?variant=bogus → 400');
    {
      const r = await fetch(`${base}/api/objects/${objectId}/download?variant=bogus`);
      assertEq(r.status, 400, '  status');
      console.log('  ok');
    }

    console.log('[6] GET /download?disposition=inline');
    {
      const r = await fetch(`${base}/api/objects/${objectId}/download?disposition=inline`);
      assertEq(r.status, 200, '  status');
      const cd = r.headers.get('content-disposition') ?? '';
      if (!cd.startsWith('inline;')) throw new Error(`disposition expected inline, got: ${cd}`);
      console.log(`  ok (${cd})`);
    }

    console.log('\nALL OK');
  } finally {
    if (objectId) {
      try { await deleteObject(objectId); } catch {}
      try { await backendFor(storageType).remove(storagePath); } catch {}
      for (const v of Object.values(variants) as VariantInfo[]) {
        try { await backendFor(storageType).remove(v.key); } catch {}
      }
    }
    server.close();
    await closePool();
  }
}

main().catch((e) => {
  console.error('FAIL:', e);
  process.exitCode = 1;
});
