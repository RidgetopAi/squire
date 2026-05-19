/**
 * Phase 2.5 probe: upload a real image, verify 3 variants exist in the backend
 * with the expected dimensions, then clean up.
 *
 * Stages:
 *   1. synthesize a 2400x1800 PNG (above both variant thresholds)
 *   2. createObject(image/png) → row + original + thumb + display in backend
 *   3. read metadata.variants + metadata.dimensions
 *   4. fetch each variant from the backend directly, decode with sharp,
 *      assert dimensions match what we recorded
 *   5. cleanup (soft-delete DB row, hard-delete backend keys)
 *
 * Defaults to STORAGE_BACKEND=s3 (the new path) but accepts any backend.
 */
import sharp from 'sharp';
import {
  createObject,
  deleteObject,
} from '../src/services/storage/objects.js';
import { backendFor } from '../src/services/storage/backends/index.js';
import { closePool } from '../src/db/pool.js';

interface VariantInfo {
  key: string;
  mime: string;
  width: number;
  height: number;
  bytes: number;
}

async function main() {
  const backend = (process.env['STORAGE_BACKEND'] ?? 's3').toLowerCase();
  console.log(`[0] STORAGE_BACKEND=${backend}`);

  console.log('[1] synthesize 2400x1800 PNG');
  const pngBuf = await sharp({
    create: {
      width: 2400,
      height: 1800,
      channels: 3,
      background: { r: 240, g: 120, b: 30 },
    },
  })
    .png()
    .toBuffer();
  console.log(`  ${pngBuf.length} bytes`);

  console.log('[2] createObject');
  const { object, isDuplicate } = await createObject({
    name: 'probe-image',
    filename: `probe-${Date.now()}.png`,
    mimeType: 'image/png',
    data: pngBuf,
    source: 'upload',
  });
  console.log(`  id=${object.id} storage_type=${object.storage_type} dup=${isDuplicate}`);
  console.log(`  storage_path=${object.storage_path}`);

  console.log('[3] inspect metadata');
  const variants = (object.metadata as { variants?: Record<string, VariantInfo> }).variants ?? {};
  const dims = (object.metadata as { dimensions?: { width: number; height: number } }).dimensions;
  console.log(`  dimensions=${dims?.width}x${dims?.height}`);
  console.log(`  variant keys: ${Object.keys(variants).join(', ') || '(none)'}`);
  for (const [name, v] of Object.entries(variants)) {
    console.log(`    ${name}: ${v.width}x${v.height} ${v.bytes}b @ ${v.key}`);
  }

  if (!variants.thumb || !variants.display) {
    throw new Error('expected thumb + display variants, missing one');
  }
  if (dims?.width !== 2400 || dims?.height !== 1800) {
    throw new Error(`dimensions mismatch: got ${dims?.width}x${dims?.height}`);
  }

  console.log('[4] read variants back from backend, decode, verify dims');
  for (const [name, v] of Object.entries(variants) as Array<[string, VariantInfo]>) {
    const fetched = await backendFor(object.storage_type).get(v.key);
    if (!fetched) throw new Error(`missing variant ${name} at ${v.key}`);
    const decoded = await sharp(fetched.body).metadata();
    console.log(`  ${name}: backend has ${fetched.size}b, decoded ${decoded.width}x${decoded.height}`);
    if (decoded.width !== v.width || decoded.height !== v.height) {
      throw new Error(`${name} dim mismatch: recorded ${v.width}x${v.height}, decoded ${decoded.width}x${decoded.height}`);
    }
  }

  console.log('[5] cleanup');
  await deleteObject(object.id);
  await backendFor(object.storage_type).remove(object.storage_path);
  for (const v of Object.values(variants) as VariantInfo[]) {
    await backendFor(object.storage_type).remove(v.key);
  }
  console.log('  cleaned');

  console.log('\nALL OK');
}

main()
  .catch((e) => {
    console.error('FAIL:', e);
    process.exitCode = 1;
  })
  .finally(() => closePool());
