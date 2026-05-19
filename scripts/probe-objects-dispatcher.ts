/**
 * Phase 2.3/2.4 probe: exercise the objects service end-to-end through the
 * new backend dispatcher.
 *
 * Stage trace:
 *   0. assert STORAGE_BACKEND env is honored
 *   1. createObject (~1KB text payload) → DB row + bytes in chosen backend
 *   2. getObjectById → row exists
 *   3. getObjectData → bytes round-trip
 *   4. deleteObject (soft-deletes the row; backend bytes left for later GC)
 *   5. getObjectData after delete → null
 *
 * Run twice to cover both backends:
 *   STORAGE_BACKEND=local npx tsx scripts/probe-objects-dispatcher.ts
 *   STORAGE_BACKEND=s3    npx tsx scripts/probe-objects-dispatcher.ts
 *
 * Throwaway probe — safe to delete after Phase 2.
 */
import {
  createObject,
  getObjectById,
  getObjectData,
  deleteObject,
} from '../src/services/storage/objects.js';
import { backendFor } from '../src/services/storage/backends/index.js';
import { closePool } from '../src/db/pool.js';

async function main() {
  const expected = (process.env['STORAGE_BACKEND'] ?? 'local').toLowerCase();
  console.log(`[0] STORAGE_BACKEND=${expected}`);

  const body = Buffer.from(`dispatcher probe ${new Date().toISOString()}\n`.repeat(20));
  const filename = `probe-${Date.now()}.txt`;

  console.log('[1] createObject');
  const { object, isDuplicate } = await createObject({
    name: 'probe',
    filename,
    mimeType: 'text/plain',
    data: body,
    source: 'upload',
    metadata: { probe: true },
  });
  console.log(`  id=${object.id} storage_type=${object.storage_type} storage_path=${object.storage_path} dup=${isDuplicate}`);

  if (object.storage_type !== expected) {
    throw new Error(`backend mismatch: expected ${expected}, got ${object.storage_type}`);
  }

  // Verify backend has the bytes (direct check, sidestepping objects.ts)
  const direct = await backendFor(object.storage_type).get(object.storage_path);
  console.log(`  backend-direct read: ${direct?.size} bytes, match=${direct?.body.equals(body)}`);

  console.log('[2] getObjectById');
  const row = await getObjectById(object.id);
  console.log(`  status=${row?.status} bytes=${row?.size_bytes}`);

  console.log('[3] getObjectData');
  const data = await getObjectData(object.id);
  console.log(`  ${data?.length} bytes, match=${data?.equals(body)}`);
  if (!data?.equals(body)) throw new Error('round-trip mismatch');

  console.log('[4] deleteObject (soft)');
  const deleted = await deleteObject(object.id);
  console.log(`  deleted=${deleted}`);

  console.log('[5] getObjectData after delete');
  const after = await getObjectData(object.id);
  console.log(`  ${after === null ? 'null (expected)' : 'FAIL: still readable'}`);
  if (after !== null) throw new Error('soft-delete did not block read');

  // Cleanup the backend bytes (probe hygiene; deleteObject does soft DB delete only).
  await backendFor(object.storage_type).remove(object.storage_path);
  console.log(`  cleaned up backend bytes`);

  console.log('\nALL OK');
}

main()
  .catch((e) => {
    console.error('FAIL:', e);
    process.exitCode = 1;
  })
  .finally(() => closePool());
