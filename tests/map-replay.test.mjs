import test from 'node:test';
import assert from 'node:assert/strict';
import { solveOptimal } from '../js/planner.mjs';
import { STUDIO_PRESETS } from '../js/presets.mjs';
import { createMapProjection, layoutMapPins, routePoints, legPoints, replayPosition, nextReplayStep } from '../js/map.mjs';

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, a + ' differs from ' + b);
test('map projection round-trips negative and positive coordinates at desktop and mobile sizes', () => {
  for (const [width, height] of [[900, 430], [420, 380]]) {
    const projection = createMapProjection(STUDIO_PRESETS[0], width, height);
    for (const point of [{ x: -2.6, y: .2 }, { x: 0, y: 0 }, { x: 2.5, y: 1.4 }]) {
      const result = projection.unproject(projection.project(point));
      near(result.x, point.x); near(result.y, point.y);
    }
  }
});
test('mile-grid projection preserves equal scale on both axes', () => {
  const projection = createMapProjection(STUDIO_PRESETS[0]);
  const origin = projection.project({ x: 0, y: 0 }), east = projection.project({ x: 1, y: 0 }), north = projection.project({ x: 0, y: 1 });
  near(east.x - origin.x, origin.y - north.y);
});
test('Manhattan leg vertices follow streets while direct legs preserve diagonal geometry', () => {
  const a = { x: -1, y: 2 }, b = { x: 3, y: -2 };
  assert.deepEqual(legPoints(a, b, 'manhattan'), [a, { x: 3, y: 2 }, b]);
  assert.deepEqual(legPoints(a, b, 'euclidean'), [a, b]);
});
test('route vertices include the return only when the evaluated tour returns to base', () => {
  const loop = solveOptimal(STUDIO_PRESETS[0]), oneWay = solveOptimal({ ...STUDIO_PRESETS[0], returnToAnchor: false });
  const returned = routePoints(loop.scenario, loop.optimal), open = routePoints(oneWay.scenario, oneWay.optimal);
  assert.deepEqual(returned.at(-1), loop.scenario.anchor);
  assert.notDeepEqual(open.at(-1), oneWay.scenario.anchor);
});
test('nearby and co-located pins get distinct hit targets without changing route coordinates', () => {
  const stops = Array.from({ length: 12 }, (_, index) => ({ id: 's' + index, name: 'Same site', x: 0, y: 0 }));
  const day = { startTime: '09:00', anchor: { x: 0, y: 0 }, stops };
  const projection = createMapProjection(day, 420, 380, 35);
  const pins = layoutMapPins(stops, projection, 52, day.anchor);
  for (const [index, pin] of pins.entries()) {
    near(pin.realX, projection.project(stops[index]).x);
    near(pin.realY, projection.project(stops[index]).y);
    for (const other of pins.slice(index + 1)) assert.ok(Math.hypot(pin.x - other.x, pin.y - other.y) >= 51.99);
  }
  assert.ok(pins.some((pin) => pin.moved)); assert.ok(stops.every((stop) => stop.x === 0 && stop.y === 0));
});
test('replay interpolates along the actual Manhattan leg at the same schedule clock', () => {
  const result = solveOptimal(STUDIO_PRESETS[0]), position = replayPosition(result.scenario, result.optimal, 11);
  assert.equal(position.phase, 'travel'); assert.equal(position.stopId, 'library');
  assert.equal(position.clockMin, 941); near(position.x, 1.95); near(position.y, 0);
});
test('replay remains at the stop during a wait and during service', () => {
  const day = { startTime: '10:00', mode: 'walk', returnToAnchor: false, stops: [{ id: 'one', name: 'Wait site', x: 0, y: 0, durationMin: 20, windowStart: '11:00', windowEnd: '12:00' }] };
  const result = solveOptimal(day);
  const waiting = replayPosition(result.scenario, result.optimal, 30), service = replayPosition(result.scenario, result.optimal, 65);
  assert.equal(waiting.phase, 'wait'); assert.equal(service.phase, 'service');
  assert.equal(waiting.x, 0); assert.equal(service.x, 0);
  assert.equal(service.clockMin, 665);
});
test('step advances stop by stop to each service start, then completes the return', () => {
  const result = solveOptimal(STUDIO_PRESETS[0]), times = [];
  let current = 0;
  while (current < result.optimal.totalSpanMin) { current = nextReplayStep(result.optimal, current); times.push(current); }
  assert.deepEqual(times, [22, 36, 91, 108, 145]);
});
test('return replay moves back to base and clamps safely at both ends', () => {
  const day = { startTime: '10:00', mode: 'walk', stops: [{ id: 'one', name: 'Site', x: 1, y: 0, durationMin: 10, windowStart: '10:00', windowEnd: '12:00' }] };
  const result = solveOptimal(day), halfway = replayPosition(result.scenario, result.optimal, 40);
  assert.equal(halfway.phase, 'return'); near(halfway.x, .5);
  const end = replayPosition(result.scenario, result.optimal, 9999);
  assert.equal(end.phase, 'complete'); assert.equal(end.x, 0); assert.equal(end.elapsedMin, 50);
  assert.equal(replayPosition(result.scenario, result.optimal, -1).elapsedMin, 0);
});
test('empty and zero-travel tours never produce non-finite marker positions', () => {
  for (const day of [{ startTime: '09:00', stops: [] }, { startTime: '09:00', stops: [{ id: 'one', name: 'At base', x: 0, y: 0 }] }]) {
    const result = solveOptimal(day);
    const position = replayPosition(result.scenario, result.optimal, NaN);
    assert.ok(Number.isFinite(position.x) && Number.isFinite(position.y));
  }
});
