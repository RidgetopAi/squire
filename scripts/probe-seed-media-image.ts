/**
 * Phase 4 manual-smoke helper: insert one chat-upload image + one extract image
 * so the /app/media page has data to render in local dev. Re-runnable; each
 * invocation appends new probe rows. Tagged 'phase4-seed' for easy cleanup.
 *
 * Usage:
 *   npx tsx scripts/probe-seed-media-image.ts        # add seed rows
 *   npx tsx scripts/probe-seed-media-image.ts clean  # soft-delete prior seeds
 */
import sharp from 'sharp';
import { createObject, listObjects, deleteObject } from '../src/services/storage/objects.js';
import { closePool } from '../src/db/pool.js';

const SEED_TAG = 'phase4-seed';

async function makePng(label: string, color: string): Promise<Buffer> {
  return sharp({
    create: {
      width: 800,
      height: 600,
      channels: 4,
      background: color,
    },
  })
    .composite([
      {
        input: Buffer.from(
          `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><text x="50%" y="50%" font-family="sans-serif" font-size="60" fill="white" text-anchor="middle" dominant-baseline="middle">${label}</text></svg>`
        ),
        gravity: 'center',
      },
    ])
    .png()
    .toBuffer();
}

async function clean() {
  const rows = await listObjects({ tag: SEED_TAG, limit: 100 });
  console.log(`cleaning ${rows.length} seed rows`);
  for (const r of rows) {
    await deleteObject(r.id);
  }
}

async function seed() {
  const stamp = Date.now();
  const fakeConversationId = `conv-seed-${stamp}`;

  const chatImg = await makePng('chat upload', '#1e40af');
  const chatRow = await createObject({
    name: `Seed chat image ${stamp}`,
    filename: `seed-chat-${stamp}.png`,
    mimeType: 'image/png',
    data: chatImg,
    source: 'upload',
    description: `Phase 4 seed chat image (conversation ${fakeConversationId})`,
    metadata: {
      attachmentType: 'chat_image',
      conversationId: fakeConversationId,
      probe: SEED_TAG,
    },
    tags: [SEED_TAG, 'chat-upload'],
  });
  console.log('chat image ->', chatRow.object.id);

  const pdfImg = await makePng('pdf extract', '#7c3aed');
  const pdfRow = await createObject({
    name: `Seed PDF image ${stamp}`,
    filename: `seed-pdf-${stamp}.png`,
    mimeType: 'image/png',
    data: pdfImg,
    source: 'extract',
    description: 'Phase 4 seed PDF-extracted image (page 1)',
    metadata: {
      probe: SEED_TAG,
      pdfPage: 1,
    },
    tags: [SEED_TAG],
  });
  console.log('pdf image  ->', pdfRow.object.id);

  const genImg = await makePng('generated', '#10b981');
  const genRow = await createObject({
    name: `Seed generated image ${stamp}`,
    filename: `seed-gen-${stamp}.png`,
    mimeType: 'image/png',
    data: genImg,
    source: 'generate',
    description: 'Phase 4 seed generated image',
    metadata: { probe: SEED_TAG, prompt: 'sample prompt' },
    tags: [SEED_TAG],
  });
  console.log('gen image  ->', genRow.object.id);
}

async function main() {
  if (process.argv[2] === 'clean') {
    await clean();
  } else {
    await seed();
  }
  await closePool();
}

main().catch(async (err) => {
  console.error(err);
  await closePool().catch(() => {});
  process.exit(1);
});
