import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeScenario, evaluateOrder } from '../js/planner.mjs';
import { validateTour } from '../js/studio.mjs';
import { buildLabReport, verifyStamped, csvCell, exportProofMarkdown, createProofCache } from '../js/bnb-lab.js';
import { createMapProjection } from '../js/map.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = fs.readFileSync(path.join(ROOT, 'js/app.js'), 'utf8');
const labApp = fs.readFileSync(path.join(ROOT, 'js/lab-app.js'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');

function oneStopDay(stopPatch = {}) {
  return {
    id: 'edge-day', title: 'Edge day', mode: 'bike', metric: 'manhattan', startTime: '10:00',
    anchor: { name: 'Base', x: 0, y: 0 },
    stops: [{ id: 'a', name: 'Errand', x: 0.5, y: 0.5, durationMin: 10, windowStart: '10:00', windowEnd: '12:00', priority: 2, category: 'errand', dependsOn: null, ...stopPatch }],
  };
}

test('normalization rejects malformed numeric window minute fields', () => {
  for (const patch of [
    { windowStart: undefined, windowStartMin: Number.NaN },
    { windowStart: undefined, windowStartMin: -1 },
    { windowStart: undefined, windowStartMin: 1440 },
    { windowEnd: undefined, windowEndMin: Number.POSITIVE_INFINITY },
    { windowEnd: undefined, windowEndMin: 2000 },
    { windowStart: undefined, windowStartMin: 'bad' },
  ]) {
    assert.throws(() => normalizeScenario(oneStopDay(patch)), /Clock minutes|Out-of-range|Invalid clock/);
  }
});

test('order evaluation rejects malformed order containers before reading them', () => {
  const scenario = normalizeScenario(oneStopDay());
  for (const bad of [null, undefined, 'a', 7, { 0: 'a', length: 1 }]) {
    assert.throws(() => evaluateOrder(scenario, bad), /Order must be an array of stop ids/);
  }
});

test('proof cache hits cannot carry caller mutations into later verified exports', () => {
  const day = validateTour(oneStopDay());
  const first = buildLabReport(day);
  const originalTravel = first.proof.comparator[0].rows[0].totalTravelMin;
  first.proof.comparator[0].rows[0].totalTravelMin = originalTravel + 1;
  const second = buildLabReport(day);
  assert.equal(second.digest, first.digest);
  assert.equal(second.proof.comparator[0].rows[0].totalTravelMin, originalTravel);
  assert.equal(verifyStamped(second.stamped).ok, true);
});

test('CSV formula hardening covers whitespace-prefixed and control-prefixed triggers', () => {
  assert.equal(csvCell('  =2+2'), "'  =2+2");
  assert.equal(csvCell('\t=HYPERLINK()'), '"\'\t=HYPERLINK()"');
  assert.equal(csvCell('\r@cmd'), '"\'\r@cmd"');
});

test('Markdown proof escapes pipe characters in user-controlled day titles', () => {
  const day = validateTour({ ...oneStopDay(), title: 'Family | errands' });
  const report = buildLabReport(day);
  const markdown = exportProofMarkdown(report.stamped);
  assert.ok(markdown.includes('Family \\| errands'));
});

test('lab comparator exposes native keyboard-operable row buttons instead of focusable plain rows', () => {
  assert.ok(!labApp.includes('tr.tabIndex = 0'));
  assert.ok(labApp.includes("'lab-row-select'"));
  assert.ok(labApp.includes("button.type = 'button'"));
  assert.ok(css.includes('.lab-row-select'));
});

test('studio jitter chart points are focusable buttons with keyboard selection and visible focus', () => {
  assert.ok(app.includes("role: 'button'") && app.includes("'data-delay': point.delayMin"));
  assert.ok(app.includes("ui.jitterChart.addEventListener('keydown'"));
  assert.ok(app.includes('ArrowRight') && app.includes('ArrowLeft'));
  assert.ok(css.includes('.chart-point:focus-visible'));
});

test('closing the print dialog returns keyboard focus to the print control', () => {
  assert.ok(app.includes("ui.printDialog.addEventListener('close'"));
  assert.ok(app.includes('ui.print.focus'));
});

test('interactive SVG charts are exposed as groups and selectable controls expose pressed state', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  for (const id of ['jitter-chart', 'lab-tip-chart', 'lab-mode-chart']) {
    assert.ok(html.includes('id="' + id + '"') && !new RegExp('id="' + id + '"[^>]*role="img"').test(html));
  }
  assert.ok(app.includes("'aria-pressed': String(point.delayMin === delay)"));
  assert.ok(labApp.includes("'aria-pressed': String(point.delayMin === state.delay)"));
  assert.ok(labApp.includes("'aria-pressed': String(entry.modeId === state.mode)"));
  assert.ok(labApp.includes('button.setAttribute(\'aria-pressed\', String(mode.modeId === state.mode && row.strategyId === state.strategy))'));
});

test('normalized-looking objects cannot bypass validation in evaluation or map projection', () => {
  const scenario = normalizeScenario(oneStopDay());
  const badStop = { ...scenario, stops: [{ ...scenario.stops[0], durationMin: 0 }] };
  assert.throws(() => evaluateOrder(badStop, ['a']), /Service duration/);
  const badAnchor = { ...scenario, anchor: { ...scenario.anchor, x: Number.NaN } };
  assert.throws(() => createMapProjection(badAnchor), /Anchor x/);
  assert.doesNotThrow(() => evaluateOrder(structuredClone(scenario), ['a']));
});

test('proof cache hits cannot carry caller mutations to integrity metadata', () => {
  const cache = createProofCache();
  const day = validateTour(oneStopDay());
  const first = buildLabReport(day, { cache });
  const originalDigest = first.digest;
  assert.throws(() => { first.stamped.integrity.digest = '0'.repeat(64); }, TypeError);
  const second = buildLabReport(day, { cache });
  assert.equal(second.digest, originalDigest);
  assert.equal(verifyStamped(second.stamped).ok, true);
});

test('verification fails when integrity metadata no longer names the actual proof scheme', () => {
  const report = buildLabReport(validateTour(oneStopDay()));
  for (const patch of [{ algorithm: 'SHA-1' }, { canonical: 'pretty-json' }]) {
    const dirty = structuredClone(report.stamped);
    Object.assign(dirty.integrity, patch);
    assert.equal(verifyStamped(dirty).ok, false);
  }
});

test('Markdown proof labels a negative minimum margin as lateness', () => {
  const day = validateTour(oneStopDay({ x: 0, y: 0, durationMin: 10, windowEnd: '10:05' }));
  const report = buildLabReport(day);
  const markdown = exportProofMarkdown(report.stamped);
  assert.ok(markdown.includes('5 min late'));
  assert.ok(!markdown.includes('-5 min'));
});

test('unselected lab mode groups keep a visible keyboard focus indicator', () => {
  assert.ok(css.includes('.lab-mode-group:focus-visible .lab-mode-hit'));
  assert.ok(css.includes('stroke: var(--green)'));
});

test('normalized scenarios are immutable solver inputs', () => {
  const scenario = normalizeScenario(oneStopDay());
  assert.throws(() => { scenario.stops[0].durationMin = 0; }, TypeError);
  assert.throws(() => { scenario.anchor.x = Number.NaN; }, TypeError);
  assert.throws(() => { scenario.transitJitterMin = 99; }, TypeError);
  assert.equal(evaluateOrder(scenario, ['a']).totalServiceMin, 10);
});
