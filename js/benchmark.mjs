/**
 * Deterministic 16-case benchmark runner for LoopLess.
 * Browser-safe pure ES module (zero Node imports).
 */

import { solveOptimal, compareSchedules } from './planner.mjs';
import { BENCHMARK_CORPUS } from './scenarios.mjs';

export function runBenchmarkSuite(corpus = BENCHMARK_CORPUS) {
  const rows = [];
  let feasibleCount = 0;
  let fifoFeasible = 0;
  let edfFeasible = 0;
  let nearestFeasible = 0;
  let totalOptTravelMin = 0;
  let totalFifoTravelMin = 0;
  let totalEdfTravelMin = 0;
  let totalNearestTravelMin = 0;
  let totalOptSpanMin = 0;
  let totalFifoSpanMin = 0;
  let strictlyBeatsFifo = 0;
  let strictlyBeatsOrTiesAll = 0;

  for (const raw of corpus) {
    const res = solveOptimal(raw);
    const opt = res.optimal;
    const { fifo, edf, nearest } = res.baselines;

    if (opt.feasible) feasibleCount += 1;
    if (fifo.feasible) fifoFeasible += 1;
    if (edf.feasible) edfFeasible += 1;
    if (nearest.feasible) nearestFeasible += 1;

    totalOptTravelMin += opt.totalTravelMin;
    totalFifoTravelMin += fifo.totalTravelMin;
    totalEdfTravelMin += edf.totalTravelMin;
    totalNearestTravelMin += nearest.totalTravelMin;
    totalOptSpanMin += opt.totalSpanMin;
    totalFifoSpanMin += fifo.totalSpanMin;

    const cmpFifo = compareSchedules(opt, fifo);
    const cmpEdf = compareSchedules(opt, edf);
    const cmpNearest = compareSchedules(opt, nearest);
    if (cmpFifo < 0) strictlyBeatsFifo += 1;
    if (cmpFifo <= 0 && cmpEdf <= 0 && cmpNearest <= 0) strictlyBeatsOrTiesAll += 1;

    const travelSavedVsFifoMin = fifo.totalTravelMin - opt.totalTravelMin;
    const spanSavedVsFifoMin = fifo.totalSpanMin - opt.totalSpanMin;

    rows.push({
      id: raw.id,
      title: raw.title,
      stopCount: res.scenario.stops.length,
      mode: res.scenario.mode.id,
      method: res.method,
      feasible: opt.feasible,
      fifoFeasible: fifo.feasible,
      edfFeasible: edf.feasible,
      nearestFeasible: nearest.feasible,
      optTravelMin: opt.totalTravelMin,
      fifoTravelMin: fifo.totalTravelMin,
      edfTravelMin: edf.totalTravelMin,
      nearestTravelMin: nearest.totalTravelMin,
      optSpanMin: opt.totalSpanMin,
      fifoSpanMin: fifo.totalSpanMin,
      optMissed: opt.missedDeadlines,
      fifoMissed: fifo.missedDeadlines,
      optWaitMin: opt.totalWaitMin,
      minSlackMin: opt.minBufferSlackMin,
      travelSavedVsFifoMin,
      spanSavedVsFifoMin,
    });
  }

  const travelReductionVsFifoPct = totalFifoTravelMin > 0
    ? Number((((totalFifoTravelMin - totalOptTravelMin) / totalFifoTravelMin) * 100).toFixed(1))
    : 0;
  const spanReductionVsFifoPct = totalFifoSpanMin > 0
    ? Number((((totalFifoSpanMin - totalOptSpanMin) / totalFifoSpanMin) * 100).toFixed(1))
    : 0;

  return {
    version: '1.0.0',
    scenarioCount: corpus.length,
    feasibleCount,
    baselinesFeasible: {
      fifo: fifoFeasible,
      edf: edfFeasible,
      nearest: nearestFeasible,
    },
    totals: {
      optTravelMin: totalOptTravelMin,
      fifoTravelMin: totalFifoTravelMin,
      edfTravelMin: totalEdfTravelMin,
      nearestTravelMin: totalNearestTravelMin,
      optSpanMin: totalOptSpanMin,
      fifoSpanMin: totalFifoSpanMin,
      travelSavedVsFifoMin: totalFifoTravelMin - totalOptTravelMin,
      spanSavedVsFifoMin: totalFifoSpanMin - totalOptSpanMin,
      travelReductionVsFifoPct,
      spanReductionVsFifoPct,
    },
    strictlyBeatsFifo,
    strictlyBeatsOrTiesAll,
    guardrails: [
      'Coordinates, walking/cycling/bus/car speeds, and stop durations are synthetic model parameters, not live GPS or real-time traffic.',
      'Exact optimality (zero gap) is guaranteed by Branch-and-Bound for scenarios up to 12 stops; 13+ stops use deterministic 2-opt local search.',
    ],
    rows,
  };
}
