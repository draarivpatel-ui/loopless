import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { solveOptimal, diagnoseInfeasibleWindows, compareSchedules, normalizeScenario, formatSlackLabel } from '../js/planner.mjs';
import { compareGreedyExact } from '../js/planner.mjs';
import { STUDIO_PRESETS } from '../js/presets.mjs';
import { decodeTourHash, encodeTourHash, validateTour } from '../js/studio.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const html = read('index.html'), app = read('js/app.js'), css = read('styles.css');
const tour = (overrides) => ({
  id: 'probe', title: 'Probe', mode: 'bike', metric: 'manhattan', startTime: '09:00',
  returnToAnchor: false, transitJitterMin: 0, anchor: { name: 'Base', x: 0, y: 0 },
  stops: [], ...overrides,
});

test('one-stop window shorter than service is diagnosed and never shown as positive margin', () => {
  const day = tour({ stops: [{ id: 's', name: 'Short', x: 1, y: 0, durationMin: 30, windowStart: '09:00', windowEnd: '09:20', priority: 2 }] });
  const diagnosis = diagnoseInfeasibleWindows(day);
  assert.deepEqual(diagnosis, [{ stopId: 's', reason: 'window shorter than service' }]);
  const result = solveOptimal(day);
  const finish = result.optimal.legTimeline[0].finishMin;
  assert.ok(finish > result.optimal.legTimeline[0].windowEndMin);
  assert.equal(formatSlackLabel(result.optimal.legTimeline[0].slackMin), '17 min late');
  assert.equal(formatSlackLabel(5), '5 min margin');
  assert.equal(formatSlackLabel(0), '0 min margin');
});

test('two-stop chain with a one-minute margin holds at zero delay', () => {
  const day = tour({ stops: [
    { id: 'a', name: 'A', x: 1, y: 0, durationMin: 10, windowStart: '09:00', windowEnd: '09:18', priority: 2 },
    { id: 'b', name: 'B', x: 2, y: 0, durationMin: 10, windowStart: '09:00', windowEnd: '09:35', priority: 2, dependsOn: 'a' },
  ] });
  assert.deepEqual(diagnoseInfeasibleWindows(day), []);
  const result = solveOptimal(day);
  assert.equal(result.method, 'exact-bnb');
  assert.equal(result.optimal.missedDeadlines, 0);
  assert.deepEqual(result.optimal.legTimeline.map((leg) => leg.slackMin), [1, 1]);
});

test('same chain with a one-minute delay is detected as infeasible under the active jitter', () => {
  const day = tour({ transitJitterMin: 1, stops: [
    { id: 'a', name: 'A', x: 1, y: 0, durationMin: 10, windowStart: '09:00', windowEnd: '09:18', priority: 2 },
    { id: 'b', name: 'B', x: 2, y: 0, durationMin: 10, windowStart: '09:00', windowEnd: '09:35', priority: 2, dependsOn: 'a' },
  ] });
  const diagnosis = diagnoseInfeasibleWindows(day);
  assert.ok(diagnosis.some((item) => item.stopId === 'b'), 'dependency-aware diagnosis names B under jitter');
  const result = solveOptimal(day);
  assert.equal(result.optimal.missedDeadlines, 1, 'solver correctly misses B under jitter');
  const zeroDelay = { ...day, transitJitterMin: 0 };
  assert.deepEqual(diagnoseInfeasibleWindows(zeroDelay), [], 'the same chain holds at zero delay');
  assert.equal(solveOptimal(zeroDelay).optimal.missedDeadlines, 0);
});

test('diagnosis includes the selected delay and exempts zero-distance legs', () => {
  const delayed = tour({ transitJitterMin: 5, stops: [{ id: 's', name: 'S', x: 1, y: 0, durationMin: 5, windowStart: '09:00', windowEnd: '09:12', priority: 2 }] });
  assert.deepEqual(diagnoseInfeasibleWindows(delayed), [{ stopId: 's', reason: 'cannot finish by closing time' }]);
  assert.equal(solveOptimal(delayed).optimal.missedDeadlines, 1);
  const coLocated = tour({ transitJitterMin: 15, anchor: { name: 'Base', x: 1, y: 0 }, stops: [{ id: 'z', name: 'Z', x: 1, y: 0, durationMin: 5, windowStart: '09:00', windowEnd: '09:10', priority: 2 }] });
  assert.deepEqual(diagnoseInfeasibleWindows(coLocated), []);
  assert.equal(solveOptimal(coLocated).optimal.missedDeadlines, 0);
});

test('diagnosis follows prerequisite chains rather than only checking the anchor', () => {
  const day = tour({ mode: 'walk', stops: [
    { id: 'a', name: 'A', x: 1, y: 0, durationMin: 5, windowStart: '09:00', windowEnd: '10:30', priority: 2 },
    { id: 'b', name: 'B', x: -3, y: 0, durationMin: 5, windowStart: '09:00', windowEnd: '09:45', priority: 2, dependsOn: 'a' },
  ] });
  assert.deepEqual(diagnoseInfeasibleWindows(day), [{ stopId: 'b', reason: 'cannot finish by closing time' }]);
});

test('budget exhaustion on the six-stop hackathon preset stays honest and deterministic', () => {
  const preset = STUDIO_PRESETS.find((item) => item.id === 'riverside-hackathon');
  assert.equal(preset.stops.length, 6);
  const bounded = solveOptimal(preset, { nodeBudget: 1 });
  assert.equal(bounded.method, 'bounded-bnb');
  for (const baseline of Object.values(bounded.baselines)) assert.ok(compareSchedules(bounded.optimal, baseline) <= 0);
  const exact = solveOptimal(preset);
  assert.ok(['exact-bnb', 'bounded-bnb'].includes(exact.method));
  assert.equal(bounded.optimal.orderIds.join(','), solveOptimal(preset, { nodeBudget: 1 }).optimal.orderIds.join(','));
});

test('tampered share hashes fail closed without mutating a valid tour', () => {
  const valid = validateTour(STUDIO_PRESETS[0]);
  const hash = encodeTourHash(valid);
  assert.deepEqual(decodeTourHash(hash), valid);
  const mutations = [
    hash.slice(0, -1) + (hash.at(-1) === 'A' ? 'B' : 'A'),
    hash + 'A',
    hash.replace('#tour=', '#tour=!'),
    '#tour=not base64',
    hash.slice(0, 40),
  ];
  for (const bad of mutations) assert.throws(() => decodeTourHash(bad));
  assert.deepEqual(decodeTourHash(hash), valid, 'valid hash remains readable after failures');
});

test('prominent greedy verdict and diagnosis live above the workspace', () => {
  const verdictIndex = html.indexOf('id="greedy-verdict"');
  const workspaceIndex = html.indexOf('class="workspace"');
  assert.ok(verdictIndex > 0 && verdictIndex < workspaceIndex);
  assert.ok(html.indexOf('id="infeasible-diagnosis"') < workspaceIndex);
  assert.ok(!html.includes('id="greedy-verdict"') || html.indexOf('id="btn-compare-greedy-exact"') > verdictIndex);
  assert.ok(app.includes("ui.greedyExact.textContent = savings.length"));
  assert.ok(app.includes("ui.infeasible.hidden = diagnosis.length === 0"));
});

test('replay controls stay below the map at every viewport', () => {
  const mapIndex = html.indexOf('id="route-svg"');
  const replayIndex = html.indexOf('id="route-replay"');
  assert.ok(replayIndex > mapIndex, 'replay follows the map in DOM order');
  assert.ok(!app.includes("ui.map.parentElement.before(document.getElementById('route-replay'))"));
  assert.ok(app.includes("head.dataset.clockLabel = clockLabel(position.clockMin)"));
  assert.ok(html.includes('One clock: marker and every Gantt playhead move together.'));
});

test('timeline and daily card render lateness instead of a negative margin', () => {
  assert.ok(app.includes('formatSlackLabel(leg.slackMin)'));
  assert.equal((app.match(/formatSlackLabel\(leg\.slackMin\)/g) || []).length, 2, 'one timeline and one card call site');
  assert.ok(!app.includes("leg.slackMin + ' min'"));
  assert.equal(formatSlackLabel(-17), '17 min late');
});

test('first-screen and source invariants hold after Wave 2 polish', () => {
  assert.ok(!/html\s*\{[^}]*scroll-behavior:\s*smooth/.test(css));
  assert.ok(!/text-transform:\s*uppercase/i.test(css), 'no all-caps eyebrow styling');
  assert.ok(!html.includes('class="tagline"'), 'no tagline below the hero');
  const typographicDashes = new RegExp([0x2013, 0x2014].map((code) => String.fromCharCode(code)).join('|'));
  for (const file of ['README.md', 'index.html', 'styles.css', 'js/app.js', 'js/planner.mjs']) assert.equal(typographicDashes.test(read(file)), false, file);
  assert.ok(html.includes("connect-src 'none'"));
  assert.ok(app.includes("new Worker(new URL('./solver-worker.mjs?v=studio-c49dfe94a109'"));
});

test('comparison helper remains consistent with solver on every preset', () => {
  for (const preset of STUDIO_PRESETS) {
    const compared = compareGreedyExact(preset);
    const solved = solveOptimal(preset);
    assert.equal(compared.greedy.totalTravelMin, solved.baselines.nearest.totalTravelMin);
    assert.equal(compared.exact.totalTravelMin, solved.optimal.totalTravelMin);
    assert.equal(compared.latePenaltiesSaved, compared.greedy.missedDeadlines - compared.exact.missedDeadlines);
    assert.equal(normalizeScenario(preset).stops.length, preset.stops.length);
  }
});
