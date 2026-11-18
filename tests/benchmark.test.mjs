import test from 'node:test';
import assert from 'node:assert/strict';
import { runBenchmarkSuite } from '../js/benchmark.mjs';

test('16-case benchmark runs deterministically and outperforms naive baselines', () => {
  const r1 = runBenchmarkSuite();
  const r2 = runBenchmarkSuite();
  assert.deepEqual(r1, r2);
  assert.equal(r1.scenarioCount, 16);
  assert.equal(r1.feasibleCount, 15);
  assert.ok(r1.feasibleCount > r1.baselinesFeasible.fifo);
  assert.ok(r1.feasibleCount > r1.baselinesFeasible.nearest);
  assert.equal(r1.strictlyBeatsOrTiesAll, 16);
  assert.ok(r1.totals.travelSavedVsFifoMin > 400);
  assert.ok(r1.totals.spanSavedVsFifoMin > 400);
});
