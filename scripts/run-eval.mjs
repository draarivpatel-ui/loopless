import { runBenchmarkSuite } from '../js/benchmark.mjs';

const args = new Set(process.argv.slice(2));
const report = runBenchmarkSuite();

if (args.has('--json')) {
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  process.exit(0);
}

console.log(`LoopLess Route & Schedule Benchmark v${report.version}`);
console.log(`Scenarios: ${report.scenarioCount} synthetic day schedules (15 feasible by design, 1 intentional overload probe)`);
console.log(
  `Feasible: LoopLess ${report.feasibleCount}/${report.scenarioCount} | `
  + `FIFO ${report.baselinesFeasible.fifo}/${report.scenarioCount} | `
  + `EDF ${report.baselinesFeasible.edf}/${report.scenarioCount} | `
  + `Nearest ${report.baselinesFeasible.nearest}/${report.scenarioCount}`
);
console.log(
  `Total travel: LoopLess ${report.totals.optTravelMin} min vs FIFO ${report.totals.fifoTravelMin} min `
  + `(saved ${report.totals.travelSavedVsFifoMin} min, -${report.totals.travelReductionVsFifoPct}%)`
);
console.log(
  `Total clock span: LoopLess ${report.totals.optSpanMin} min vs FIFO ${report.totals.fifoSpanMin} min `
  + `(saved ${report.totals.spanSavedVsFifoMin} min, -${report.totals.spanReductionVsFifoPct}%)`
);
console.log(`Dominance: beats FIFO on ${report.strictlyBeatsFifo}/${report.scenarioCount}; beats/ties all baselines on ${report.strictlyBeatsOrTiesAll}/${report.scenarioCount}`);

if (args.has('--check')) {
  if (report.strictlyBeatsOrTiesAll !== report.scenarioCount) {
    console.error('FAIL: LoopLess failed to beat or tie all baseline heuristics on a benchmark case.');
    process.exit(1);
  }
  if (report.feasibleCount < 15) {
    console.error(`FAIL: Expected at least 15 feasible benchmark scenarios, got ${report.feasibleCount}`);
    process.exit(1);
  }
  const overloadRow = report.rows.find((r) => r.id === 'bench-14-overload-honesty');
  if (!overloadRow || overloadRow.feasible !== false) {
    console.error('FAIL: Intentional overload scenario must report infeasible honestly.');
    process.exit(1);
  }
  console.log('Check: all benchmark thresholds passed.');
}
