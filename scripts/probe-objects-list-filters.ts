/**
 * Phase 4.1/4.2 probe: exercise the new listObjects filters
 *   - source (upload | import | extract | generate)
 *   - dateFrom / dateTo (created_at range)
 *
 * Stages:
 *   0. Snapshot pre-existing counts so probe rows don't poison assertions
 *   1. Create 3 probe objects with distinct sources (upload / extract / generate)
 *   2. listObjects({source:'upload'}) returns row 1 but not 2/3
 *   3. listObjects({source:'extract'}) returns row 2 but not 1/3
 *   4. listObjects({source:'generate'}) returns row 3 but not 1/2
 *   5. listObjects({dateFrom:before, dateTo:after}) returns all 3 probe rows
 *   6. listObjects({dateFrom:future}) returns 0 probe rows
 *   7. listObjects({source:'upload', dateFrom:before, dateTo:after}) returns row 1 only
 *   8. Hard-delete probe rows (status=deleted soft delete is enough)
 *
 * Run:
 *   npx tsx scripts/probe-objects-list-filters.ts
 *
 * Re-runnable. Throwaway after Phase 4.
 */
import {
  createObject,
  deleteObject,
  listObjects,
} from '../src/services/storage/objects.js';
import { closePool } from '../src/db/pool.js';

const PROBE_TAG = 'phase4-probe';

async function main() {
  const before = new Date(Date.now() - 60_000); // 1 min ago
  const future = new Date(Date.now() + 60 * 60_000); // 1 hr ahead

  const stamp = Date.now();
  const probeRows: { id: string; source: string }[] = [];

  console.log('[1] createObject x3 (source: upload, extract, generate)');
  for (const source of ['upload', 'extract', 'generate'] as const) {
    const { object } = await createObject({
      name: `probe-${source}-${stamp}`,
      filename: `probe-${source}-${stamp}.txt`,
      mimeType: 'text/plain',
      data: Buffer.from(`probe payload ${source} ${stamp}`),
      source,
      metadata: { probe: PROBE_TAG, source },
      tags: [PROBE_TAG],
    });
    probeRows.push({ id: object.id, source });
    console.log(`    ${source} -> id=${object.id}`);
  }

  const after = new Date(Date.now() + 1_000); // 1 sec ahead

  let failures = 0;
  function assert(cond: boolean, label: string) {
    if (cond) {
      console.log(`  ✅ ${label}`);
    } else {
      console.error(`  ❌ ${label}`);
      failures++;
    }
  }

  for (const target of ['upload', 'extract', 'generate'] as const) {
    console.log(`\n[2.${target}] listObjects({source:'${target}', tag:${PROBE_TAG}})`);
    const rows = await listObjects({ source: target, tag: PROBE_TAG, limit: 100 });
    const ids = new Set(rows.map((r) => r.id));
    const expected = probeRows.find((r) => r.source === target)!.id;
    assert(ids.has(expected), `expected ${target} row present`);
    for (const other of probeRows.filter((r) => r.source !== target)) {
      assert(!ids.has(other.id), `${other.source} row excluded`);
    }
  }

  console.log('\n[3] listObjects({dateFrom:1min ago, dateTo:1sec ahead, tag:probe}) -> all 3');
  const rangeRows = await listObjects({
    dateFrom: before,
    dateTo: after,
    tag: PROBE_TAG,
    limit: 100,
  });
  const rangeIds = new Set(rangeRows.map((r) => r.id));
  for (const r of probeRows) {
    assert(rangeIds.has(r.id), `${r.source} included in date window`);
  }

  console.log('\n[4] listObjects({dateFrom:1hr ahead, tag:probe}) -> 0');
  const futureRows = await listObjects({
    dateFrom: future,
    tag: PROBE_TAG,
    limit: 100,
  });
  const futureIds = new Set(futureRows.map((r) => r.id));
  for (const r of probeRows) {
    assert(!futureIds.has(r.id), `${r.source} excluded from future window`);
  }

  console.log("\n[5] listObjects({source:'upload', dateFrom, dateTo, tag:probe}) -> row 1 only");
  const combo = await listObjects({
    source: 'upload',
    dateFrom: before,
    dateTo: after,
    tag: PROBE_TAG,
    limit: 100,
  });
  const comboIds = new Set(combo.map((r) => r.id));
  const uploadId = probeRows.find((r) => r.source === 'upload')!.id;
  assert(comboIds.has(uploadId), 'upload row present in combined filter');
  for (const r of probeRows.filter((r) => r.source !== 'upload')) {
    assert(!comboIds.has(r.id), `${r.source} excluded by source filter`);
  }

  console.log('\n[6] cleanup: soft-delete probe rows');
  for (const r of probeRows) {
    await deleteObject(r.id);
  }

  console.log(`\n${failures === 0 ? '✅ ALL PASS' : `❌ ${failures} FAILURES`}`);
  await closePool();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.error('probe crashed:', err);
  await closePool().catch(() => {});
  process.exit(2);
});
