import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const narration = fs.readFileSync(new URL('../video/narration.txt', import.meta.url), 'utf8');
const steps = JSON.parse(fs.readFileSync(new URL('../video/steps.json', import.meta.url), 'utf8'));
test('demo narration has 310 to 350 honest, plain-punctuation words', () => {
  assert.equal(narration.trim().split(/\s+/).length, 321);
  assert.ok(narration.includes('134 minutes')); assert.ok(narration.includes('78 minutes'));
  assert.ok(narration.includes('45 small tours')); assert.ok(narration.includes('28.1 percent'));
  assert.ok(!/[\u2013\u2014\u2018\u2019\u201c\u201d]/u.test(narration));
});
test('video steps match the recorder schema, stay local, and cover all required scenes in 138 seconds', () => {
  const allowed = new Set(['at', 'wait', 'scrollTo', 'scrollBy', 'move', 'click', 'slide', 'type', 'select', 'key', 'eval']);
  for (const step of steps) {
    assert.ok(allowed.has(step.do));
    if (['click', 'move', 'slide', 'type', 'select', 'scrollTo'].includes(step.do)) assert.equal(typeof step.selector, 'string');
    if (step.do === 'slide') assert.ok(Number.isFinite(step.to));
    if (step.do === 'eval') assert.ok(!/\b(?:fetch|WebSocket|location\.href|window\.open)\b/.test(step.js));
  }
  const marks = steps.filter((step) => step.do === 'at').map((step) => step.s);
  assert.ok(marks.every((value, index) => index === 0 || value >= marks[index - 1]));
  assert.equal(marks.at(-1), 138);
  for (const selector of ['#fifo-toggle', '#replay-play', '#replay-step', '#replay-slider', '#stop-name', '#btn-save-stop', '#jitter-slider', '#btn-export-ics', '#btn-print', '#btn-bench-mobile', '#capybara-buddy']) assert.ok(steps.some((step) => step.selector === selector), selector);
});
test('the one-page daily card has an accessible modal preview and a real native print action', () => {
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const app = fs.readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
  assert.ok(html.includes('<dialog id="print-dialog"'));
  assert.ok(html.includes('aria-labelledby="card-dialog-title"'));
  assert.ok(app.includes('ui.printDialog.showModal()'));
  assert.ok(app.includes("ui.printCard.addEventListener('click', () => window.print())"));
  assert.ok(app.includes('card.removeAttribute'));
  const css = fs.readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
  assert.ok(css.includes('.print-only .data-table th:first-child { width: 38%; }'));
  assert.ok(css.includes('text-overflow: ellipsis'));
});
