import { formatMinToClock, buildIcsCalendar, compareSchedules } from './planner.mjs?v=studio-c49dfe94a109';
import { STUDIO_PRESETS } from './presets.mjs?v=studio-c49dfe94a109';
import { validateTour, addStop, editStop, deleteStop, createHistory, createAnalyzer, encodeTourHash, decodeTourHash, readStoredTour, writeStoredTour, MAX_STOPS } from './studio.mjs?v=studio-c49dfe94a109';
import { createMapProjection, layoutMapPins, routePoints, replayPosition, nextReplayStep } from './map.mjs?v=studio-c49dfe94a109';
import { runBenchmarkSuite } from './benchmark.mjs?v=studio-c49dfe94a109';

const ui = {
  preset: document.getElementById('preset-select'), mode: document.getElementById('mode-select'),
  daySettings: document.getElementById('day-settings'), settingsSummary: document.getElementById('day-settings-summary'),
  metric: document.getElementById('metric-select'), start: document.getElementById('start-time'),
  return: document.getElementById('return-toggle'), undo: document.getElementById('btn-undo'),
  redo: document.getElementById('btn-redo'), reset: document.getElementById('btn-reset-preset'),
  minutes: document.getElementById('minutes-saved'), travelVerdict: document.getElementById('travel-verdict'),
  deadlines: document.getElementById('deadlines-saved'), deadlineDenominator: document.getElementById('deadline-denominator'),
  deadlineVerdict: document.getElementById('deadline-verdict'), finish: document.getElementById('finish-time'),
  finishLabel: document.getElementById('finish-label'), feasible: document.getElementById('feasible-badge'),
  span: document.getElementById('span-verdict'), error: document.getElementById('solver-error'),
  method: document.getElementById('solver-method'), fifoMetric: document.getElementById('fifo-map-metric'),
  optimalMetric: document.getElementById('optimal-map-metric'), fifoToggle: document.getElementById('fifo-toggle'),
  map: document.getElementById('route-svg'), coordinates: document.getElementById('map-coordinates'),
  play: document.getElementById('replay-play'), step: document.getElementById('replay-step'),
  restart: document.getElementById('replay-reset'), replaySlider: document.getElementById('replay-slider'),
  replayClock: document.getElementById('replay-clock'), replayStatus: document.getElementById('replay-status'),
  timeline: document.getElementById('timeline-list'), timelineAxis: document.getElementById('timeline-axis'),
  timelineSpan: document.getElementById('timeline-window-span'), returnSummary: document.getElementById('return-summary'),
  modes: document.getElementById('mode-buttons'), jitterSlider: document.getElementById('jitter-slider'),
  jitterValue: document.getElementById('jitter-value'), jitterTip: document.getElementById('jitter-tipping'),
  jitterMargin: document.getElementById('jitter-current-margin'), jitterChart: document.getElementById('jitter-chart'),
  jitterExactness: document.getElementById('jitter-exactness'), jitterTable: document.getElementById('jitter-table'),
  compareBody: document.getElementById('compare-tbody'), add: document.getElementById('btn-add-stop'),
  stops: document.getElementById('stops-list'), count: document.getElementById('stop-count'),
  inspector: document.getElementById('stop-inspector'), inspectorId: document.getElementById('inspector-stop-id'),
  form: document.getElementById('stop-form'), name: document.getElementById('stop-name'),
  x: document.getElementById('stop-x'), y: document.getElementById('stop-y'),
  open: document.getElementById('stop-open'), close: document.getElementById('stop-close'),
  duration: document.getElementById('stop-duration'), priority: document.getElementById('stop-priority'),
  prerequisite: document.getElementById('stop-prerequisite'), delete: document.getElementById('btn-delete-stop'),
  inspectorFeedback: document.getElementById('inspector-feedback'), empty: document.getElementById('empty-editor'),
  capy: document.getElementById('capybara-buddy'), capyMessage: document.getElementById('capybara-message'),
  compute: document.getElementById('compute-status'), theme: document.getElementById('theme-toggle'),
  share: document.getElementById('btn-share'), sharePanel: document.getElementById('share-panel'),
  shareUrl: document.getElementById('share-url'), copy: document.getElementById('btn-copy-link'),
  closeShare: document.getElementById('btn-close-share'), date: document.getElementById('export-date'),
  exportIcs: document.getElementById('btn-export-ics'), exportJson: document.getElementById('btn-export-json'),
  print: document.getElementById('btn-print'), exportStatus: document.getElementById('export-status'),
  dailyCard: document.getElementById('daily-card'), bench: document.getElementById('btn-run-bench'),
  printDialog: document.getElementById('print-dialog'), cardPreview: document.getElementById('card-preview'),
  printCard: document.getElementById('btn-print-card'), closeCard: document.getElementById('btn-close-card'),
  benchMobile: document.getElementById('btn-bench-mobile'), benchPanel: document.getElementById('benchmark-panel'),
  benchSummary: document.getElementById('benchmark-summary'), benchBars: document.getElementById('benchmark-bars'),
  benchBody: document.getElementById('benchmark-tbody'), closeBench: document.getElementById('btn-close-bench'),
  save: document.getElementById('save-status'), announcement: document.getElementById('live-announcement'),
};
const state = {
  tour: null, history: null, selectedId: null, analysis: null, projection: null,
  worker: null, requestId: 0, watchdog: null, execution: 'Web Worker',
  elapsed: 0, playing: false, frame: null, lastTick: 0, busy: false,
  marker: null, timelineEnd: 0, buddyFound: false, buddyKey: null,
  smallSettings: window.innerWidth <= 600,
};
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const analyzeFallback = createAnalyzer();
let storage;
try { storage = window.localStorage; } catch { storage = { getItem: () => null, setItem: () => { throw new Error('Storage unavailable'); } }; }

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text != null) element.textContent = String(text);
  return element;
}
function svgNode(tag, attributes = {}, text) {
  const element = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
  if (text != null) element.textContent = String(text);
  return element;
}
function announce(message) { ui.announcement.textContent = message; }
function errorMessage(error) {
  ui.error.textContent = error.message || String(error);
  ui.error.hidden = false;
  announce(ui.error.textContent);
}
function clearError() { ui.error.hidden = true; ui.error.textContent = ''; }
function clockLabel(minutes) {
  const days = Math.floor(minutes / 1440);
  return formatMinToClock(minutes) + (days > 0 ? ' (+' + days + ' day)' : '');
}
function methodLabel(method) {
  if (method === 'exact' || method === 'exact-bnb') return 'Exact Branch-and-Bound';
  return method === 'bounded-bnb' ? 'Bounded search / best found' : 'Heuristic / best found';
}
function option(value, text, disabled = false) {
  const element = node('option', null, text);
  element.value = value; element.disabled = disabled;
  return element;
}
function synchronizeControls() {
  ui.preset.value = STUDIO_PRESETS.some((preset) => preset.id === state.tour.id) ? state.tour.id : 'custom';
  ui.mode.value = state.tour.mode; ui.metric.value = state.tour.metric;
  ui.start.value = state.tour.startTime; ui.return.checked = state.tour.returnToAnchor;
  ui.settingsSummary.textContent = state.tour.startTime + ' / ' + ui.mode.selectedOptions[0].textContent;
  ui.jitterSlider.value = state.tour.transitJitterMin;
  ui.jitterValue.textContent = '+' + state.tour.transitJitterMin + ' min';
  ui.undo.disabled = !state.history.canUndo; ui.redo.disabled = !state.history.canRedo;
  ui.add.disabled = state.tour.stops.length >= MAX_STOPS;
  ui.count.textContent = state.tour.stops.length + ' / ' + MAX_STOPS + ' stops';
  for (const button of ui.modes.querySelectorAll('button[data-mode]')) {
    const active = button.dataset.mode === state.tour.mode;
    button.classList.toggle('is-active', active); button.setAttribute('aria-pressed', String(active));
  }
}
function persist() {
  ui.save.textContent = writeStoredTour(storage, state.tour) ? 'Saved on this browser.' : 'Storage unavailable. You can still share or export your day.';
  if (location.hash.startsWith('#tour=')) history.replaceState(null, '', encodeTourHash(state.tour));
  if (!ui.sharePanel.hidden) ui.shareUrl.value = location.href.split('#')[0] + encodeTourHash(state.tour);
}
function commit(raw, selectedId = state.selectedId, refreshInspector = true) {
  try {
    const next = validateTour(raw);
    if (!state.history.apply(next)) return;
    state.tour = state.history.current;
    state.selectedId = state.tour.stops.some((stop) => stop.id === selectedId) ? selectedId : state.tour.stops[0]?.id ?? null;
    clearError(); pauseReplay(); synchronizeControls(); renderStops();
    if (refreshInspector) renderInspector();
    persist(); requestAnalysis();
  } catch (error) { errorMessage(error); synchronizeControls(); }
}
function travelAt(coordinates) {
  try {
    const added = addStop(state.tour, coordinates);
    commit(added.tour, added.stopId);
    focusInspector(true);
    announce('Errand added. Edit its name and opening window.');
  } catch (error) { errorMessage(error); }
}
function selectStop(id, focus = false) {
  if (!state.tour.stops.some((stop) => stop.id === id)) return;
  state.selectedId = id;
  renderStops(); renderInspector(); highlightSelection();
  if (focus) focusInspector(false);
}
function focusInspector(nameFocus) {
  if (window.innerWidth <= 980) ui.inspector.scrollIntoView({ block: 'center', behavior: 'auto' });
  if (nameFocus) { ui.name.focus({ preventScroll: true }); ui.name.select(); }
}
function highlightSelection() {
  for (const pin of ui.map.querySelectorAll('.map-pin')) pin.classList.toggle('pin-selected', pin.dataset.stopId === state.selectedId);
  for (const row of ui.timeline.querySelectorAll('.timeline-row')) row.classList.toggle('is-selected', row.dataset.stopId === state.selectedId);
}
function renderStops() {
  const legs = new Map((state.analysis?.solution.optimal.legTimeline ?? []).map((leg) => [leg.stopId, leg]));
  ui.stops.replaceChildren();
  for (const [index, stop] of state.tour.stops.entries()) {
    const button = node('button', 'stop-item' + (stop.id === state.selectedId ? ' is-selected' : ''));
    button.type = 'button'; button.dataset.stopId = stop.id;
    button.setAttribute('aria-pressed', String(stop.id === state.selectedId));
    button.setAttribute('aria-label', 'Edit ' + stop.name);
    const copy = node('span', 'stop-copy');
    copy.append(node('strong', null, stop.name), node('span', null, stop.windowStart + ' to ' + stop.windowEnd + ' / ' + stop.durationMin + ' min'));
    const dot = node('span', 'stop-state' + (legs.get(stop.id)?.onTime === false ? ' is-late' : ''));
    dot.setAttribute('aria-hidden', 'true');
    button.append(node('span', 'stop-order', index + 1), copy, dot);
    ui.stops.append(button);
  }
}
function renderInspector() {
  const stop = state.tour.stops.find((item) => item.id === state.selectedId);
  ui.inspector.hidden = !stop; ui.empty.hidden = Boolean(stop);
  if (!stop) return;
  ui.inspectorId.textContent = stop.id;
  ui.name.value = stop.name; ui.x.value = stop.x; ui.y.value = stop.y;
  ui.open.value = stop.windowStart; ui.close.value = stop.windowEnd;
  ui.duration.value = stop.durationMin; ui.priority.value = stop.priority;
  ui.prerequisite.replaceChildren(option('', 'No prerequisite'));
  for (const candidate of state.tour.stops) {
    if (candidate.id === stop.id) continue;
    let cyclic = false;
    try { editStop(state.tour, stop.id, { dependsOn: candidate.id }); } catch { cyclic = true; }
    ui.prerequisite.append(option(candidate.id, candidate.name + (cyclic ? ' (would create cycle)' : ''), cyclic));
  }
  ui.prerequisite.value = stop.dependsOn ?? '';
  ui.inspectorFeedback.textContent = 'Changes are applied when you save.';
  ui.inspectorFeedback.classList.remove('is-error');
}
function setBusy(busy) {
  state.busy = busy; document.documentElement.dataset.solving = String(busy);
  ui.map.setAttribute('aria-busy', String(busy));
  for (const button of [ui.play, ui.step, ui.restart, ui.exportIcs, ui.exportJson, ui.print]) button.disabled = busy || !state.analysis;
  ui.replaySlider.disabled = busy || !state.analysis;
  if (busy) { ui.method.textContent = 'Updating route'; ui.compute.textContent = 'Solving your route and all 16 delay points locally...'; }
}
function acceptAnalysis(message) {
  if (message.id !== state.requestId) return;
  clearTimeout(state.watchdog); state.watchdog = null;
  if (message.error) { setBusy(false); errorMessage(new Error(message.error)); return; }
  state.analysis = message.result; state.elapsed = 0;
  setBusy(false); renderSummary(); renderStops(); renderMap(); renderTimeline();
  renderModes(); renderJitter(); renderComparison(); renderDailyCard(); updateReplay(); reactCapybara();
  ui.compute.textContent = state.execution + ' / ' + methodLabel(state.analysis.solution.method) + ' / no external routing';
  announce('Route updated. ' + state.analysis.solution.optimal.missedDeadlines + ' missed deadlines.');
}
function fallbackWorker() {
  clearTimeout(state.watchdog);
  state.worker?.terminate(); state.worker = null; state.execution = 'Main thread fallback';
  const id = state.requestId, tour = state.tour;
  setTimeout(() => {
    if (id !== state.requestId) return;
    try { acceptAnalysis({ id, result: analyzeFallback(tour) }); }
    catch (error) { acceptAnalysis({ id, error: error.message }); }
  }, 0);
}
function requestAnalysis() {
  pauseReplay(); state.requestId += 1; setBusy(true);
  if (state.worker) {
    state.worker.postMessage({ id: state.requestId, tour: state.tour });
    clearTimeout(state.watchdog);
    state.watchdog = setTimeout(fallbackWorker, 15000);
  } else { fallbackWorker(); }
}
function renderSummary() {
  const result = state.analysis.solution, schedule = result.optimal, fifo = result.baselines.fifo;
  const saved = fifo.totalTravelMin - schedule.totalTravelMin;
  const spanSaved = fifo.totalSpanMin - schedule.totalSpanMin;
  ui.minutes.textContent = saved;
  ui.travelVerdict.textContent = fifo.totalTravelMin + ' to ' + schedule.totalTravelMin + ' min travel vs FIFO';
  ui.deadlines.textContent = fifo.missedDeadlines - schedule.missedDeadlines;
  ui.deadlineDenominator.textContent = '/ ' + state.tour.stops.length;
  ui.deadlineVerdict.textContent = fifo.missedDeadlines + ' missed to ' + schedule.missedDeadlines + ' missed';
  ui.finishLabel.textContent = state.tour.returnToAnchor ? 'Back at base' : 'Last errand done';
  ui.finish.textContent = clockLabel(schedule.endMin);
  ui.feasible.textContent = schedule.feasible ? 'All on time' : schedule.missedDeadlines + ' missed';
  ui.feasible.classList.toggle('is-late', !schedule.feasible);
  ui.span.textContent = spanSaved >= 0 ? spanSaved + ' min earlier than FIFO' : Math.abs(spanSaved) + ' min later than FIFO';
  ui.method.textContent = methodLabel(result.method);
  ui.fifoMetric.textContent = fifo.totalTravelMin + ' min travel / ' + fifo.missedDeadlines + ' missed';
  ui.optimalMetric.textContent = schedule.totalTravelMin + ' min travel / ' + schedule.missedDeadlines + ' missed';
}
function pathData(points, projection) {
  return points.map((point, index) => {
    const p = projection.project(point);
    return (index ? 'L' : 'M') + p.x.toFixed(2) + ' ' + p.y.toFixed(2);
  }).join(' ');
}
function renderMap() {
  if (!state.analysis) return;
  const small = window.innerWidth <= 600;
  const width = small ? 420 : 900, height = small ? 380 : 430;
  const projection = createMapProjection(state.analysis.solution.scenario, width, height, small ? 35 : 55);
  state.projection = projection;
  ui.map.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
  ui.map.replaceChildren(svgNode('title', {}, 'Before FIFO vs LoopLess optimized route'), svgNode('desc', {}, 'Synthetic mile offsets. Dashed path is FIFO. Solid path is LoopLess. Each numbered pin opens the errand inspector.'));
  const grid = svgNode('g', { 'aria-hidden': 'true' });
  for (let x = projection.minX; x <= projection.maxX; x += 1) {
    const a = projection.project({ x, y: projection.minY }), b = projection.project({ x, y: projection.maxY });
    grid.append(svgNode('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: x === 0 ? 'axis-line' : 'grid-line' }));
    grid.append(svgNode('text', { x: a.x, y: a.y + 22, class: 'grid-label', 'text-anchor': 'middle' }, x));
  }
  for (let y = projection.minY; y <= projection.maxY; y += 1) {
    const a = projection.project({ x: projection.minX, y }), b = projection.project({ x: projection.maxX, y });
    grid.append(svgNode('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: y === 0 ? 'axis-line' : 'grid-line' }));
    grid.append(svgNode('text', { x: a.x - 14, y: a.y + 4, class: 'grid-label', 'text-anchor': 'end' }, y));
  }
  grid.append(svgNode('text', { x: width - 15, y: height - 8, class: 'axis-caption', 'text-anchor': 'end' }, 'mile offsets'));
  ui.map.append(grid);
  const result = state.analysis.solution;
  const before = svgNode('path', { id: 'fifo-path', class: 'fifo-route', d: pathData(routePoints(result.scenario, result.baselines.fifo), projection), 'aria-hidden': 'true' });
  before.style.display = ui.fifoToggle.checked ? '' : 'none';
  const optimalD = pathData(routePoints(result.scenario, result.optimal), projection);
  ui.map.append(before, svgNode('path', { class: 'optimal-halo', d: optimalD, 'aria-hidden': 'true' }), svgNode('path', { id: 'optimal-path', class: 'optimal-route', d: optimalD, 'aria-hidden': 'true' }));
  const homePoint = projection.project(result.scenario.anchor);
  const home = svgNode('g', { transform: 'translate(' + homePoint.x + ',' + homePoint.y + ')', 'data-anchor': 'true', 'aria-hidden': 'true' });
  home.append(svgNode('rect', { x: -12, y: -12, width: 24, height: 24, rx: 6, class: 'home-pin' }), svgNode('path', { d: 'M-6 0L0-5L6 0V6H2V2H-2V6H-6Z', class: 'home-icon' }), svgNode('text', { x: 0, y: 30, class: 'pin-label', 'text-anchor': 'middle' }, result.scenario.anchor.name));
  ui.map.append(home);
  const legs = new Map(result.optimal.legTimeline.map((leg) => [leg.stopId, leg]));
  const orderedStops = result.optimal.orderIds.map((id) => result.scenario.stops.find((stop) => stop.id === id));
  const pinPositions = layoutMapPins(orderedStops, projection, small ? 60 : 52, result.scenario.anchor);
  for (const [index, stopId] of result.optimal.orderIds.entries()) {
    const stop = orderedStops[index], p = pinPositions[index];
    if (p.moved) ui.map.append(svgNode('line', { x1: p.realX, y1: p.realY, x2: p.x, y2: p.y, class: 'pin-leader', 'aria-hidden': 'true' }), svgNode('circle', { cx: p.realX, cy: p.realY, r: 3, class: 'pin-location', 'aria-hidden': 'true' }));
    const pin = svgNode('g', { class: 'map-pin' + (stopId === state.selectedId ? ' pin-selected' : '') + (!legs.get(stopId).onTime ? ' pin-late' : ''), transform: 'translate(' + p.x + ',' + p.y + ')', role: 'button', tabindex: 0, 'data-stop-id': stopId, 'aria-label': 'Edit ' + stop.name + ', optimized stop ' + (index + 1) });
    pin.append(svgNode('title', {}, stop.name + ' / ' + clockLabel(legs.get(stopId).serviceStartMin)), svgNode('circle', { r: small ? 28 : 23, class: 'pin-hit' }), svgNode('circle', { r: small ? 16 : 14, class: 'pin-circle' }), svgNode('text', { x: 0, y: 0, class: 'pin-number' }, index + 1));
    const right = p.x < width * .6;
    ui.map.append(pin);
    ui.map.append(svgNode('text', { x: p.x + (right ? 22 : -22), y: p.y + (index % 2 ? 22 : -18), 'text-anchor': right ? 'start' : 'end', class: 'pin-label', 'aria-hidden': 'true' }, stop.name));
  }
  state.marker = svgNode('g', { id: 'route-commuter', class: 'commuter', 'aria-hidden': 'true' });
  state.marker.append(svgNode('circle', { r: small ? 11 : 10, class: 'commuter-halo' }), svgNode('path', { d: 'M-3-5L5 0L-3 5V2H-6V-2H-3Z', class: 'commuter-icon' }));
  ui.map.append(state.marker);
  updateReplay();
}
function renderTimeline() {
  const schedule = state.analysis.solution.optimal;
  state.timelineEnd = Math.max(schedule.endMin + 5, ...schedule.legTimeline.map((leg) => leg.windowEndMin));
  const start = schedule.startMin, span = Math.max(1, state.timelineEnd - start);
  const percent = (time) => Math.max(0, Math.min(100, (time - start) / span * 100));
  ui.timelineSpan.textContent = clockLabel(start) + ' to ' + clockLabel(schedule.endMin);
  ui.timelineAxis.replaceChildren(...[0, .5, 1].map((part) => node('span', null, clockLabel(start + span * part))));
  ui.timeline.replaceChildren();
  for (const leg of schedule.legTimeline) {
    const row = node('div', 'timeline-row'); row.dataset.stopId = leg.stopId;
    const button = node('button', 'timeline-stop'); button.type = 'button'; button.dataset.stopId = leg.stopId;
    button.append(node('strong', null, leg.name), node('span', null, clockLabel(leg.serviceStartMin) + ' / ' + (leg.onTime ? leg.slackMin + ' min margin' : leg.latenessMin + ' min late')));
    const track = node('div', 'gantt-track');
    function block(className, begin, end) {
      if (end <= begin) return;
      const bar = node('span', className);
      bar.style.left = percent(begin) + '%'; bar.style.width = Math.max(0, percent(end) - percent(begin)) + '%';
      track.append(bar);
    }
    block('gantt-window', leg.windowStartMin, leg.windowEndMin);
    block('gantt-block gantt-travel', leg.departMin, leg.arrivalMin);
    block('gantt-block gantt-wait', leg.arrivalMin, leg.serviceStartMin);
    block('gantt-block gantt-service' + (!leg.onTime ? ' gantt-late' : ''), leg.serviceStartMin, leg.finishMin);
    const closing = node('span', 'gantt-closing'); closing.style.left = percent(leg.windowEndMin) + '%';
    const playhead = node('span', 'gantt-playhead');
    if (!ui.timeline.children.length) playhead.id = 'timeline-playhead';
    playhead.setAttribute('aria-hidden', 'true');
    track.append(closing, playhead); row.append(button, track); ui.timeline.append(row);
  }
  if (!schedule.legTimeline.length) ui.timeline.append(node('p', 'model-note', 'No errands yet. Add a stop to begin.'));
  ui.returnSummary.textContent = !schedule.legTimeline.length ? 'No errands yet / staying at base.' : schedule.returnLeg ? 'Return to ' + state.tour.anchor.name + ' / ' + schedule.returnLeg.travelMin + ' min / arrives ' + clockLabel(schedule.endMin) : 'One-way day / finishes at the final errand.';
  ui.replaySlider.max = Math.max(1, schedule.totalSpanMin);
  highlightSelection(); updateReplay();
}
function renderModes() {
  ui.modes.replaceChildren();
  for (const mode of state.analysis.modes) {
    const button = node('button', 'mode-card' + (mode.id === state.tour.mode ? ' is-active' : ''));
    button.type = 'button'; button.dataset.mode = mode.id; button.setAttribute('aria-pressed', String(mode.id === state.tour.mode));
    button.append(node('span', null, mode.label), node('strong', null, mode.travelMin + ' min'), node('small', !mode.feasible ? 'late-note' : '', mode.onTime + '/' + state.tour.stops.length + ' on time / ' + mode.spanMin + ' min day'));
    button.setAttribute('aria-label', mode.label + ', ' + mode.travelMin + ' minutes travel, ' + mode.onTime + ' errands on time');
    ui.modes.append(button);
  }
}
function renderJitter() {
  const { sweep } = state.analysis, delay = state.tour.transitJitterMin;
  const points = sweep.points, current = points[delay];
  if (!state.tour.stops.length) ui.jitterTip.textContent = 'Add an errand to measure delay tolerance.';
  else if (sweep.firstBreakMin === null) ui.jitterTip.textContent = 'All deadlines hold through +15 min per leg.';
  else if (sweep.firstBreakMin === 0) ui.jitterTip.textContent = 'Already overloaded at +0 min. A deadline is missed.';
  else ui.jitterTip.textContent = 'First deadline breaks at +' + sweep.firstBreakMin + ' min per leg.';
  if (!sweep.exact) ui.jitterTip.textContent = 'Best-found sweep / ' + (sweep.firstBreakMin === null ? 'no observed break through +15 min.' : 'observed break at +' + sweep.firstBreakMin + ' min.');
  ui.jitterMargin.textContent = 'Current tightest margin / ' + current.minSlackMin + ' min';
  ui.jitterExactness.textContent = sweep.exact ? 'Exact / 16 delay points' : 'Bounded / 16 delay points';
  ui.jitterChart.setAttribute('aria-label', ui.jitterTip.textContent + ' Minimum closing-time margin versus delay.');
  const small = window.innerWidth <= 600, width = small ? 420 : 680, height = 190;
  ui.jitterChart.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
  const left = 48, right = width - 20, top = 26, bottom = 150;
  const min = Math.min(-5, ...points.map((point) => point.minSlackMin));
  const max = Math.max(10, ...points.map((point) => point.minSlackMin));
  const x = (value) => left + value / 15 * (right - left), y = (value) => bottom - (value - min) / (max - min) * (bottom - top);
  ui.jitterChart.replaceChildren(svgNode('title', {}, ui.jitterTip.textContent));
  for (const tick of [min, 0, max]) {
    ui.jitterChart.append(svgNode('line', { x1: left, x2: right, y1: y(tick), y2: y(tick), class: tick === 0 ? 'chart-zero' : 'grid-line' }), svgNode('text', { x: left - 9, y: y(tick) + 4, class: 'chart-label', 'text-anchor': 'end' }, tick));
  }
  ui.jitterChart.append(svgNode('text', { x: left, y: 13, class: 'chart-label' }, 'deadline margin / min'));
  ui.jitterChart.append(svgNode('path', { d: points.map((point, index) => (index ? 'L' : 'M') + x(point.delayMin) + ' ' + y(point.minSlackMin)).join(' '), class: 'chart-curve' }));
  if (sweep.firstBreakMin !== null) ui.jitterChart.append(svgNode('line', { x1: x(sweep.firstBreakMin), x2: x(sweep.firstBreakMin), y1: top, y2: bottom, class: 'chart-tip-line' }));
  for (const point of points) {
    const dot = svgNode('circle', { cx: x(point.delayMin), cy: y(point.minSlackMin), r: point.delayMin === delay ? 5 : 3.3, class: 'chart-point' + (point.missedDeadlines ? ' is-broken' : '') + (point.delayMin === delay ? ' is-current' : ''), 'data-delay': point.delayMin });
    dot.append(svgNode('title', {}, '+' + point.delayMin + ' min delay / ' + point.missedDeadlines + ' missed / ' + point.minSlackMin + ' min margin'));
    ui.jitterChart.append(dot);
  }
  for (const value of [0, 5, 10, 15]) ui.jitterChart.append(svgNode('text', { x: x(value), y: 174, class: 'chart-label', 'text-anchor': 'middle' }, '+' + value));
  const table = node('table', 'data-table');
  const head = node('thead'), row = node('tr');
  for (const text of ['Delay / leg', 'On time', 'Min margin', 'Search']) { const cell = node('th', null, text); cell.scope = 'col'; row.append(cell); }
  head.append(row); const body = node('tbody');
  for (const point of points) appendCells(body, ['+' + point.delayMin + ' min', state.tour.stops.length - point.missedDeadlines + '/' + state.tour.stops.length, point.minSlackMin + ' min', point.method === 'exact-bnb' || point.method === 'exact' ? 'Exact' : 'Bounded']);
  table.append(head, body); ui.jitterTable.replaceChildren(table);
}
function appendCells(parent, values, className = '') {
  const row = node('tr', className);
  for (const value of values) row.append(node('td', null, value));
  parent.append(row); return row;
}
function renderComparison() {
  const result = state.analysis.solution;
  ui.compareBody.replaceChildren();
  for (const [label, schedule] of [['LoopLess', result.optimal], ['Listed order (FIFO)', result.baselines.fifo], ['Earliest deadline', result.baselines.edf], ['Nearest neighbor', result.baselines.nearest]]) appendCells(ui.compareBody, [label, state.tour.stops.length - schedule.missedDeadlines + '/' + state.tour.stops.length, schedule.totalTravelMin + ' min', schedule.totalWaitMin + ' min', schedule.totalSpanMin + ' min'], label === 'LoopLess' ? 'is-optimal' : '');
}
function updateReplay() {
  if (!state.analysis || !state.projection) return;
  const schedule = state.analysis.solution.optimal;
  const position = replayPosition(state.analysis.solution.scenario, schedule, state.elapsed);
  const p = state.projection.project(position);
  state.marker?.setAttribute('transform', 'translate(' + p.x + ',' + p.y + ')');
  if (state.marker) { state.marker.dataset.phase = position.phase; state.marker.dataset.activeStop = position.stopId ?? ''; state.marker.dataset.clock = position.clockMin; }
  ui.replaySlider.value = state.elapsed;
  ui.replayClock.textContent = clockLabel(position.clockMin);
  const stop = state.tour.stops.find((item) => item.id === position.stopId);
  ui.replayStatus.textContent = state.elapsed === 0 ? 'Ready at ' + state.tour.anchor.name : position.phase === 'complete' ? 'Day complete' : position.phase === 'return' ? 'Returning to base' : (position.phase === 'travel' ? 'Heading to ' : position.phase === 'wait' ? 'Waiting at ' : 'Doing ') + (stop?.name ?? '');
  const span = Math.max(1, state.timelineEnd - schedule.startMin);
  for (const head of ui.timeline.querySelectorAll('.gantt-playhead')) { head.style.left = Math.max(0, Math.min(99.5, (position.clockMin - schedule.startMin) / span * 100)) + '%'; head.dataset.clock = position.clockMin; }
  for (const row of ui.timeline.querySelectorAll('.timeline-row')) row.classList.toggle('is-active', row.dataset.stopId === position.stopId);
}
function pauseReplay() {
  state.playing = false;
  if (state.frame !== null) cancelAnimationFrame(state.frame);
  state.frame = null; ui.play.textContent = 'Play'; ui.play.setAttribute('aria-pressed', 'false');
}
function tickReplay(timestamp) {
  if (!state.playing) return;
  const schedule = state.analysis.solution.optimal;
  const delta = Math.min(250, timestamp - state.lastTick); state.lastTick = timestamp;
  state.elapsed = Math.min(schedule.totalSpanMin, state.elapsed + delta / 1000 * 12);
  if (reducedMotion.matches) {
    const steps = schedule.legTimeline.map((leg) => leg.serviceStartMin - schedule.startMin).filter((time) => time <= state.elapsed);
    const last = steps.at(-1) ?? 0, realElapsed = state.elapsed;
    state.elapsed = realElapsed >= schedule.totalSpanMin ? schedule.totalSpanMin : last;
    updateReplay(); state.elapsed = realElapsed;
  } else updateReplay();
  if (state.elapsed >= schedule.totalSpanMin) { pauseReplay(); updateReplay(); }
  else state.frame = requestAnimationFrame(tickReplay);
}
function startReplay() {
  if (state.busy || !state.analysis) return;
  if (state.playing) { pauseReplay(); return; }
  if (state.elapsed >= state.analysis.solution.optimal.totalSpanMin) state.elapsed = 0;
  state.playing = true; state.lastTick = performance.now();
  ui.play.textContent = 'Pause'; ui.play.setAttribute('aria-pressed', 'true');
  state.frame = requestAnimationFrame(tickReplay);
}
function reactCapybara() {
  if (!state.analysis) return;
  const result = state.analysis.solution, happy = result.optimal.feasible || compareSchedules(result.optimal, result.baselines.fifo) < 0;
  const key = result.optimal.feasible + '/' + result.optimal.totalTravelMin + '/' + result.baselines.fifo.totalTravelMin;
  if (happy && key !== state.buddyKey && !reducedMotion.matches) {
    ui.capy.classList.remove('is-happy');
    requestAnimationFrame(() => ui.capy.classList.add('is-happy'));
  } else if (!happy) ui.capy.classList.remove('is-happy');
  state.buddyKey = key;
  ui.capy.classList.toggle('is-found', state.buddyFound);
  ui.capy.setAttribute('aria-pressed', String(state.buddyFound));
  ui.capyMessage.textContent = state.buddyFound ? 'Secret Capybara buddy found. More room for snacks!' : result.optimal.feasible ? 'Zero missed deadlines. Capy approves.' : 'A tight day. Capy keeps it honest.';
}
function renderDailyCard() {
  if (!state.analysis) return;
  const result = state.analysis.solution, schedule = result.optimal;
  const table = node('table', 'data-table'), head = node('thead'), headings = node('tr');
  for (const text of ['# / Errand', 'Work begins', 'Finish', 'Close', 'Margin']) { const cell = node('th', null, text); cell.scope = 'col'; headings.append(cell); }
  head.append(headings); const body = node('tbody');
  for (const [index, leg] of schedule.legTimeline.entries()) appendCells(body, [index + 1 + '. ' + leg.name, clockLabel(leg.serviceStartMin), clockLabel(leg.finishMin), clockLabel(leg.windowEndMin), leg.slackMin + ' min']);
  for (const row of body.rows) row.cells[0].title = row.cells[0].textContent;
  table.append(head, body);
  const footer = node('footer', null, 'Illustrative synthetic mile grid. No live GPS, traffic, addresses, or transit timetables. Complete errands by closing. Every errand is kept. ' + methodLabel(result.method) + '. Calendar times are local floating times. Allow extra real-world buffer.');
  ui.dailyCard.replaceChildren(node('h2', null, 'LoopLess'), node('h3', null, state.tour.title), node('p', null, 'Day ' + ui.date.value + ' / Leave ' + state.tour.startTime + ' / ' + state.tour.mode + ' / Finish ' + clockLabel(schedule.endMin)), node('p', null, schedule.totalTravelMin + ' min travel / ' + schedule.totalSpanMin + ' min day / ' + schedule.missedDeadlines + ' missed deadlines / +' + state.tour.transitJitterMin + ' min delay per moving leg'), table, node('p', null, ui.returnSummary.textContent), footer);
}
function download(content, filename, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = node('a'); link.href = url; link.download = filename; link.hidden = true;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function exportCalendar() {
  try {
    if (!ui.date.reportValidity()) return;
    const ics = buildIcsCalendar(state.analysis.solution.scenario, state.analysis.solution.optimal, ui.date.value);
    download(ics, 'loopless-' + ui.date.value + '.ics', 'text/calendar;charset=utf-8');
    ui.exportStatus.textContent = 'Calendar downloaded / ' + state.tour.stops.length + ' errands / local floating times.';
  } catch (error) { errorMessage(error); }
}
function exportJson() {
  const result = state.analysis.solution;
  const report = { schemaVersion: 2, tour: state.tour, method: result.method, schedule: result.optimal, baselines: result.baselines, modelScope: 'Synthetic mile coordinates and constant mode speeds. No GPS, live traffic, or transit timetables.', jitter: { firstBreakMin: state.analysis.sweep.firstBreakMin, exact: state.analysis.sweep.exact, points: state.analysis.sweep.points.map(({ solution, ...point }) => point) } };
  download(JSON.stringify(report, null, 2) + '\n', 'loopless-day.json', 'application/json');
  ui.exportStatus.textContent = 'JSON downloaded / inputs, schedule, baselines, and all 16 delay points.';
}
function runBenchmark() {
  ui.bench.disabled = true; ui.benchMobile.disabled = true;
  setTimeout(() => {
    try {
      const report = runBenchmarkSuite(), total = report.totals;
      ui.benchSummary.textContent = 'Across 16 fixed synthetic days, LoopLess saves ' + total.travelSavedVsFifoMin + ' travel minutes (' + total.travelReductionVsFifoPct + '%) vs FIFO. ' + report.feasibleCount + '/16 feasible vs ' + report.baselinesFeasible.fifo + '/16 FIFO. Beats or ties all three baselines on ' + report.strictlyBeatsOrTiesAll + '/16 days.';
      const comparisons = [['LoopLess', total.optTravelMin], ['FIFO', total.fifoTravelMin], ['Earliest deadline', total.edfTravelMin], ['Nearest neighbor', total.nearestTravelMin]];
      const max = Math.max(...comparisons.map((entry) => entry[1]));
      ui.benchBars.replaceChildren();
      for (const [label, value] of comparisons) {
        const row = node('div', 'benchmark-bar-row'), track = node('span', 'benchmark-bar-track'), fill = node('span', 'benchmark-bar-fill' + (label === 'LoopLess' ? ' is-optimal' : ''));
        fill.style.width = value / max * 100 + '%'; fill.style.display = 'block'; track.append(fill);
        row.append(node('span', null, label), track, node('strong', null, value + ' min')); ui.benchBars.append(row);
      }
      ui.benchBody.replaceChildren();
      for (const row of report.rows) appendCells(ui.benchBody, [row.title, row.stopCount, row.optTravelMin + ' min', row.fifoTravelMin + ' min', row.optMissed, row.method === 'exact-bnb' ? 'Exact' : row.method === 'bounded-bnb' ? 'Bounded' : '2-opt']);
      ui.benchPanel.hidden = false; ui.benchPanel.scrollIntoView({ block: 'start', behavior: 'auto' });
      announce('All 16 benchmark scenarios computed locally.');
    } catch (error) { errorMessage(error); }
    finally { ui.bench.disabled = false; ui.benchMobile.disabled = false; }
  }, 0);
}
function changeHistory(direction) {
  pauseReplay(); state.tour = state.history[direction]();
  if (!state.tour.stops.some((stop) => stop.id === state.selectedId)) state.selectedId = state.tour.stops[0]?.id ?? null;
  clearError(); synchronizeControls(); renderStops(); renderInspector(); persist(); requestAnalysis();
}
function mapCoordinate(event) {
  const matrix = ui.map.getScreenCTM();
  if (!matrix || !state.projection) return null;
  const p = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
  return state.projection.unproject(p);
}
function loadPreset(id) {
  const preset = STUDIO_PRESETS.find((item) => item.id === id) ?? STUDIO_PRESETS[0];
  commit(preset, preset.stops[0]?.id ?? null);
}
function wireEvents() {
  ui.preset.addEventListener('change', () => loadPreset(ui.preset.value));
  ui.reset.addEventListener('click', () => loadPreset(state.tour.id));
  ui.mode.addEventListener('change', () => commit({ ...state.tour, mode: ui.mode.value }, state.selectedId, false));
  ui.metric.addEventListener('change', () => commit({ ...state.tour, metric: ui.metric.value }, state.selectedId, false));
  ui.start.addEventListener('change', () => commit({ ...state.tour, startTime: ui.start.value }, state.selectedId, false));
  ui.return.addEventListener('change', () => commit({ ...state.tour, returnToAnchor: ui.return.checked }, state.selectedId, false));
  ui.undo.addEventListener('click', () => changeHistory('undo')); ui.redo.addEventListener('click', () => changeHistory('redo'));
  ui.add.addEventListener('click', () => travelAt({ x: Math.min(9, 0.7 + state.tour.stops.length * .15), y: -.7 }));
  ui.stops.addEventListener('click', (event) => { const button = event.target.closest('button[data-stop-id]'); if (button) selectStop(button.dataset.stopId); });
  ui.timeline.addEventListener('click', (event) => { const button = event.target.closest('button[data-stop-id]'); if (button) selectStop(button.dataset.stopId, true); });
  ui.form.addEventListener('submit', (event) => {
    event.preventDefault();
    try {
      const next = editStop(state.tour, state.selectedId, { name: ui.name.value, x: Number(ui.x.value), y: Number(ui.y.value), windowStart: ui.open.value, windowEnd: ui.close.value, durationMin: Number(ui.duration.value), priority: Number(ui.priority.value), dependsOn: ui.prerequisite.value || null });
      commit(next); ui.inspectorFeedback.classList.remove('is-error'); ui.inspectorFeedback.textContent = 'Saved. Route and delay tolerance updated.'; announce('Errand changes saved.');
    } catch (error) { ui.inspectorFeedback.textContent = error.message; ui.inspectorFeedback.classList.add('is-error'); announce(error.message); }
  });
  ui.delete.addEventListener('click', () => { try { commit(deleteStop(state.tour, state.selectedId)); announce('Errand deleted. Undo is available.'); } catch (error) { ui.inspectorFeedback.textContent = error.message; ui.inspectorFeedback.classList.add('is-error'); announce(error.message); } });
  ui.map.addEventListener('click', (event) => {
    const pin = event.target.closest('.map-pin');
    if (pin) { selectStop(pin.dataset.stopId, true); return; }
    if (event.target.closest('[data-anchor]') || state.busy) return;
    const coordinate = mapCoordinate(event);
    if (coordinate) travelAt({ x: Math.max(-10, Math.min(10, Math.round(coordinate.x * 10) / 10)), y: Math.max(-10, Math.min(10, Math.round(coordinate.y * 10) / 10)) });
  });
  ui.map.addEventListener('keydown', (event) => { const pin = event.target.closest('.map-pin'); if (pin && ['Enter', ' '].includes(event.key)) { event.preventDefault(); selectStop(pin.dataset.stopId, true); ui.name.focus({ preventScroll: true }); } });
  ui.map.addEventListener('pointermove', (event) => { const coordinate = mapCoordinate(event); if (coordinate) ui.coordinates.textContent = 'x ' + coordinate.x.toFixed(1) + ' / y ' + coordinate.y.toFixed(1) + ' mi'; });
  ui.fifoToggle.addEventListener('change', () => { const path = document.getElementById('fifo-path'); if (path) path.style.display = ui.fifoToggle.checked ? '' : 'none'; });
  ui.play.addEventListener('click', startReplay);
  ui.step.addEventListener('click', () => { pauseReplay(); state.elapsed = nextReplayStep(state.analysis.solution.optimal, state.elapsed); updateReplay(); });
  ui.restart.addEventListener('click', () => { pauseReplay(); state.elapsed = 0; updateReplay(); });
  ui.replaySlider.addEventListener('input', () => { pauseReplay(); state.elapsed = Number(ui.replaySlider.value); updateReplay(); });
  ui.modes.addEventListener('click', (event) => { const button = event.target.closest('button[data-mode]'); if (button) commit({ ...state.tour, mode: button.dataset.mode }, state.selectedId, false); });
  ui.jitterSlider.addEventListener('input', () => commit({ ...state.tour, transitJitterMin: Number(ui.jitterSlider.value) }, state.selectedId, false));
  ui.jitterChart.addEventListener('click', (event) => { if (event.target.dataset.delay != null) commit({ ...state.tour, transitJitterMin: Number(event.target.dataset.delay) }, state.selectedId, false); });
  ui.capy.addEventListener('click', () => { state.buddyFound = !state.buddyFound; reactCapybara(); announce(ui.capyMessage.textContent); });
  ui.share.addEventListener('click', () => {
    try { const hash = encodeTourHash(state.tour); clearError(); history.replaceState(null, '', hash); ui.shareUrl.value = location.href; ui.sharePanel.hidden = false; ui.shareUrl.focus({ preventScroll: true }); ui.shareUrl.select(); announce('Shareable day link created.'); } catch (error) { errorMessage(error); }
  });
  ui.copy.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(ui.shareUrl.value); ui.copy.textContent = 'Copied'; announce('Day link copied.'); }
    catch { ui.shareUrl.focus(); ui.shareUrl.select(); ui.copy.textContent = 'Select and copy'; announce('Link selected. Copy it with your keyboard or touch menu.'); }
  });
  ui.closeShare.addEventListener('click', () => { ui.sharePanel.hidden = true; ui.share.focus(); });
  ui.theme.addEventListener('click', () => {
    const dark = document.documentElement.dataset.theme !== 'dark';
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    ui.theme.setAttribute('aria-pressed', String(dark)); ui.theme.setAttribute('aria-label', 'Switch to ' + (dark ? 'light' : 'dark') + ' theme');
    try { storage.setItem('loopless.theme', dark ? 'dark' : 'light'); } catch { /* Theme still works without storage. */ }
  });
  ui.exportIcs.addEventListener('click', exportCalendar); ui.exportJson.addEventListener('click', exportJson);
  ui.date.addEventListener('change', renderDailyCard);
  ui.print.addEventListener('click', () => {
    if (!ui.date.reportValidity()) return;
    renderDailyCard();
    const card = ui.dailyCard.cloneNode(true); card.removeAttribute('id'); card.className = 'daily-card-preview';
    ui.cardPreview.replaceChildren(card); ui.printDialog.showModal();
    ui.exportStatus.textContent = 'One page daily card prepared.';
  });
  ui.printCard.addEventListener('click', () => window.print());
  ui.closeCard.addEventListener('click', () => ui.printDialog.close());
  ui.bench.addEventListener('click', runBenchmark); ui.benchMobile.addEventListener('click', runBenchmark);
  ui.closeBench.addEventListener('click', () => { ui.benchPanel.hidden = true; (window.innerWidth <= 600 ? ui.benchMobile : ui.bench).focus(); });
  window.addEventListener('beforeprint', renderDailyCard);
  window.addEventListener('hashchange', () => {
    if (location.hash === '#capybara-buddy') { state.buddyFound = true; reactCapybara(); return; }
    if (!location.hash.startsWith('#tour=')) return;
    try { const tour = decodeTourHash(location.hash); if (tour) commit(tour, tour.stops[0]?.id ?? null); } catch (error) { errorMessage(error); }
  });
  window.addEventListener('resize', () => {
    const small = window.innerWidth <= 600;
    if (small !== state.smallSettings) { state.smallSettings = small; ui.daySettings.open = !small; }
    if (state.analysis && !state.busy) { renderMap(); renderJitter(); }
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) pauseReplay(); });
  document.addEventListener('keydown', (event) => {
    if (!(event.metaKey || event.ctrlKey) || event.target.closest('input, textarea, select, [contenteditable]')) return;
    if (event.key.toLowerCase() === 'z') { event.preventDefault(); changeHistory(event.shiftKey ? 'redo' : 'undo'); }
    if (event.key.toLowerCase() === 'y') { event.preventDefault(); changeHistory('redo'); }
  });
  window.addEventListener('pagehide', () => { pauseReplay(); clearTimeout(state.watchdog); state.worker?.terminate(); });
}
function init() {
  ui.daySettings.open = !state.smallSettings;
  ui.map.parentElement.before(document.getElementById('route-replay'));
  const group = node('optgroup'); group.label = 'Houston / Riverside - illustrative synthetic days';
  for (const preset of STUDIO_PRESETS) group.append(option(preset.id, preset.title));
  ui.preset.append(group);
  ui.preset.append(option('custom', 'Shared / custom day', true));
  const saved = readStoredTour(storage);
  let initial = saved.tour ?? validateTour(STUDIO_PRESETS[0]), startupError = saved.error;
  if (location.hash.startsWith('#tour=')) {
    try { initial = decodeTourHash(location.hash); startupError = null; } catch (error) { startupError = error.message; }
  }
  state.tour = validateTour(initial); state.history = createHistory(state.tour); state.selectedId = state.tour.stops[0]?.id ?? null;
  state.buddyFound = location.hash === '#capybara-buddy';
  try { const theme = storage.getItem('loopless.theme'); if (theme === 'dark') { document.documentElement.dataset.theme = 'dark'; ui.theme.setAttribute('aria-pressed', 'true'); ui.theme.setAttribute('aria-label', 'Switch to light theme'); } } catch { /* Default daylight theme. */ }
  try {
    state.worker = new Worker(new URL('./solver-worker.mjs?v=studio-c49dfe94a109', import.meta.url), { type: 'module' });
    state.worker.addEventListener('message', (event) => acceptAnalysis(event.data));
    state.worker.addEventListener('error', (event) => { event.preventDefault(); fallbackWorker(); });
    state.worker.addEventListener('messageerror', fallbackWorker);
  } catch { state.worker = null; state.execution = 'Main thread fallback'; }
  wireEvents(); synchronizeControls(); renderStops(); renderInspector(); persist(); requestAnalysis();
  if (startupError) errorMessage(new Error(startupError));
}
init();
