import test from 'node:test';
import assert from 'node:assert/strict';
import { solveOptimal, compareSchedules, evaluateOrder, normalizeScenario, parseClockToMin } from '../js/planner.mjs';
import { STUDIO_PRESETS } from '../js/presets.mjs';
import { BENCHMARK_CORPUS } from '../js/scenarios.mjs';

// The oracle repeats the model math independently, without evaluateOrder or the solver's bounds.
const specs = { walk: [3.1, 1], bike: [11.5, 2], bus: [14, 6], car: [22, 4] };
const minutes = (clock) => { const [h, m] = clock.split(':').map(Number); return h * 60 + m; };
const hhmm = (value) => String(Math.floor(value / 60)).padStart(2, '0') + ':' + String(value % 60).padStart(2, '0');
function oracleScore(raw, order) {
  const [speed, overhead] = specs[raw.mode ?? 'bike'];
  const start = minutes(raw.startTime), jitter = raw.transitJitterMin ?? 0;
  let clock = start, previous = raw.anchor ?? { x: 0, y: 0 };
  let travelSum = 0, missed = 0, lateSum = 0, slack = Infinity;
  function travel(a, b) {
    const dx = Math.abs(a.x - b.x), dy = Math.abs(a.y - b.y);
    const distance = raw.metric === 'euclidean' ? Math.sqrt(dx * dx + dy * dy) : dx + dy;
    return distance === 0 ? 0 : Math.max(1, Math.round(distance / speed * 60 + overhead)) + jitter;
  }
  for (const stop of order) {
    const legTravel = travel(previous, stop); travelSum += legTravel;
    clock = Math.max(clock + legTravel, minutes(stop.windowStart)) + stop.durationMin;
    const margin = minutes(stop.windowEnd) - clock;
    if (margin < 0) { missed += 1; lateSum -= margin; }
    slack = Math.min(slack, margin); previous = stop;
  }
  if (raw.returnToAnchor !== false && order.length) { const homeTravel = travel(previous, raw.anchor ?? { x: 0, y: 0 }); clock += homeTravel; travelSum += homeTravel; }
  return { prerequisiteViolations: 0, missedDeadlines: missed, totalLatenessMin: lateSum, totalSpanMin: clock - start, totalTravelMin: travelSum, minBufferSlackMin: Number.isFinite(slack) ? slack : 0 };
}
function independentBruteForce(raw) {
  let best = null;
  const visited = new Set(), order = [];
  function search() {
    if (order.length === raw.stops.length) {
      const score = oracleScore(raw, order);
      if (!best || compareSchedules(score, best) < 0) best = score;
      return;
    }
    for (const stop of raw.stops) {
      if (visited.has(stop.id) || (stop.dependsOn && !visited.has(stop.dependsOn))) continue;
      visited.add(stop.id); order.push(stop); search(); order.pop(); visited.delete(stop.id);
    }
  }
  search(); return best;
}
function seededDay(seed) {
  let word = seed >>> 0;
  const random = () => { word = (Math.imul(word, 1664525) + 1013904223) >>> 0; return word / 4294967296; };
  const n = 1 + seed % 7, start = 540;
  const stops = Array.from({ length: n }, (_, index) => {
    const opens = start + Math.floor(random() * 120);
    return { id: 's' + index, name: 'Oracle errand ' + index, x: Math.round((random() * 6 - 3) * 10) / 10, y: Math.round((random() * 6 - 3) * 10) / 10, durationMin: 1 + Math.floor(random() * 40), windowStart: hhmm(opens), windowEnd: hhmm(opens + 15 + Math.floor(random() * 150)), priority: 1 + index % 3, dependsOn: index > 0 && random() < .35 ? 's' + (index - 1) : null };
  });
  if (seed % 5 === 0 && n > 1) { stops[1].x = stops[0].x; stops[1].y = stops[0].y; }
  return { id: 'oracle-' + seed, title: 'Seeded synthetic day', mode: Object.keys(specs)[seed % 4], metric: seed % 2 ? 'euclidean' : 'manhattan', startTime: hhmm(start), transitJitterMin: seed % 16, anchor: { x: 0, y: 0 }, returnToAnchor: seed % 3 !== 0, stops: seed % 2 ? stops.reverse() : stops };
}
test('all 13 small benchmark tours match the independent brute-force model', () => {
  const small = BENCHMARK_CORPUS.filter((day) => day.stops.length <= 7);
  assert.equal(small.length, 13);
  for (const day of small) assert.equal(compareSchedules(solveOptimal(day).optimal, independentBruteForce(day)), 0, day.id);
});
for (let seed = 1; seed <= 28; seed += 1) {
  test('zero optimality gap against independent brute force, seed ' + seed + ', N=' + (1 + seed % 7), () => {
    const day = seededDay(seed), result = solveOptimal(day), oracle = independentBruteForce(day);
    assert.equal(result.method, 'exact-bnb');
    assert.equal(compareSchedules(result.optimal, oracle), 0, 'Independent objective mismatch');
  });
}
for (const preset of STUDIO_PRESETS) {
  test('studio preset has zero independent brute-force gap, ' + preset.id, () => {
    const result = solveOptimal(preset), oracle = independentBruteForce(preset);
    assert.equal(result.method, 'exact-bnb');
    assert.equal(compareSchedules(result.optimal, oracle), 0);
  });
}
test('fractional, negative, and non-finite jitter cannot be truncated by the integer travel matrix', () => {
  for (const value of [.5, -1, Infinity, NaN]) assert.throws(() => solveOptimal({ ...seededDay(4), transitJitterMin: value }));
});
test('orders must be exact permutations with no duplicates or missing stops', () => {
  const day = seededDay(2), ids = day.stops.map((stop) => stop.id);
  assert.throws(() => evaluateOrder(day, [ids[0], ids[0], ids[2]]), /exactly once/);
  assert.throws(() => evaluateOrder(day, ids.slice(1)), /length/);
  assert.throws(() => evaluateOrder(day, ['missing', ...ids.slice(1)]), /Unknown stop/);
});
test('normalization rejects duplicate IDs, non-finite coordinates, and reversed windows', () => {
  const duplicate = seededDay(1); duplicate.stops[1].id = duplicate.stops[0].id;
  assert.throws(() => normalizeScenario(duplicate), /unique/);
  assert.throws(() => normalizeScenario({ ...seededDay(1), anchor: { x: NaN, y: 0 } }));
  const reversed = seededDay(1); reversed.stops[0].windowEnd = '08:00';
  assert.throws(() => normalizeScenario(reversed), /Closing time/);
});
test('invalid mode prototype lookups and malformed numeric clocks are rejected', () => {
  for (const mode of ['__proto__', 'constructor', 'toString']) assert.throws(() => solveOptimal({ ...seededDay(1), mode }), /mode/);
  for (const clock of [-1, .5, 1440, NaN]) assert.throws(() => parseClockToMin(clock));
});
test('the lexicographic objective protects deadlines before saving travel minutes', () => {
  const base = { prerequisiteViolations: 0, missedDeadlines: 0, totalLatenessMin: 0, totalSpanMin: 100, totalTravelMin: 50, minBufferSlackMin: 5 };
  assert.ok(compareSchedules(base, { ...base, missedDeadlines: 1, totalSpanMin: 20, totalTravelMin: 1 }) < 0);
  assert.ok(compareSchedules(base, { ...base, minBufferSlackMin: 4 }) < 0);
  assert.ok(compareSchedules(base, { ...base, totalLatenessMin: 1 }) < 0);
});
test('a deliberately exhausted node budget is labeled bounded and still beats or ties all seeds', () => {
  const result = solveOptimal(STUDIO_PRESETS[0], { nodeBudget: 1 });
  assert.equal(result.method, 'bounded-bnb');
  for (const baseline of Object.values(result.baselines)) assert.ok(compareSchedules(result.optimal, baseline) <= 0);
  assert.throws(() => solveOptimal(STUDIO_PRESETS[0], { nodeBudget: 0 }), /budget/);
});

