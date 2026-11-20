import test from 'node:test';
import assert from 'node:assert/strict';
import { STUDIO_PRESETS } from '../js/presets.mjs';
import { solveOptimal, compareSchedules, normalizeScenario } from '../js/planner.mjs';
import { compareGreedyExact, diagnoseInfeasibleWindows } from '../js/planner.mjs';

test('greedy versus exact comparison reports nonnegative savings on the flagship day', () => {
  const result = compareGreedyExact(STUDIO_PRESETS[0]);
  assert.ok(['exact', 'exact-bnb'].includes(result.exactMethod));
  assert.ok(result.travelSavedMin >= 0);
  assert.ok(result.latenessSavedMin >= 0);
  assert.ok(result.spanSavedMin >= 0);
  assert.equal(result.latePenaltiesSaved, result.greedy.missedDeadlines - result.exact.missedDeadlines);
});

test('greedy versus exact comparison agrees with the independent nearest-neighbor baseline', () => {
  const tour = STUDIO_PRESETS[1];
  const result = compareGreedyExact(tour);
  const solver = solveOptimal(tour);
  assert.equal(result.greedy.totalTravelMin, solver.baselines.nearest.totalTravelMin);
  assert.equal(result.exact.totalTravelMin, solver.optimal.totalTravelMin);
});

test('infeasible window diagnosis detects a window shorter than service', () => {
  const tour = {
    id: 'short-window', title: 'Short window', mode: 'bike', metric: 'manhattan',
    startTime: '09:00', returnToAnchor: true, transitJitterMin: 0,
    anchor: { name: 'Base', x: 0, y: 0 },
    stops: [{ id: 'tight', name: 'Tight stop', x: 1, y: 0, durationMin: 30, windowStart: '09:00', windowEnd: '09:20', priority: 2 }],
  };
  const diagnosis = diagnoseInfeasibleWindows(tour);
  assert.equal(diagnosis.length, 1);
  assert.equal(diagnosis[0].stopId, 'tight');
  assert.match(diagnosis[0].reason, /window shorter/);
});

test('infeasible window diagnosis detects an unreachable closing time', () => {
  const tour = {
    id: 'unreachable', title: 'Unreachable', mode: 'walk', metric: 'manhattan',
    startTime: '09:00', returnToAnchor: true, transitJitterMin: 0,
    anchor: { name: 'Base', x: 0, y: 0 },
    stops: [{ id: 'far', name: 'Far stop', x: 9, y: 9, durationMin: 10, windowStart: '09:00', windowEnd: '09:15', priority: 2 }],
  };
  const diagnosis = diagnoseInfeasibleWindows(tour);
  assert.equal(diagnosis.length, 1);
  assert.equal(diagnosis[0].stopId, 'far');
});

test('a fully feasible day has no infeasible windows', () => {
  const diagnosis = diagnoseInfeasibleWindows(STUDIO_PRESETS[1]);
  assert.equal(diagnosis.length, 0);
});

test('budget guard labels a one-node search as bounded on every preset', () => {
  for (const preset of STUDIO_PRESETS) {
    const result = solveOptimal(preset, { nodeBudget: 1 });
    assert.equal(result.method, 'bounded-bnb');
    for (const baseline of Object.values(result.baselines)) {
      assert.ok(compareSchedules(result.optimal, baseline) <= 0);
    }
  }
});

test('tight deadline windows keep exact search feasible when a small margin remains', () => {
  const tour = {
    id: 'tight-margin', title: 'Tight margin', mode: 'bike', metric: 'manhattan',
    startTime: '09:00', returnToAnchor: true, transitJitterMin: 0,
    anchor: { name: 'Base', x: 0, y: 0 },
    stops: [
      { id: 'a', name: 'Errand A', x: 1, y: 0, durationMin: 10, windowStart: '09:00', windowEnd: '09:25', priority: 3 },
      { id: 'b', name: 'Errand B', x: 2, y: 0, durationMin: 10, windowStart: '09:00', windowEnd: '09:40', priority: 2, dependsOn: 'a' },
    ],
  };
  const result = solveOptimal(tour);
  assert.equal(result.method, 'exact-bnb');
  assert.equal(result.optimal.missedDeadlines, 0);
});

test('exact search remains deterministic across repeated runs', () => {
  const tour = STUDIO_PRESETS[2];
  const first = solveOptimal(tour).optimal.orderIds.join(',');
  const second = solveOptimal(tour).optimal.orderIds.join(',');
  assert.equal(first, second);
});
