/**
 * Backfill script: evaluate all existing memories for expression safety.
 * Run with: npx tsx src/scripts/backfill-expression.ts
 */
import { evaluateUnevaluatedMemories, getExpressionStats } from '../services/expressionEvaluator.js';

async function backfill() {
  console.log('=== Expression Safety Backfill ===\n');

  const before = await getExpressionStats();
  console.log(`Before: ${before.unevaluated} unevaluated out of ${before.total} total\n`);

  let totalEvaluated = 0;
  let totalPassed = 0;
  let totalBlocked = 0;
  let round = 0;

  while (true) {
    round++;
    console.log(`--- Round ${round} ---`);
    const result = await evaluateUnevaluatedMemories();

    if (result.evaluated === 0) {
      console.log('No more memories to evaluate.\n');
      break;
    }

    totalEvaluated += result.evaluated;
    totalPassed += result.passed;
    totalBlocked += result.blocked;

    console.log(`  Evaluated: ${result.evaluated} (heuristic: ${result.heuristicPassed}p/${result.heuristicBlocked}b, model: ${result.modelEvaluated})`);
    console.log(`  Running total: ${totalEvaluated} evaluated, ${totalPassed} passed, ${totalBlocked} blocked\n`);
  }

  const after = await getExpressionStats();
  console.log('=== Final Stats ===');
  console.log(`Total: ${after.total}`);
  console.log(`Evaluated: ${after.evaluated}`);
  console.log(`Safe: ${after.safe}`);
  console.log(`Blocked: ${after.blocked}`);
  console.log(`Unevaluated: ${after.unevaluated}`);

  process.exit(0);
}

backfill().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
