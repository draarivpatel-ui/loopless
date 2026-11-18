import {
  solveOptimal,
  formatMinToClock,
  buildIcsCalendar,
} from './planner.mjs';
import { PRESET_SCENARIOS } from './scenarios.mjs';
import { runBenchmarkSuite } from './benchmark.mjs';

const state = {
  presetId: PRESET_SCENARIOS[0].id,
  scenario: structuredClone(PRESET_SCENARIOS[0]),
  highlightedStopId: null,
  lastSolution: null,
};

const els = {
  presetSelect: document.getElementById('preset-select'),
  modeButtons: document.getElementById('mode-buttons'),
  metricSelect: document.getElementById('metric-select'),
  startTime: document.getElementById('start-time'),
  jitterSlider: document.getElementById('jitter-slider'),
  jitterValue: document.getElementById('jitter-value'),
  returnToggle: document.getElementById('return-toggle'),
  subtitle: document.getElementById('scenario-subtitle'),
  errorBox: document.getElementById('solver-error'),
  stopsList: document.getElementById('stops-list'),
  kpiFeasible: document.getElementById('kpi-feasible'),
  kpiMethod: document.getElementById('kpi-method'),
  kpiTravel: document.getElementById('kpi-travel'),
  kpiTravelDelta: document.getElementById('kpi-travel-delta'),
  kpiFinish: document.getElementById('kpi-finish'),
  kpiSpan: document.getElementById('kpi-span'),
  kpiSlack: document.getElementById('kpi-slack'),
  kpiWait: document.getElementById('kpi-wait'),
  routeSvg: document.getElementById('route-svg'),
  compareTbody: document.getElementById('compare-tbody'),
  timelineList: document.getElementById('timeline-list'),
  timelineSpan: document.getElementById('timeline-window-span'),
  benchPanel: document.getElementById('benchmark-panel'),
  benchSummary: document.getElementById('benchmark-summary'),
  benchTbody: document.getElementById('benchmark-tbody'),
  btnAddStop: document.getElementById('btn-add-stop'),
  btnReset: document.getElementById('btn-reset-preset'),
  btnBench: document.getElementById('btn-run-bench'),
  btnCloseBench: document.getElementById('btn-close-bench'),
  btnExportIcs: document.getElementById('btn-export-ics'),
  btnExportJson: document.getElementById('btn-export-json'),
  btnPrint: document.getElementById('btn-print'),
};

function init() {
  for (const preset of PRESET_SCENARIOS) {
    const opt = document.createElement('option');
    opt.value = preset.id;
    opt.textContent = preset.title;
    els.presetSelect.appendChild(opt);
  }

  els.presetSelect.addEventListener('change', () => loadPreset(els.presetSelect.value));
  els.btnReset.addEventListener('click', () => loadPreset(state.presetId));
  els.btnAddStop.addEventListener('click', addStop);

  els.modeButtons.addEventListener('click', (ev) => {
    const btn = ev.target.closest('button[data-mode]');
    if (!btn) return;
    state.scenario.mode = btn.dataset.mode;
    syncControls();
    recompute();
  });

  els.metricSelect.addEventListener('change', () => {
    state.scenario.metric = els.metricSelect.value;
    recompute();
  });

  els.startTime.addEventListener('change', () => {
    if (els.startTime.value) {
      state.scenario.startTime = els.startTime.value;
      recompute();
    }
  });

  els.jitterSlider.addEventListener('input', () => {
    state.scenario.transitJitterMin = Number(els.jitterSlider.value);
    els.jitterValue.textContent = `+${state.scenario.transitJitterMin} min`;
    recompute();
  });

  els.returnToggle.addEventListener('change', () => {
    state.scenario.returnToAnchor = els.returnToggle.checked;
    recompute();
  });

  els.btnBench.addEventListener('click', renderBenchmark);
  els.btnCloseBench.addEventListener('click', () => {
    els.benchPanel.hidden = true;
  });

  els.btnExportIcs.addEventListener('click', downloadIcs);
  els.btnExportJson.addEventListener('click', downloadJson);
  els.btnPrint.addEventListener('click', () => window.print());

  loadPreset(PRESET_SCENARIOS[0].id);
}

function loadPreset(id) {
  const found = PRESET_SCENARIOS.find((p) => p.id === id) || PRESET_SCENARIOS[0];
  state.presetId = found.id;
  state.scenario = structuredClone(found);
  state.scenario.transitJitterMin = Number(state.scenario.transitJitterMin || 0);
  state.highlightedStopId = null;
  els.presetSelect.value = found.id;
  syncControls();
  renderStopEditor();
  recompute();
}

function syncControls() {
  for (const btn of els.modeButtons.querySelectorAll('button[data-mode]')) {
    btn.classList.toggle('active', btn.dataset.mode === state.scenario.mode);
  }
  els.metricSelect.value = state.scenario.metric || 'manhattan';
  els.startTime.value = state.scenario.startTime || '15:30';
  els.jitterSlider.value = String(state.scenario.transitJitterMin || 0);
  els.jitterValue.textContent = `+${state.scenario.transitJitterMin || 0} min`;
  els.returnToggle.checked = state.scenario.returnToAnchor !== false;
  els.subtitle.textContent = state.scenario.subtitle || '';
}

function addStop() {
  const n = state.scenario.stops.length + 1;
  const id = `custom-${Date.now().toString(36)}-${n}`;
  state.scenario.stops.push({
    id,
    name: `New Stop ${n}`,
    x: Number((1.0 + (n % 3) * 0.6).toFixed(1)),
    y: Number(((n % 2 === 0 ? 1 : -1) * 0.8).toFixed(1)),
    durationMin: 15,
    windowStart: state.scenario.startTime,
    windowEnd: '20:00',
    priority: 2,
    category: 'errand',
    dependsOn: null,
  });
  renderStopEditor();
  recompute();
}

function renderStopEditor() {
  els.stopsList.textContent = '';
  const stops = state.scenario.stops;

  for (const stop of stops) {
    const card = document.createElement('div');
    card.className = 'stop-card';
    card.dataset.stopId = stop.id;
    if (state.highlightedStopId === stop.id) card.classList.add('highlighted');

    const top = document.createElement('div');
    top.className = 'stop-card-top';

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.value = stop.name;
    nameInput.setAttribute('aria-label', `Stop name for ${stop.id}`);
    nameInput.addEventListener('input', () => {
      stop.name = nameInput.value;
      recompute();
    });

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'btn btn-small btn-danger';
    delBtn.textContent = 'Remove';
    delBtn.addEventListener('click', () => {
      state.scenario.stops = state.scenario.stops.filter((s) => s.id !== stop.id);
      for (const other of state.scenario.stops) {
        if (other.dependsOn === stop.id) other.dependsOn = null;
      }
      renderStopEditor();
      recompute();
    });

    top.append(nameInput, delBtn);
    card.appendChild(top);

    const grid = document.createElement('div');
    grid.className = 'stop-fields';

    grid.appendChild(makeNumField('X (mi)', stop.x, '0.1', (val) => {
      stop.x = val;
      recompute();
    }));
    grid.appendChild(makeNumField('Y (mi)', stop.y, '0.1', (val) => {
      stop.y = val;
      recompute();
    }));
    grid.appendChild(makeNumField('Task min', stop.durationMin, '1', (val) => {
      stop.durationMin = Math.max(1, val);
      recompute();
    }));
    grid.appendChild(makeTimeField('Opens', stop.windowStart || '08:00', (val) => {
      stop.windowStart = val;
      recompute();
    }));
    grid.appendChild(makeTimeField('Due by', stop.windowEnd || '20:00', (val) => {
      stop.windowEnd = val;
      recompute();
    }));

    const depWrap = document.createElement('label');
    depWrap.className = 'stop-field stop-field-wide';
    const depLbl = document.createElement('span');
    depLbl.textContent = 'Must come after';
    const depSel = document.createElement('select');
    const noneOpt = document.createElement('option');
    noneOpt.value = '';
    noneOpt.textContent = 'No prerequisite';
    depSel.appendChild(noneOpt);
    for (const candidate of stops) {
      if (candidate.id === stop.id) continue;
      const opt = document.createElement('option');
      opt.value = candidate.id;
      opt.textContent = candidate.name;
      depSel.appendChild(opt);
    }
    depSel.value = stop.dependsOn || '';
    depSel.addEventListener('change', () => {
      stop.dependsOn = depSel.value || null;
      recompute();
    });
    depWrap.append(depLbl, depSel);
    grid.appendChild(depWrap);

    card.appendChild(grid);
    els.stopsList.appendChild(card);
  }
}

function makeNumField(label, value, step, onChange) {
  const wrap = document.createElement('label');
  wrap.className = 'stop-field';
  const span = document.createElement('span');
  span.textContent = label;
  const input = document.createElement('input');
  input.type = 'number';
  input.step = step;
  input.value = String(value);
  input.addEventListener('change', () => {
    const parsed = Number(input.value);
    if (Number.isFinite(parsed)) onChange(parsed);
  });
  wrap.append(span, input);
  return wrap;
}

function makeTimeField(label, value, onChange) {
  const wrap = document.createElement('label');
  wrap.className = 'stop-field';
  const span = document.createElement('span');
  span.textContent = label;
  const input = document.createElement('input');
  input.type = 'time';
  input.value = value;
  input.addEventListener('change', () => {
    if (input.value) onChange(input.value);
  });
  wrap.append(span, input);
  return wrap;
}

function recompute() {
  try {
    const sol = solveOptimal(state.scenario);
    state.lastSolution = sol;
    els.errorBox.hidden = true;
    els.errorBox.textContent = '';
    renderSolution(sol);
  } catch (err) {
    els.errorBox.hidden = false;
    els.errorBox.textContent = err.message || 'Invalid constraint configuration.';
  }
}

function renderSolution(sol) {
  const opt = sol.optimal;
  const fifo = sol.baselines.fifo;
  const stopTotal = sol.scenario.stops.length;
  const onTime = stopTotal - opt.missedDeadlines;

  els.kpiFeasible.textContent = opt.feasible ? `${onTime}/${stopTotal} On Time` : `${opt.missedDeadlines} Missed`;
  els.kpiMethod.textContent = `Solver: ${sol.method} (${sol.scenario.mode.label})`;

  els.kpiTravel.textContent = `${opt.totalTravelMin} min`;
  const travelSaved = fifo.totalTravelMin - opt.totalTravelMin;
  els.kpiTravelDelta.textContent = travelSaved > 0
    ? `Saves ${travelSaved} min vs FIFO (${opt.totalDistanceMi} mi)`
    : `${opt.totalDistanceMi} mi total distance`;

  els.kpiFinish.textContent = formatMinToClock(opt.endMin);
  els.kpiSpan.textContent = `Clock span: ${opt.totalSpanMin} min`;

  els.kpiSlack.textContent = `${opt.minBufferSlackMin} min`;
  els.kpiWait.textContent = `Idle wait: ${opt.totalWaitMin} min`;

  renderCompareTable(sol);
  renderSvgMap(sol);
  renderTimeline(sol);
}

function renderCompareTable(sol) {
  els.compareTbody.textContent = '';
  const totalStops = sol.scenario.stops.length;
  const rows = [
    { name: 'LoopLess Optimal', data: sol.optimal, best: true },
    { name: 'Listed Order (FIFO)', data: sol.baselines.fifo, best: false },
    { name: 'Earliest Deadline (EDF)', data: sol.baselines.edf, best: false },
    { name: 'Nearest Neighbor', data: sol.baselines.nearest, best: false },
  ];

  for (const r of rows) {
    const tr = document.createElement('tr');
    if (r.best) tr.className = 'row-best';
    const onTime = totalStops - r.data.missedDeadlines;
    const cells = [
      r.name,
      `${onTime}/${totalStops}`,
      `${r.data.totalTravelMin}m`,
      `${r.data.totalWaitMin}m`,
      `${r.data.totalSpanMin}m`,
      `${r.data.minBufferSlackMin}m`,
    ];
    for (const c of cells) {
      const td = document.createElement('td');
      td.textContent = c;
      tr.appendChild(td);
    }
    els.compareTbody.appendChild(tr);
  }
}

function renderSvgMap(sol) {
  const svg = els.routeSvg;
  svg.textContent = '';
  const ns = 'http://www.w3.org/2000/svg';
  const W = 460;
  const H = 320;
  const PAD = 38;

  const points = [sol.scenario.anchor, ...sol.scenario.stops];
  let minX = Math.min(...points.map((p) => p.x));
  let maxX = Math.max(...points.map((p) => p.x));
  let minY = Math.min(...points.map((p) => p.y));
  let maxY = Math.max(...points.map((p) => p.y));
  if (maxX - minX < 1) { minX -= 1; maxX += 1; }
  if (maxY - minY < 1) { minY -= 1; maxY += 1; }

  const mapX = (x) => PAD + ((x - minX) / (maxX - minX)) * (W - 2 * PAD);
  const mapY = (y) => H - PAD - ((y - minY) / (maxY - minY)) * (H - 2 * PAD);

  const byId = new Map(sol.scenario.stops.map((s) => [s.id, s]));

  // Grid lines
  for (let i = 0; i <= 4; i++) {
    const gx = PAD + (i / 4) * (W - 2 * PAD);
    const gy = PAD + (i / 4) * (H - 2 * PAD);
    svg.appendChild(svgEl(ns, 'line', { x1: gx, y1: PAD, x2: gx, y2: H - PAD, stroke: '#edf1ee', 'stroke-width': 1 }));
    svg.appendChild(svgEl(ns, 'line', { x1: PAD, y1: gy, x2: W - PAD, y2: gy, stroke: '#edf1ee', 'stroke-width': 1 }));
  }

  // FIFO dashed polyline
  const fifoPts = buildPolyPoints(sol.scenario.anchor, sol.baselines.fifo.orderIds, byId, sol.scenario.returnToAnchor, mapX, mapY);
  if (fifoPts) {
    svg.appendChild(svgEl(ns, 'polyline', {
      points: fifoPts,
      fill: 'none',
      stroke: '#8b958e',
      'stroke-width': 2,
      'stroke-dasharray': '5 5',
    }));
  }

  // Optimal solid polyline
  const optPts = buildPolyPoints(sol.scenario.anchor, sol.optimal.orderIds, byId, sol.scenario.returnToAnchor, mapX, mapY);
  if (optPts) {
    svg.appendChild(svgEl(ns, 'polyline', {
      points: optPts,
      fill: 'none',
      stroke: '#0f766e',
      'stroke-width': 3,
      'stroke-linejoin': 'round',
      'stroke-linecap': 'round',
    }));
  }

  // Anchor node
  const ax = mapX(sol.scenario.anchor.x);
  const ay = mapY(sol.scenario.anchor.y);
  svg.appendChild(svgEl(ns, 'rect', {
    x: ax - 7, y: ay - 7, width: 14, height: 14, rx: 3, fill: '#151c18',
  }));
  const aLabel = svgEl(ns, 'text', { x: ax, y: ay - 11, 'text-anchor': 'middle', 'font-size': '10', fill: '#151c18', 'font-weight': '700' });
  aLabel.textContent = sol.scenario.anchor.name;
  svg.appendChild(aLabel);

  // Stop nodes numbered by optimal visit order
  sol.optimal.legTimeline.forEach((leg, idx) => {
    const stop = byId.get(leg.stopId);
    if (!stop) return;
    const cx = mapX(stop.x);
    const cy = mapY(stop.y);
    const g = svgEl(ns, 'g', { style: 'cursor:pointer' });
    g.appendChild(svgEl(ns, 'circle', {
      cx, cy, r: state.highlightedStopId === stop.id ? 13 : 11,
      fill: leg.onTime ? '#0f766e' : '#b91c1c',
      stroke: '#ffffff',
      'stroke-width': 2,
    }));
    const num = svgEl(ns, 'text', {
      x: cx, y: cy + 4, 'text-anchor': 'middle', 'font-size': '11', fill: '#ffffff', 'font-weight': '700',
    });
    num.textContent = String(idx + 1);
    const lbl = svgEl(ns, 'text', {
      x: cx, y: cy + 22, 'text-anchor': 'middle', 'font-size': '10', fill: '#151c18',
    });
    lbl.textContent = stop.name.length > 16 ? `${stop.name.slice(0, 15)}..` : stop.name;
    g.append(num, lbl);
    g.addEventListener('click', () => {
      state.highlightedStopId = state.highlightedStopId === stop.id ? null : stop.id;
      renderStopEditor();
      renderSolution(state.lastSolution);
    });
    svg.appendChild(g);
  });
}

function buildPolyPoints(anchor, orderIds, byId, returnToAnchor, mapX, mapY) {
  if (!orderIds.length) return '';
  const coords = [`${mapX(anchor.x).toFixed(1)},${mapY(anchor.y).toFixed(1)}`];
  for (const id of orderIds) {
    const s = byId.get(id);
    if (s) coords.push(`${mapX(s.x).toFixed(1)},${mapY(s.y).toFixed(1)}`);
  }
  if (returnToAnchor) {
    coords.push(`${mapX(anchor.x).toFixed(1)},${mapY(anchor.y).toFixed(1)}`);
  }
  return coords.join(' ');
}

function svgEl(ns, tag, attrs) {
  const el = document.createElementNS(ns, tag);
  for (const [k, v] of Object.entries(attrs)) {
    el.setAttribute(k, String(v));
  }
  return el;
}

function renderTimeline(sol) {
  els.timelineList.textContent = '';
  const opt = sol.optimal;
  const spanMin = Math.max(30, opt.endMin - opt.startMin);
  els.timelineSpan.textContent = `${formatMinToClock(opt.startMin)} to ${formatMinToClock(opt.endMin)} (${opt.totalSpanMin} min total)`;

  opt.legTimeline.forEach((leg, idx) => {
    const row = document.createElement('div');
    row.className = 'leg-row';
    if (state.highlightedStopId === leg.stopId) row.classList.add('highlighted');

    const badgeIdx = document.createElement('div');
    badgeIdx.className = 'leg-idx';
    badgeIdx.textContent = String(idx + 1);

    const meta = document.createElement('div');
    meta.className = 'leg-meta';
    const title = document.createElement('strong');
    title.textContent = leg.name;
    const sub = document.createElement('span');
    sub.textContent = `Travel ${leg.travelMin}m (${leg.distanceMi} mi) | Work ${formatMinToClock(leg.serviceStartMin)}-${formatMinToClock(leg.finishMin)} | Due ${formatMinToClock(leg.windowEndMin)}`;
    meta.append(title, sub);

    const track = document.createElement('div');
    track.className = 'gantt-track';
    const pct = (m) => `${(((m - opt.startMin) / spanMin) * 100).toFixed(2)}%`;
    const wPct = (d) => `${Math.max(0.8, (d / spanMin) * 100).toFixed(2)}%`;

    if (leg.travelMin > 0) {
      const segT = document.createElement('div');
      segT.className = 'gantt-seg gantt-travel';
      segT.style.left = pct(leg.departMin);
      segT.style.width = wPct(leg.travelMin);
      track.appendChild(segT);
    }
    if (leg.waitMin > 0) {
      const segW = document.createElement('div');
      segW.className = 'gantt-seg gantt-wait';
      segW.style.left = pct(leg.arrivalMin);
      segW.style.width = wPct(leg.waitMin);
      track.appendChild(segW);
    }
    const segS = document.createElement('div');
    segS.className = `gantt-seg gantt-service${leg.onTime ? '' : ' late'}`;
    segS.style.left = pct(leg.serviceStartMin);
    segS.style.width = wPct(leg.finishMin - leg.serviceStartMin);
    track.appendChild(segS);

    const status = document.createElement('span');
    if (!leg.onTime) {
      status.className = 'badge badge-late';
      status.textContent = `LATE +${leg.latenessMin}m`;
    } else if (leg.slackMin <= 10) {
      status.className = 'badge badge-warn';
      status.textContent = `SLACK ${leg.slackMin}m`;
    } else {
      status.className = 'badge badge-ok';
      status.textContent = `ON TIME +${leg.slackMin}m`;
    }

    row.append(badgeIdx, meta, track, status);
    els.timelineList.appendChild(row);
  });

  if (opt.returnLeg) {
    const ret = document.createElement('div');
    ret.className = 'leg-row';
    const icon = document.createElement('div');
    icon.className = 'leg-idx';
    icon.textContent = 'H';
    const meta = document.createElement('div');
    meta.className = 'leg-meta';
    const title = document.createElement('strong');
    title.textContent = `Return to ${opt.returnLeg.toName}`;
    const sub = document.createElement('span');
    sub.textContent = `${formatMinToClock(opt.returnLeg.departMin)}-${formatMinToClock(opt.returnLeg.arrivalMin)} (${opt.returnLeg.travelMin}m, ${opt.returnLeg.distanceMi} mi)`;
    meta.append(title, sub);
    const spacer = document.createElement('div');
    spacer.className = 'leg-spacer';
    const st = document.createElement('span');
    st.className = 'badge badge-ok';
    st.textContent = 'RETURN';
    ret.append(icon, meta, spacer, st);
    els.timelineList.appendChild(ret);
  }
}

function renderBenchmark() {
  const report = runBenchmarkSuite();
  els.benchPanel.hidden = false;
  els.benchSummary.textContent =
    `${report.scenarioCount} scenarios: LoopLess feasible ${report.feasibleCount}/${report.scenarioCount} `
    + `(FIFO ${report.baselinesFeasible.fifo}, EDF ${report.baselinesFeasible.edf}, Nearest ${report.baselinesFeasible.nearest}). `
    + `Total travel ${report.totals.optTravelMin} min vs FIFO ${report.totals.fifoTravelMin} min `
    + `(saves ${report.totals.travelSavedVsFifoMin} min, -${report.totals.travelReductionVsFifoPct}%).`;

  els.benchTbody.textContent = '';
  for (const r of report.rows) {
    const tr = document.createElement('tr');
    const cells = [
      r.title,
      r.mode,
      String(r.stopCount),
      `${r.optTravelMin}m (${r.feasible ? 'ok' : `${r.optMissed} late`})`,
      `${r.fifoTravelMin}m (${r.fifoFeasible ? 'ok' : `${r.fifoMissed} late`})`,
      `${r.edfTravelMin}m (${r.edfFeasible ? 'ok' : 'late'})`,
      `${r.nearestTravelMin}m (${r.nearestFeasible ? 'ok' : 'late'})`,
      `${r.travelSavedVsFifoMin >= 0 ? '-' : '+'}${Math.abs(r.travelSavedVsFifoMin)}m`,
    ];
    for (const c of cells) {
      const td = document.createElement('td');
      td.textContent = c;
      tr.appendChild(td);
    }
    els.benchTbody.appendChild(tr);
  }
  els.benchPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function downloadIcs() {
  if (!state.lastSolution) return;
  const ics = buildIcsCalendar(state.lastSolution.scenario, state.lastSolution.optimal);
  triggerDownload(`${state.scenario.id}-schedule.ics`, ics, 'text/calendar;charset=utf-8');
}

function downloadJson() {
  if (!state.lastSolution) return;
  const payload = {
    tool: 'LoopLess',
    version: '1.0.0',
    modelScope: 'Synthetic local coordinates and mode speeds; no live traffic or GPS.',
    method: state.lastSolution.method,
    optimal: state.lastSolution.optimal,
    baselines: state.lastSolution.baselines,
  };
  triggerDownload(`${state.scenario.id}-plan.json`, JSON.stringify(payload, null, 2), 'application/json');
}

function triggerDownload(filename, text, mime) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

init();
