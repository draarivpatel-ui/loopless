import test from 'node:test';
import assert from 'node:assert/strict';
import { STUDIO_PRESETS } from '../js/presets.mjs';
import { solveOptimal, compareSchedules } from '../js/planner.mjs';
import { validateTour, addStop, editStop, deleteStop, createHistory, encodeTourHash, decodeTourHash, readStoredTour, writeStoredTour, compareModes, buildJitterSweep, createAnalyzer, STORAGE_KEY, MAX_HASH_LENGTH, MAX_STOPS } from '../js/studio.mjs';

const fresh = () => validateTour(structuredClone(STUDIO_PRESETS[0]));
const hash = (data) => '#tour=' + Buffer.from(typeof data === 'string' ? data : JSON.stringify(data), 'utf8').toString('base64url');
function memoryStorage() {
  const items = new Map();
  return { getItem: (key) => items.get(key) ?? null, setItem: (key, value) => items.set(key, value), items };
}

test('all four Houston and Sugar Land illustrative presets validate without mutation', () => {
  for (const preset of STUDIO_PRESETS) {
    const before = JSON.stringify(preset);
    assert.equal(validateTour(preset).id, preset.id);
    assert.equal(JSON.stringify(preset), before);
  }
  assert.equal(STUDIO_PRESETS.length, 4);
});
test('flagship day saves exactly 56 travel minutes, 99 day minutes, and three deadlines', () => {
  const result = solveOptimal(fresh());
  assert.equal(result.optimal.totalTravelMin, 78);
  assert.equal(result.baselines.fifo.totalTravelMin, 134);
  assert.equal(result.baselines.fifo.totalSpanMin - result.optimal.totalSpanMin, 99);
  assert.equal(result.baselines.fifo.missedDeadlines, 3);
  assert.equal(result.optimal.missedDeadlines, 0);
  assert.equal(result.optimal.endMin, 1075);
});
test('click-to-add preserves the exact supplied coordinates and opens a valid new stop', () => {
  const original = fresh(), result = addStop(original, { x: -1.2, y: 2.3 });
  const stop = result.tour.stops.find((item) => item.id === result.stopId);
  assert.equal(stop.x, -1.2); assert.equal(stop.y, 2.3);
  assert.equal(stop.windowStart, '15:30'); assert.equal(stop.durationMin, 15);
  assert.equal(original.stops.length, 4); assert.equal(result.tour.stops.length, 5);
});
test('add assigns an unused ID even after gaps and deletions', () => {
  const one = addStop(fresh()), two = addStop(one.tour), three = addStop(deleteStop(two.tour, one.stopId));
  assert.notEqual(three.stopId, two.stopId);
  assert.equal(new Set(three.tour.stops.map((item) => item.id)).size, three.tour.stops.length);
});
test('the studio cap rejects a thirteenth errand without changing the tour', () => {
  let tour = fresh();
  while (tour.stops.length < MAX_STOPS) tour = addStop(tour).tour;
  assert.throws(() => addStop(tour), /12 stops/);
  assert.equal(tour.stops.length, 12);
});
test('stop editing updates every supported field atomically', () => {
  const original = fresh();
  const edited = editStop(original, 'stem-kit', { name: 'Hardware pickup', x: -1, y: 2, windowStart: '16:00', windowEnd: '18:00', durationMin: 30, priority: 1, dependsOn: 'library' });
  const stop = edited.stops.find((item) => item.id === 'stem-kit');
  assert.equal(stop.name, 'Hardware pickup'); assert.equal(stop.x, -1);
  assert.equal(stop.windowStart, '16:00'); assert.equal(stop.windowEnd, '18:00');
  assert.equal(stop.durationMin, 30); assert.equal(stop.priority, 1);
  assert.equal(stop.dependsOn, 'library'); assert.equal(original.stops[2].dependsOn, null);
});
test('leaf deletion removes exactly that stop and keeps all other constraints', () => {
  const original = fresh(), deleted = deleteStop(original, 'groceries');
  assert.equal(deleted.stops.length, 3);
  assert.equal(deleted.stops.find((item) => item.id === 'tutoring').dependsOn, 'library');
  assert.equal(original.stops.length, 4);
});
test('deleting a prerequisite is rejected instead of silently removing a hard constraint', () => {
  assert.throws(() => deleteStop(fresh(), 'library'), /Remove the prerequisite/);
});
test('editing or deleting an unknown stop is rejected', () => {
  assert.throws(() => editStop(fresh(), 'missing', { name: 'Test' }), /no longer exists/);
  assert.throws(() => deleteStop(fresh(), 'missing'), /no longer exists/);
});
test('two-stop and longer prerequisite cycles are rejected before entering history', () => {
  assert.throws(() => editStop(fresh(), 'library', { dependsOn: 'tutoring' }), /cycle/);
  const tour = fresh();
  tour.stops[0].dependsOn = 'stem-kit';
  tour.stops[2].dependsOn = 'library';
  tour.stops[1].dependsOn = 'groceries';
  assert.throws(() => validateTour(tour), /cycle/);
});
test('self prerequisites and missing prerequisite targets are rejected', () => {
  assert.throws(() => editStop(fresh(), 'library', { dependsOn: 'library' }), /dependency/i);
  assert.throws(() => editStop(fresh(), 'library', { dependsOn: 'missing' }), /dependency/i);
});
test('duplicate IDs, reversed windows, and stop ID edits are rejected', () => {
  const duplicate = fresh(); duplicate.stops[1].id = duplicate.stops[0].id;
  assert.throws(() => validateTour(duplicate), /unique/);
  assert.throws(() => editStop(fresh(), 'groceries', { windowStart: '19:00', windowEnd: '18:00' }), /Closing time/);
  assert.throws(() => editStop(fresh(), 'groceries', { id: 'renamed' }), /Unexpected/);
});
for (const [label, patch] of [
  ['NaN coordinates', { x: NaN }], ['infinite coordinates', { y: Infinity }],
  ['coordinates outside the map', { x: 10.01 }], ['numeric strings', { x: '1' }],
  ['zero service minutes', { durationMin: 0 }], ['fractional service minutes', { durationMin: 1.5 }],
  ['too much service time', { durationMin: 241 }], ['priority outside 1 to 3', { priority: 4 }],
  ['an empty name', { name: '  ' }], ['a name over 80 characters', { name: 'a'.repeat(81) }],
  ['HTML names', { name: '<img src=x onerror=alert(1)>' }], ['control characters', { name: 'Line\nbreak' }],
  ['invalid clock minutes', { windowEnd: '18:60' }], ['unknown stop fields', { url: 'https://invalid.example' }],
]) {
  test('editor rejects ' + label, () => assert.throws(() => editStop(fresh(), 'groceries', patch)));
}
test('typographic dashes and smart quotes are rejected at the input boundary', () => {
  for (const code of [0x2013, 0x2014, 0x2018, 0x2019, 0x201c, 0x201d]) assert.throws(() => editStop(fresh(), 'groceries', { name: 'Name' + String.fromCharCode(code) }));
});
test('unknown modes, prototype names, fractional delay, and non-boolean return flags are rejected', () => {
  for (const patch of [{ mode: '__proto__' }, { mode: 'constructor' }, { metric: 'road-api' }, { transitJitterMin: .5 }, { transitJitterMin: 16 }, { returnToAnchor: 'true' }]) assert.throws(() => validateTour({ ...fresh(), ...patch }));
});
test('empty tours are valid and safe to share', () => {
  const empty = { ...fresh(), stops: [] };
  assert.deepEqual(decodeTourHash(encodeTourHash(empty)), empty);
  assert.equal(solveOptimal(empty).optimal.feasible, true);
});
test('share URL hashes round-trip every preset, all fields, and prerequisites', () => {
  for (const preset of STUDIO_PRESETS) {
    const tour = validateTour(preset), encoded = encodeTourHash(tour);
    assert.match(encoded, /^#tour=[A-Za-z0-9_-]+$/);
    assert.deepEqual(decodeTourHash(encoded), tour);
    assert.equal(encodeTourHash(decodeTourHash(encoded)), encoded);
  }
});
test('UTF-8 names round-trip without mojibake', () => {
  const name = 'Caf' + String.fromCharCode(233) + ' supply pickup';
  const tour = editStop(fresh(), 'groceries', { name });
  assert.equal(decodeTourHash(encodeTourHash(tour)).stops[0].name, name);
});
test('empty and secret buddy fragments are recognized without importing a tour', () => {
  assert.equal(decodeTourHash(''), null); assert.equal(decodeTourHash('#capybara-buddy'), null);
});
for (const malformed of ['#tour=', '#tour=a', '#tour=%3Cscript%3E', '#tour=abc&extra=yes', '#tour=abc=', '#tour=abc def', 'javascript:alert(1)']) {
  test('share validation rejects malformed encoding ' + malformed, () => assert.throws(() => decodeTourHash(malformed)));
}
test('overlength hashes are rejected before decoding', () => {
  assert.throws(() => decodeTourHash('#tour=' + 'A'.repeat(MAX_HASH_LENGTH)), /Malformed/);
});
test('invalid UTF-8 and invalid JSON are rejected', () => {
  assert.throws(() => decodeTourHash('#tour=' + Buffer.from([255, 254, 253]).toString('base64url')), /UTF-8/);
  assert.throws(() => decodeTourHash(hash('not JSON')), /JSON/);
});
test('unsupported shared schema versions and oversized decoded documents are rejected', () => {
  assert.throws(() => decodeTourHash(hash({ v: 99, tour: fresh() })), /version/);
  assert.throws(() => decodeTourHash(hash(' '.repeat(10001))), /too large/);
});
for (const key of ['__proto__', 'constructor', 'prototype']) {
  test('hostile share key ' + key + ' cannot pollute any prototype', () => {
    const tour = fresh();
    Object.defineProperty(tour.stops[0], key, { enumerable: true, value: { pollutedLoopless: true } });
    assert.throws(() => decodeTourHash(hash({ v: 1, tour })), /Unexpected/);
    assert.equal(Object.prototype.pollutedLoopless, undefined);
    assert.equal({}.pollutedLoopless, undefined);
  });
}
test('the hash allowlist is strict at envelope, tour, stop, and anchor levels', () => {
  for (const level of ['envelope', 'tour', 'stop', 'anchor']) {
    const data = { v: 1, tour: fresh() };
    const target = level === 'envelope' ? data : level === 'tour' ? data.tour : level === 'stop' ? data.tour.stops[0] : data.tour.anchor;
    target.extra = 'discarding would be unsafe';
    assert.throws(() => decodeTourHash(hash(data)), /Unexpected/);
  }
});
test('XSS markup in a valid hash is rejected before it can reach the DOM', () => {
  const data = { v: 1, tour: fresh() }; data.tour.stops[0].name = '<svg onload=alert(1)>';
  assert.throws(() => decodeTourHash(hash(data)), /plain text/);
});
test('cyclic and missing dependencies inside otherwise valid hashes are rejected', () => {
  const cycle = fresh(); cycle.stops[1].dependsOn = 'tutoring';
  assert.throws(() => decodeTourHash(hash({ v: 1, tour: cycle })), /cycle/);
  const missing = fresh(); missing.stops[0].dependsOn = 'ghost';
  assert.throws(() => decodeTourHash(hash({ v: 1, tour: missing })), /dependency/i);
});
test('undo and redo restore complete tours, including settings and coordinates', () => {
  const original = fresh(), history = createHistory(original), changed = editStop(original, 'groceries', { x: 3, name: 'Updated errand' });
  history.apply({ ...changed, mode: 'car', transitJitterMin: 3 });
  assert.equal(history.canUndo, true); assert.deepEqual(history.undo(), original);
  assert.equal(history.canRedo, true); assert.equal(history.redo().stops[0].x, 3);
  assert.equal(history.current.mode, 'car'); assert.equal(history.current.transitJitterMin, 3);
});
test('a new edit after undo clears the redo branch', () => {
  const history = createHistory(fresh());
  history.apply({ ...history.current, mode: 'walk' }); history.undo();
  history.apply({ ...history.current, mode: 'car' });
  assert.equal(history.canRedo, false); assert.equal(history.redo().mode, 'car');
});
test('history snapshots cannot be mutated through readers', () => {
  const history = createHistory(fresh()), snapshot = history.current;
  snapshot.stops[0].name = 'Mutated';
  assert.notEqual(history.current.stops[0].name, 'Mutated');
  history.apply({ ...history.current, mode: 'car' });
  const undone = history.undo(); undone.stops.length = 0;
  assert.equal(history.current.stops.length, 4);
});
test('invalid edits and no-op saves do not create undo history', () => {
  const history = createHistory(fresh());
  assert.equal(history.apply(fresh()), false);
  assert.throws(() => history.apply({ ...fresh(), mode: 'teleport' }));
  assert.equal(history.canUndo, false);
});
test('history is bounded and undo at its boundary is stable', () => {
  const history = createHistory(fresh(), 2);
  for (const delay of [1, 2, 3]) history.apply({ ...history.current, transitJitterMin: delay });
  history.undo(); history.undo(); assert.equal(history.current.transitJitterMin, 1);
  assert.equal(history.canUndo, false); assert.equal(history.undo().transitJitterMin, 1);
  assert.throws(() => createHistory(fresh(), 0));
});
test('localStorage round-trips the same strict schema as URL sharing', () => {
  const storage = memoryStorage();
  assert.equal(writeStoredTour(storage, fresh()), true);
  assert.deepEqual(readStoredTour(storage), { tour: fresh(), error: null });
});
test('malformed storage is reported without clearing unrelated browser data', () => {
  const storage = memoryStorage(); storage.setItem('other-app', 'keep'); storage.setItem(STORAGE_KEY, '{oops');
  assert.equal(readStoredTour(storage).tour, null); assert.ok(readStoredTour(storage).error);
  assert.equal(storage.getItem('other-app'), 'keep');
});
test('storage quota and privacy errors preserve a usable in-memory tour', () => {
  const broken = { getItem() { throw new Error('Blocked'); }, setItem() { throw new Error('Quota'); } };
  assert.equal(writeStoredTour(broken, fresh()), false);
  assert.equal(readStoredTour(broken).tour, null);
  assert.equal(fresh().stops.length, 4);
});
test('storage rejects hostile and oversized documents', () => {
  const storage = memoryStorage();
  storage.setItem(STORAGE_KEY, JSON.stringify({ v: 1, tour: { ...fresh(), extra: true } }));
  assert.equal(readStoredTour(storage).tour, null);
  storage.setItem(STORAGE_KEY, 'x'.repeat(10001)); assert.equal(readStoredTour(storage).tour, null);
});
test('live transit matrix uses the exact active day and known mode parameters', () => {
  const original = fresh(), before = JSON.stringify(original), modes = compareModes(original);
  assert.deepEqual(modes.map((mode) => [mode.id, mode.travelMin, mode.onTime]), [['walk', 257, 2], ['bike', 78, 4], ['bus', 86, 4], ['car', 56, 4]]);
  assert.equal(JSON.stringify(original), before);
});
test('mode matrix includes the currently selected jitter for every mode', () => {
  const tour = { ...fresh(), transitJitterMin: 7 };
  for (const mode of compareModes(tour)) {
    const optimal = solveOptimal({ ...tour, mode: mode.id }).optimal;
    assert.equal(mode.travelMin, optimal.totalTravelMin);
    assert.equal(mode.missedDeadlines, optimal.missedDeadlines);
  }
});
test('jitter sweep identifies the exact +13 minute first failure and its stop witness', () => {
  const sweep = buildJitterSweep(fresh());
  assert.equal(sweep.points.length, 16); assert.equal(sweep.exact, true);
  assert.equal(sweep.firstBreakMin, 13); assert.deepEqual(sweep.firstBrokenStopIds, ['stem-kit']);
  assert.equal(sweep.points[12].missedDeadlines, 0);
  assert.equal(sweep.points[12].minSlackMin, 1);
  assert.equal(sweep.points[13].missedDeadlines, 1);
  assert.equal(sweep.points[13].minSlackMin, -2);
});
test('jitter sweep independently re-optimizes every point rather than extrapolating', () => {
  const tour = fresh(), sweep = buildJitterSweep(tour);
  for (const point of sweep.points) {
    const result = solveOptimal({ ...tour, transitJitterMin: point.delayMin });
    assert.equal(compareSchedules(point.solution.optimal, result.optimal), 0);
    assert.deepEqual(point.solution.optimal.orderIds, result.optimal.orderIds);
  }
});
test('already overloaded days tip at zero and do not claim protected deadlines', () => {
  const sweep = buildJitterSweep(STUDIO_PRESETS[3]);
  assert.equal(sweep.firstBreakMin, 0); assert.ok(sweep.points[0].missedDeadlines > 0);
});
test('a sweep with no failure does not invent a tipping point beyond the tested range', () => {
  const sweep = buildJitterSweep(STUDIO_PRESETS[1]);
  assert.equal(sweep.firstBreakMin, null);
  assert.ok(sweep.points.every((point) => point.missedDeadlines === 0));
});
test('zero-distance legs receive no delay at any jitter point', () => {
  const tour = { ...fresh(), anchor: { name: 'Base', x: 0, y: 0 }, stops: [{ id: 'one', name: 'At base', x: 0, y: 0, durationMin: 10, windowStart: '15:30', windowEnd: '16:00' }] };
  const sweep = buildJitterSweep(tour);
  assert.ok(sweep.points.every((point) => point.travelMin === 0 && point.minSlackMin === 20));
});
test('analyzer caches a sweep across jitter changes and invalidates it after an errand edit', () => {
  const analyze = createAnalyzer(), one = analyze(fresh()), two = analyze({ ...fresh(), transitJitterMin: 5 });
  assert.equal(one.sweep, two.sweep); assert.equal(two.solution, two.sweep.points[5].solution);
  const three = analyze(editStop(fresh(), 'groceries', { durationMin: 40 }));
  assert.notEqual(three.sweep, two.sweep);
});

