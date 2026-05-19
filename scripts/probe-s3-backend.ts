/**
 * Phase 2.2 probe: exercise the new S3 backend module against the configured
 * S3 endpoint (local docker MinIO when run from laptop, VPS MinIO when run
 * on the VPS). Verifies put/get/exists/remove round-trip.
 *
 * Throwaway; safe to delete after Phase 2 ships.
 */
import { put, get, exists, remove } from '../src/services/storage/backends/s3.js';

async function main() {
  const key = '_probes/p2-backend-' + Date.now() + '.txt';
  const body = Buffer.from('hello s3 backend\n');

  console.log('[1] PUT', key);
  await put(key, body, 'text/plain');

  console.log('[2] EXISTS →', await exists(key));

  console.log('[3] GET');
  const got = await get(key);
  console.log('  bytes=' + got?.size, 'mime=' + got?.contentType, 'match=' + got?.body.equals(body));

  console.log('[4] DELETE');
  await remove(key);

  console.log('[5] EXISTS after delete →', await exists(key));
  console.log('[6] GET after delete →', await get(key));

  console.log('\nALL OK');
}

main().catch((e) => {
  console.error('FAIL:', e);
  process.exit(1);
});
