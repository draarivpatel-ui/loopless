/**
 * Wiring for the Branch-and-Bound and tipping-point lab panel.
 * Loads js/bnb-lab.js dynamically so the page degrades cleanly if it is absent.
 */
import { TRANSIT_MODES, formatSlackLabel } from './planner.mjs?v=studio-c49dfe94a109';
import { STUDIO_PRESETS } from './presets.mjs?v=studio-c49dfe94a109';
import { readStoredTour, STORAGE_KEY } from './studio.mjs?v=studio-c49dfe94a109';

const panel = document.getElementById('lab-panel');
if (panel) init();

async function init() {
  const ui = {
    day: document.getElementById('lab-day'), mode: document.getElementById('lab-mode'),
    pill: document.getElementById('lab-state-pill'), tbody: document.getElementById('lab-compare-tbody'),
    tipChart: document.getElementById('lab-tip-chart'), modeChart: document.getElementById('lab-mode-chart'),
    tipDetail: document.getElementById('lab-tip-detail'), tipStrategy: document.getElementById('lab-tip-strategy'),
    chips: document.getElementById('lab-strategy-chips'), digest: document.getElementById('lab-digest'),
    btnJson: document.getElementById('lab-btn-json'), btnCsv: document.getElementById('lab-btn-csv'),
    btnMd: document.getElementById('lab-btn-md'), btnLink: document.getElementById('lab-btn-link'),
    btnVerify: document.getElementById('lab-btn-verify'), btnTamper: document.getElementById('lab-btn-tamper'),
    status: document.getElementById('lab-export-status'), runTests: document.getElementById('lab-run-tests'),
    testStatus: document.getElementById('lab-test-status'), testList: document.getElementById('lab-test-list'),
    note: document.getElementById('lab-note'), busy: document.getElementById('lab-busy'),
  };
  let lab;
  try {
    lab = await import('./bnb-lab.js?v=studio-c49dfe94a109');
  } catch {
    ui.note.textContent = 'The search lab module could not be loaded. The route studio above still works.';
    for (const control of panel.querySelectorAll('button, select')) control.disabled = true;
    return;
  }
  const { buildLabReport, decodeLabHash, encodeLabHash, exportProofJson, exportProofCsv, exportProofMarkdown, verifyStamped, buildTamperedStamped, runSelfTests, LAB_STRATEGY_IDS, LAB_STRATEGIES } = lab;

  const node = (tag, className, text) => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text != null) element.textContent = String(text);
    return element;
  };
  const svgNode = (tag, attributes = {}, text) => {
    const element = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
    if (text != null) element.textContent = String(text);
    return element;
  };
  const state = {
    day: 'current', mode: 'bike', strategy: 'loopless-exact', delay: 0,
    report: null, requestId: 0, worker: null, watchdog: null, storedTour: null,
  };
  const dayIds = STUDIO_PRESETS.map((preset) => preset.id);

  function storedDay() {
    try {
      return readStoredTour(window.localStorage).tour;
    } catch {
      return null;
    }
  }
  function activeTour() {
    if (state.day === 'current') return state.storedTour ?? STUDIO_PRESETS[0];
    return STUDIO_PRESETS.find((preset) => preset.id === state.day) ?? STUDIO_PRESETS[0];
  }
  function methodLabel(method) {
    if (method === 'exact' || method === 'exact-bnb') return 'Exact';
    if (method === 'bounded-bnb') return 'Bounded';
    if (method === 'heuristic-2opt') return '2-opt';
    return 'Baseline';
  }
  function fillControls() {
    ui.day.replaceChildren();
    ui.day.append(node('option', null, 'Current studio day'));
    ui.day.options[0].value = 'current';
    for (const preset of STUDIO_PRESETS) {
      const option = node('option', null, preset.title);
      option.value = preset.id;
      ui.day.append(option);
    }
    ui.mode.replaceChildren();
    for (const mode of Object.values(TRANSIT_MODES)) {
      const option = node('option', null, mode.id === 'car' ? 'Carpool' : mode.label);
      option.value = mode.id;
      ui.mode.append(option);
    }
    ui.chips.replaceChildren();
    for (const id of LAB_STRATEGY_IDS) {
      const button = node('button', 'lab-chip', LAB_STRATEGIES[id].short);
      button.type = 'button';
      button.dataset.strategy = id;
      button.setAttribute('aria-pressed', 'false');
      ui.chips.append(button);
    }
    ui.day.value = state.day;
    ui.mode.value = state.mode;
  }
  function syncControls() {
    ui.day.value = state.day;
    ui.mode.value = state.mode;
    for (const button of ui.chips.querySelectorAll('button[data-strategy]')) {
      const active = button.dataset.strategy === state.strategy;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    }
    ui.tipStrategy.textContent = LAB_STRATEGIES[state.strategy].label;
  }
  function syncHash() {
    if (!location.hash.startsWith('#llab=')) return;
    try {
      history.replaceState(null, '', encodeLabHash({ day: state.day, mode: state.mode, strategy: state.strategy, delay: state.delay }));
    } catch { /* A state that cannot be encoded simply is not bookmarked. */ }
  }
  function requestReport() {
    state.requestId += 1;
    const id = state.requestId;
    const tour = activeTour();
    const options = { modeId: state.mode, focusStrategyId: state.strategy, delayMin: state.delay };
    ui.pill.textContent = 'Computing lab';
    ui.busy.hidden = false;
    if (state.worker) {
      state.worker.postMessage({ type: 'lab-report', id, tour, options });
      clearTimeout(state.watchdog);
      state.watchdog = setTimeout(() => mainThreadReport(id, tour, options), 20000);
    } else {
      mainThreadReport(id, tour, options);
    }
  }
  function mainThreadReport(id, tour, options) {
    clearTimeout(state.watchdog);
    state.watchdog = null;
    setTimeout(() => {
      if (id !== state.requestId) return;
      try {
        acceptReport({ id, result: buildLabReport(tour, options) });
      } catch (error) {
        acceptReport({ id, error: error.message });
      }
    }, 0);
  }
  function acceptReport(message) {
    if (message.id !== state.requestId) return;
    clearTimeout(state.watchdog);
    state.watchdog = null;
    ui.busy.hidden = true;
    if (message.error) {
      ui.status.textContent = 'Lab computation failed: ' + message.error;
      ui.pill.textContent = 'Lab error';
      return;
    }
    state.report = message.result;
    render();
  }
  function render() {
    const report = state.report;
    const exactRows = report.comparator.modes.flatMap((mode) => mode.rows).filter((row) => row.strategyId === 'loopless-exact');
    ui.pill.textContent = exactRows.every((row) => row.method === 'exact' || row.method === 'exact-bnb') ? 'Exact / 16 rows' : 'Mixed / labeled';
    renderTable(report);
    renderTipChart(report);
    renderModeChart(report);
    ui.digest.textContent = report.digest;
    ui.status.textContent = 'Proof ready. One SHA-256 digest stamps this page and every export.';
  }
  function renderTable(report) {
    ui.tbody.replaceChildren();
    for (const mode of report.comparator.modes) {
      for (const row of mode.rows) {
        const tr = node('tr', (row.strategyId === 'loopless-exact' ? 'is-optimal ' : '') + (mode.modeId === state.mode && row.strategyId === state.strategy ? ' is-focus' : ''));
        tr.tabIndex = 0;
        tr.dataset.mode = mode.modeId;
        tr.dataset.strategy = row.strategyId;
        const cells = [
          mode.modeLabel, row.strategyLabel, row.onTime + '/' + row.stopCount,
          String(row.missedDeadlines), row.totalLatenessMin + ' min', row.totalTravelMin + ' min',
          row.totalSpanMin + ' min', formatSlackLabel(row.minBufferSlackMin), row.travelSavedVsFifoMin + ' min',
          String(row.rescuedDeadlines), methodLabel(row.method) + (row.nodesExplored == null ? '' : ' / ' + row.nodesExplored + ' nodes'),
        ];
        for (const value of cells) tr.append(node('td', null, value));
        ui.tbody.append(tr);
      }
    }
  }
  function focusStrategy(report) {
    return report.delayMatrix.strategies.find((strategy) => strategy.strategyId === state.strategy) ?? report.delayMatrix.strategies[0];
  }
  function renderTipChart(report) {
    const strategy = focusStrategy(report);
    const focusedDelay = ui.tipChart.contains(document.activeElement) ? document.activeElement.dataset?.delay : null;
    const small = window.innerWidth <= 600;
    const width = small ? 420 : 680, height = 240;
    ui.tipChart.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
    const left = 46, right = width - 18, top = 30, bottom = 168;
    const maxMissed = Math.max(1, ...strategy.points.map((point) => point.missedDeadlines));
    const minSlack = Math.min(-2, ...strategy.points.map((point) => point.minSlackMin));
    const maxSlack = Math.max(4, ...strategy.points.map((point) => point.minSlackMin));
    const x = (delay) => left + (delay / 15) * (right - left);
    const ySlack = (value) => bottom - ((value - minSlack) / (maxSlack - minSlack)) * (bottom - top);
    const barH = (missed) => (missed / maxMissed) * 46;
    ui.tipChart.replaceChildren(svgNode('title', {}, strategy.label + ' delay tipping chart'));
    for (const tick of [minSlack, 0, maxSlack]) {
      ui.tipChart.append(svgNode('line', { x1: left, x2: right, y1: ySlack(tick), y2: ySlack(tick), class: tick === 0 ? 'chart-zero' : 'grid-line' }));
      ui.tipChart.append(svgNode('text', { x: left - 9, y: ySlack(tick) + 4, class: 'chart-label', 'text-anchor': 'end' }, tick));
    }
    ui.tipChart.append(svgNode('text', { x: left, y: 16, class: 'chart-label' }, 'margin min / missed bars'));
    for (const point of strategy.points) {
      const missed = point.missedDeadlines;
      if (missed > 0) {
        ui.tipChart.append(svgNode('rect', { x: x(point.delayMin) - 7, y: bottom - barH(missed), width: 14, height: barH(missed), class: 'lab-missed-bar', 'aria-hidden': 'true' }));
      }
    }
    ui.tipChart.append(svgNode('path', {
      d: strategy.points.map((point, index) => (index ? 'L' : 'M') + x(point.delayMin) + ' ' + ySlack(point.minSlackMin)).join(' '),
      class: 'chart-curve',
    }));
    if (strategy.tippingPointMin !== null) {
      ui.tipChart.append(svgNode('line', { x1: x(strategy.tippingPointMin), x2: x(strategy.tippingPointMin), y1: top, y2: bottom, class: 'chart-tip-line' }));
      ui.tipChart.append(svgNode('text', { x: x(strategy.tippingPointMin), y: top - 8, class: 'lab-tip-label', 'text-anchor': 'middle' }, '+' + strategy.tippingPointMin + ' min breaks'));
    }
    for (const point of strategy.points) {
      const marker = svgNode('g', { class: 'lab-tip-point', tabindex: '0', role: 'button', 'data-delay': point.delayMin, 'aria-label': '+' + point.delayMin + ' min delay, ' + point.missedDeadlines + ' missed, ' + formatSlackLabel(point.minSlackMin) });
      marker.append(
        svgNode('circle', { cx: x(point.delayMin), cy: ySlack(point.minSlackMin), r: 10, class: 'lab-tip-hit' }),
        svgNode('circle', { cx: x(point.delayMin), cy: ySlack(point.minSlackMin), r: point.delayMin === state.delay ? 5.5 : 3.4, class: 'chart-point' + (point.missedDeadlines ? ' is-broken' : '') + (point.delayMin === state.delay ? ' is-current' : '') }),
      );
      ui.tipChart.append(marker);
    }
    for (const value of [0, 5, 10, 15]) {
      ui.tipChart.append(svgNode('text', { x: x(value), y: 190, class: 'chart-label', 'text-anchor': 'middle' }, '+' + value));
    }
    ui.tipChart.append(svgNode('text', { x: left, y: 214, class: 'chart-label' }, 'delay per moving leg / minutes'));
    renderTipDetail();
    if (focusedDelay != null) ui.tipChart.querySelector('.lab-tip-point[data-delay="' + focusedDelay + '"]')?.focus();
  }
  function renderTipDetail() {
    const report = state.report;
    if (!report) return;
    const strategy = focusStrategy(report);
    const point = strategy.points[state.delay];
    const label = strategy.tippingPointMin === null
      ? 'no missed deadline through +15 min'
      : 'first break at +' + strategy.tippingPointMin + ' min';
    ui.tipDetail.textContent = strategy.short + ' at +' + point.delayMin + ' min: ' + point.missedDeadlines + ' missed, ' + formatSlackLabel(point.minSlackMin) + ', ' + point.travelMin + ' min travel, ' + methodLabel(point.method) + ' search, ' + label + '.';
  }
  function renderModeChart(report) {
    const width = window.innerWidth <= 600 ? 380 : 420, height = 240;
    ui.modeChart.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
    const rows = report.comparator.modes.map((mode) => ({
      modeId: mode.modeId, modeLabel: mode.modeLabel,
      row: mode.rows.find((item) => item.strategyId === state.strategy),
    }));
    const maxValue = Math.max(1, ...rows.map((entry) => Math.max(entry.row.totalTravelMin, entry.row.totalSpanMin)));
    const left = 60, right = width - 16, top = 30, bottom = 176;
    const groupW = (right - left) / rows.length;
    const y = (value) => bottom - (value / maxValue) * (bottom - top);
    ui.modeChart.replaceChildren(svgNode('title', {}, 'Travel minutes and day span by transit mode'));
    for (const tick of [0, Math.round(maxValue / 2), maxValue]) {
      ui.modeChart.append(svgNode('line', { x1: left, x2: right, y1: y(tick), y2: y(tick), class: 'grid-line' }));
      ui.modeChart.append(svgNode('text', { x: left - 9, y: y(tick) + 4, class: 'chart-label', 'text-anchor': 'end' }, tick));
    }
    rows.forEach((entry, index) => {
      const gx = left + index * groupW;
      const group = svgNode('g', { class: 'lab-mode-group', tabindex: '0', role: 'button', 'data-mode': entry.modeId, 'aria-label': entry.modeLabel + ', ' + entry.row.totalTravelMin + ' min travel, ' + entry.row.totalSpanMin + ' min day span' });
      group.append(
        svgNode('rect', { x: gx + 3, y: top - 6, width: groupW - 6, height: bottom - top + 26, class: 'lab-mode-hit' }),
        svgNode('rect', { x: gx + groupW * 0.18, y: y(entry.row.totalTravelMin), width: groupW * 0.26, height: bottom - y(entry.row.totalTravelMin), class: 'lab-bar-travel' }),
        svgNode('rect', { x: gx + groupW * 0.56, y: y(entry.row.totalSpanMin), width: groupW * 0.26, height: bottom - y(entry.row.totalSpanMin), class: 'lab-bar-span' }),
        svgNode('text', { x: gx + groupW / 2, y: bottom + 18, class: 'chart-label', 'text-anchor': 'middle' }, entry.modeLabel),
      );
      if (entry.modeId === state.mode) group.append(svgNode('rect', { x: gx + 3, y: top - 6, width: groupW - 6, height: bottom - top + 26, class: 'lab-mode-frame' }));
      ui.modeChart.append(group);
    });
    ui.modeChart.append(svgNode('rect', { x: left, y: 206, width: 10, height: 10, class: 'lab-bar-travel' }), svgNode('text', { x: left + 16, y: 215, class: 'chart-label' }, 'travel min'));
    ui.modeChart.append(svgNode('rect', { x: left + 96, y: 206, width: 10, height: 10, class: 'lab-bar-span' }), svgNode('text', { x: left + 112, y: 215, class: 'chart-label' }, 'day span min'));
  }
  function download(content, filename, type) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const link = node('a');
    link.href = url;
    link.download = filename;
    link.hidden = true;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function wireEvents() {
    ui.day.addEventListener('change', () => { state.day = ui.day.value; syncHash(); requestReport(); });
    ui.mode.addEventListener('change', () => { state.mode = ui.mode.value; syncHash(); requestReport(); });
    ui.chips.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-strategy]');
      if (!button) return;
      state.strategy = button.dataset.strategy;

      syncControls();
      syncHash();
      render();
    });
    ui.tbody.addEventListener('click', (event) => {
      const row = event.target.closest('tr[data-mode]');
      if (!row) return;
      state.mode = row.dataset.mode;
      state.strategy = row.dataset.strategy;

      syncControls();
      syncHash();
      requestReport();
    });
    ui.tbody.addEventListener('keydown', (event) => {
      if (!['Enter', ' '].includes(event.key)) return;
      const row = event.target.closest('tr[data-mode]');
      if (row) {
        event.preventDefault();
        row.click();
      }
    });
    ui.tipChart.addEventListener('click', (event) => {
      const marker = event.target.closest('.lab-tip-point');
      if (!marker) return;
      state.delay = Number(marker.dataset.delay);
      syncHash();
      renderTipChart(state.report);
    });
    ui.tipChart.addEventListener('keydown', (event) => {
      const marker = event.target.closest('.lab-tip-point');
      if (!marker) return;
      const current = Number(marker.dataset.delay);
      if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
        event.preventDefault();
        const next = Math.min(15, Math.max(0, current + (event.key === 'ArrowRight' ? 1 : -1)));
        const target = ui.tipChart.querySelector('.lab-tip-point[data-delay="' + next + '"]');
        if (target) target.focus();
      }
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        state.delay = current;
        syncHash();
        renderTipChart(state.report);
      }
    });
    ui.modeChart.addEventListener('click', (event) => {
      const group = event.target.closest('.lab-mode-group');
      if (!group) return;
      state.mode = group.dataset.mode;

      syncControls();
      syncHash();
      requestReport();
    });
    ui.modeChart.addEventListener('keydown', (event) => {
      if (!['Enter', ' '].includes(event.key)) return;
      const group = event.target.closest('.lab-mode-group');
      if (group) {
        event.preventDefault();
        state.mode = group.dataset.mode;

        syncControls();
        syncHash();
        requestReport();
      }
    });
    ui.btnJson.addEventListener('click', () => {
      if (!state.report) return;
      download(exportProofJson(state.report.stamped), 'loopless-proof.json', 'application/json');
      ui.status.textContent = 'Proof JSON downloaded / sha256 ' + state.report.digest.slice(0, 16) + '...';
    });
    ui.btnCsv.addEventListener('click', () => {
      if (!state.report) return;
      download(exportProofCsv(state.report.stamped), 'loopless-proof.csv', 'text/csv;charset=utf-8');
      ui.status.textContent = 'Proof CSV downloaded / formula-safe cells / sha256 ' + state.report.digest.slice(0, 16) + '...';
    });
    ui.btnMd.addEventListener('click', () => {
      if (!state.report) return;
      download(exportProofMarkdown(state.report.stamped), 'loopless-proof.md', 'text/markdown;charset=utf-8');
      ui.status.textContent = 'Proof Markdown downloaded / sha256 ' + state.report.digest.slice(0, 16) + '...';
    });
    ui.btnLink.addEventListener('click', async () => {
      const url = location.href.split('#')[0] + encodeLabHash({ day: state.day, mode: state.mode, strategy: state.strategy, delay: state.delay });
      try {
        await navigator.clipboard.writeText(url);
        ui.status.textContent = 'Lab link copied.';
      } catch {
        ui.status.textContent = url;
      }
      if (!location.hash || location.hash.startsWith('#llab=')) history.replaceState(null, '', encodeLabHash({ day: state.day, mode: state.mode, strategy: state.strategy, delay: state.delay }));
    });
    ui.btnVerify.addEventListener('click', () => {
      if (!state.report) return;
      const result = verifyStamped(state.report.stamped);
      ui.status.textContent = result.ok
        ? 'Verified / recomputed digest matches ' + result.digest.slice(0, 16) + '...'
        : 'Verification failed / ' + result.recomputed.slice(0, 16) + '... vs ' + result.digest.slice(0, 16) + '...';
      ui.status.classList.toggle('is-error', !result.ok);
    });
    ui.btnTamper.addEventListener('click', () => {
      if (!state.report) return;
      const dirty = buildTamperedStamped(state.report.stamped);
      const result = verifyStamped(dirty);
      ui.status.textContent = result.ok
        ? 'Tamper demo failed to tamper.'
        : 'Tamper detected / one travel minute changed, digest no longer matches.';
      ui.status.classList.add('is-error');
      setTimeout(() => ui.status.classList.remove('is-error'), 4000);
    });
    ui.runTests.addEventListener('click', () => {
      ui.testStatus.textContent = 'Running deterministic lab self-tests...';
      ui.runTests.disabled = true;
      setTimeout(() => {
        const outcome = runSelfTests();

        ui.testStatus.textContent = outcome.passed + '/' + outcome.total + ' passing';
        ui.testStatus.classList.toggle('is-error', !outcome.ok);
        ui.testList.replaceChildren(...outcome.results.map((result) => node('li', result.ok ? 'is-pass' : 'is-fail', (result.ok ? 'PASS ' : 'FAIL ') + result.name + (result.ok ? '' : ' / ' + result.detail))));
        ui.runTests.disabled = false;
      }, 0);
    });
    window.addEventListener('hashchange', () => {
      if (!location.hash.startsWith('#llab=')) return;
      try {
        const decoded = decodeLabHash(location.hash, dayIds);
        const changed = decoded.day !== state.day || decoded.mode !== state.mode || decoded.strategy !== state.strategy || decoded.delay !== state.delay;
        state.day = decoded.day;
        state.mode = decoded.mode;
        state.strategy = decoded.strategy;
        state.delay = decoded.delay;

        syncControls();
        if (changed) requestReport();
      } catch {
        ui.status.textContent = 'That lab link is not valid. Showing the current lab.';
      }
    });
    document.addEventListener('loopless:tour', (event) => {
      state.storedTour = event.detail ?? state.storedTour;
      if (state.day === 'current') requestReport();
    });
    window.addEventListener('storage', (event) => {
      if (event.key !== STORAGE_KEY || state.day !== 'current') return;
      state.storedTour = storedDay();
      requestReport();
    });
    window.addEventListener('resize', () => {
      if (state.report) {
        renderTipChart(state.report);
        renderModeChart(state.report);
      }
    });
  }
  state.storedTour = storedDay();
  if (location.hash.startsWith('#llab=')) {
    try {
      const decoded = decodeLabHash(location.hash, dayIds);
      state.day = decoded.day;
      state.mode = decoded.mode;
      state.strategy = decoded.strategy;
      state.delay = decoded.delay;
    } catch { /* A malformed lab hash falls back to defaults. */ }
  } else {
    const tour = activeTour();
    state.mode = Object.prototype.hasOwnProperty.call(TRANSIT_MODES, tour.mode) ? tour.mode : 'bike';
    state.delay = Number.isInteger(tour.transitJitterMin) ? Math.min(15, Math.max(0, tour.transitJitterMin)) : 0;
  }
  try {
    state.worker = new Worker(new URL('./solver-worker.mjs?v=studio-c49dfe94a109', import.meta.url), { type: 'module' });
    state.worker.addEventListener('message', (event) => acceptReport(event.data));
    state.worker.addEventListener('error', (event) => {
      event.preventDefault();
      state.worker = null;
      if (state.report == null) requestReport();
    });
    state.worker.addEventListener('messageerror', () => {
      state.worker = null;
      if (state.report == null) requestReport();
    });
  } catch {
    state.worker = null;
  }
  fillControls();
  syncControls();
  wireEvents();
  requestReport();
}
