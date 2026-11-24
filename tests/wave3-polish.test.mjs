import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { solveOptimal, compareSchedules, buildIcsCalendar, formatSlackLabel } from '../js/planner.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const app = read('js/app.js'), planner = read('js/planner.mjs');

// Independent schedule oracle: re-implements the model without evaluateOrder or the solver.
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
// Wave 3 generator: random DAG edges (fans, forks, chains), co-located stops, tight
// and zero-width windows, both metrics, every mode, jitter, and varying start times.
function seededDay(seed) {
  let word = Math.imul(seed + 11, 2654435761) >>> 0;
  const random = () => { word = (Math.imul(word, 22695477) + 1) >>> 0; return word / 4294967296; };
  const n = 1 + seed % 7, start = 480 + Math.floor(random() * 300);
  const stops = Array.from({ length: n }, (_, index) => {
    const opens = start + Math.floor(random() * 180);
    const width = random() < .12 ? 0 : 5 + Math.floor(random() * 180);
    return {
      id: 's' + index, name: 'Wave3 errand ' + index,
      x: Math.round((random() * 8 - 4) * 10) / 10, y: Math.round((random() * 8 - 4) * 10) / 10,
      durationMin: 1 + Math.floor(random() * 50),
      windowStart: hhmm(opens), windowEnd: hhmm(opens + width),
      priority: 1 + Math.floor(random() * 3),
      dependsOn: index > 0 && random() < .4 ? 's' + Math.floor(random() * index) : null,
    };
  });
  if (n > 1 && random() < .4) { const i = Math.floor(random() * n), j = Math.floor(random() * n); stops[i].x = stops[j].x; stops[i].y = stops[j].y; }
  return { id: 'wave3-' + seed, title: 'Wave 3 seeded day', mode: Object.keys(specs)[seed % 4], metric: seed % 2 ? 'euclidean' : 'manhattan', startTime: hhmm(start), transitJitterMin: seed % 16, anchor: { x: 0, y: 0 }, returnToAnchor: seed % 3 !== 0, stops };
}
for (let seed = 1; seed <= 40; seed += 1) {
  const day = seededDay(seed);
  test('zero optimality gap on random DAG day, seed ' + seed + ', N=' + day.stops.length, () => {
    const result = solveOptimal(day), oracle = independentBruteForce(day);
    assert.equal(result.method, 'exact-bnb');
    assert.equal(compareSchedules(result.optimal, oracle), 0, 'Independent objective mismatch');
    const seen = new Set();
    for (const id of result.optimal.orderIds) {
      const stop = day.stops.find((item) => item.id === id);
      if (stop.dependsOn) assert.ok(seen.has(stop.dependsOn), 'DAG order honored');
      seen.add(id);
    }
  });
}
test('zero-duration service and reversed windows are rejected, equal-width windows solve exactly', () => {
  const day = seededDay(2);
  day.stops[0].durationMin = 0;
  assert.throws(() => solveOptimal(day), /Service duration/);
  const tight = seededDay(5);
  tight.stops = [{ id: 'z', name: 'Z', x: 1, y: 0, durationMin: 5, windowStart: '09:30', windowEnd: '09:30', priority: 2 }];
  const result = solveOptimal(tight);
  assert.equal(compareSchedules(result.optimal, independentBruteForce(tight)), 0);
});

test('deep chain and fan-in DAG day matches brute force and honors every edge', () => {
  const day = seededDay(3);
  day.stops = [
    { id: 'a', name: 'A', x: 1, y: 0, durationMin: 10, windowStart: '08:00', windowEnd: '20:00', priority: 2 },
    { id: 'b', name: 'B', x: 2, y: 1, durationMin: 10, windowStart: '08:00', windowEnd: '20:00', priority: 2, dependsOn: 'a' },
    { id: 'c', name: 'C', x: -1, y: 2, durationMin: 10, windowStart: '08:00', windowEnd: '20:00', priority: 2, dependsOn: 'a' },
    { id: 'd', name: 'D', x: 1, y: -2, durationMin: 10, windowStart: '08:00', windowEnd: '20:00', priority: 2, dependsOn: 'b' },
    { id: 'e', name: 'E', x: 3, y: 0, durationMin: 10, windowStart: '08:00', windowEnd: '20:00', priority: 2, dependsOn: 'd' },
    { id: 'f', name: 'F', x: 0, y: 3, durationMin: 10, windowStart: '08:00', windowEnd: '20:00', priority: 2, dependsOn: 'd' },
  ];
  const result = solveOptimal(day);
  assert.equal(compareSchedules(result.optimal, independentBruteForce(day)), 0);
  const position = new Map(result.optimal.orderIds.map((id, index) => [id, index]));
  assert.ok(position.get('a') < position.get('b') && position.get('a') < position.get('c'));
  assert.ok(position.get('b') < position.get('d'));
  assert.ok(position.get('d') < position.get('e') && position.get('d') < position.get('f'));
});

test('ICS calendar reports lateness as minutes late, never a negative slack figure', () => {
  const day = { id: 'ics-late', title: 'ICS Late', mode: 'bike', metric: 'manhattan', startTime: '09:00', returnToAnchor: false, transitJitterMin: 0, anchor: { name: 'Base', x: 0, y: 0 }, stops: [{ id: 's', name: 'Short', x: 1, y: 0, durationMin: 30, windowStart: '09:00', windowEnd: '09:20', priority: 2 }] };
  const result = solveOptimal(day);
  assert.equal(result.optimal.legTimeline[0].slackMin, -17);
  const ics = buildIcsCalendar(result.scenario, result.optimal, '2026-11-21');
  assert.ok(ics.includes('17 min late'), 'ICS description states positive lateness');
  assert.ok(!ics.includes('-17 min'), 'no negative slack figure leaks into the export');
});

test('every display surface that shows slack uses formatSlackLabel, never a raw signed number', () => {
  assert.ok(app.includes('formatSlackLabel(current.minSlackMin)'), 'jitter margin line');
  assert.equal((app.match(/formatSlackLabel\(point\.minSlackMin\)/g) || []).length, 3, 'chart dot accessible name, title, and table column');
  assert.ok(!app.includes("minSlackMin + ' min'"), 'no raw signed margin text');
  assert.ok(app.includes('formatSlackLabel(leg.slackMin)'), 'daily card description uses the label');
  assert.ok(planner.includes('formatSlackLabel(leg.slackMin)'), 'ICS description uses the label');
  assert.ok(!planner.includes('Slack: ${'), 'old negative slack wording removed');
  assert.equal(formatSlackLabel(-112), '112 min late');
  assert.equal(formatSlackLabel(7), '7 min margin');
});

test('a deadline-rescuing day that spends travel explains the negative minutes-saved figure', () => {
  const day = { id: 'trade', title: 'Trade', mode: 'car', metric: 'manhattan', startTime: '09:00', returnToAnchor: true, transitJitterMin: 0, anchor: { name: 'Base', x: 0, y: 0 }, stops: [
    { id: 'near', name: 'Near stop', x: .5, y: 0, durationMin: 60, windowStart: '09:00', windowEnd: '20:00', priority: 2 },
    { id: 'far', name: 'Far early close', x: 5, y: 0, durationMin: 5, windowStart: '09:00', windowEnd: '09:45', priority: 3 },
    { id: 'mid', name: 'Mid errand', x: 5, y: .5, durationMin: 30, windowStart: '09:00', windowEnd: '20:00', priority: 2 },
  ] };
  const result = solveOptimal(day);
  const saved = result.baselines.fifo.totalTravelMin - result.optimal.totalTravelMin;
  assert.equal(saved, -1, 'optimal spends one minute to rescue the deadline');
  assert.equal(result.baselines.fifo.missedDeadlines - result.optimal.missedDeadlines, 1);
  assert.ok(app.includes('to hold deadlines'), 'negative figure is explained in the verdict line');
});

test('jitter slider is debounced instead of posting an analysis per input event', () => {
  assert.ok(app.includes('clearTimeout(state.jitterTimer)'));
  assert.ok(app.includes('state.jitterTimer = setTimeout('));
  assert.ok(!app.includes("ui.jitterSlider.addEventListener('input', () => commit("), 'no un-debounced commit');
  assert.ok(app.includes("ui.jitterValue.textContent = '+' + ui.jitterSlider.value + ' min'"), 'label still updates live during a drag');
});

test('greedy verdict reads the solved analysis instead of re-running a main-thread solve', () => {
  assert.ok(!app.includes('compareGreedyExact'), 'comparison helper call and import removed from app');
  assert.ok(app.includes('state.analysis.solution.baselines.nearest'), 'verdict uses the worker solution');
});

test('map axis caption no longer collides with the coordinate readout', () => {
  assert.ok(app.includes("'axis-caption', 'text-anchor': 'start'"), 'caption anchored to the free bottom-left corner');
  assert.ok(!app.includes("'axis-caption', 'text-anchor': 'end'"), 'old bottom-right position removed');
});

test('daily card names the selected mode by label rather than the raw id', () => {
  assert.ok(app.includes('mode.id === state.tour.mode'), 'label lookup against the mode matrix');
  assert.ok(!app.includes("state.tour.startTime + ' / ' + state.tour.mode"), 'raw mode id no longer printed');
});
