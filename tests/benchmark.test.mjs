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
  assert.deepEqual(r1.searchCounts, { exact: 15, bounded: 0, heuristic: 1 });
  assert.deepEqual(r1.baselinesFeasible, { fifo: 10, edf: 15, nearest: 8 });
  assert.equal(r1.totals.optTravelMin, 1611);
  assert.equal(r1.totals.fifoTravelMin, 2242);
  assert.equal(r1.totals.travelSavedVsFifoMin, 631);
  assert.equal(r1.totals.travelReductionVsFifoPct, 28.1);
  assert.equal(r1.totals.optSpanMin, 3083);
  assert.equal(r1.totals.fifoSpanMin, 3850);
  assert.equal(r1.totals.spanSavedVsFifoMin, 767);
  assert.equal(r1.totals.spanReductionVsFifoPct, 19.9);
});
