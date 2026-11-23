/**
 * LoopLess Branch-and-Bound pruning, delay tipping-point, and strategy-regret lab.
 * Pure browser-safe ES module: no DOM, no storage, no network, no clocks.
 * Every number is recomputed deterministically from the same solver the studio uses.
 */
import {
  TRANSIT_MODES,
  BNB_NODE_BUDGET,
  normalizeScenario,
  evaluateOrder,
  compareSchedules,
  baselineFifo,
  baselineEdf,
  baselineNearest,
  solveOptimal,
} from './planner.mjs?v=studio-c49dfe94a109';
import { validateTour } from './studio.mjs?v=studio-c49dfe94a109';
import { STUDIO_PRESETS } from './presets.mjs?v=studio-c49dfe94a109';

export const LAB_VERSION = 1;
export const LAB_DELAY_MIN = 0;
export const LAB_DELAY_MAX = 15;
export const LAB_HASH_PREFIX = '#llab=';
const SHA_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
const SHA_H0 = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
const rotr = (x, n) => ((x >>> n) | (x << (32 - n))) >>> 0;

/** FIPS 180-4 SHA-256 over a string (UTF-8) or Uint8Array. Returns 32 bytes. */
export function sha256Bytes(data) {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  if (!(bytes instanceof Uint8Array)) throw new Error('SHA-256 input must be a string or Uint8Array');
  const padded = new Uint8Array((((bytes.length + 9) + 63) >> 6) << 6);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  const bitLen = bytes.length * 8;
  view.setUint32(padded.length - 8, Math.floor(bitLen / 0x100000000));
  view.setUint32(padded.length - 4, bitLen >>> 0);
  const H = new Uint32Array(SHA_H0);
  const W = new Uint32Array(64);
  for (let off = 0; off < padded.length; off += 64) {
    for (let t = 0; t < 16; t += 1) W[t] = view.getUint32(off + t * 4);
    for (let t = 16; t < 64; t += 1) {
      const s0 = rotr(W[t - 15], 7) ^ rotr(W[t - 15], 18) ^ (W[t - 15] >>> 3);
      const s1 = rotr(W[t - 2], 17) ^ rotr(W[t - 2], 19) ^ (W[t - 2] >>> 10);
      W[t] = (W[t - 16] + s0 + W[t - 7] + s1) >>> 0;
    }
    let a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
    for (let t = 0; t < 64; t += 1) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = ((e & f) ^ (~e & g)) >>> 0;
      const t1 = (h + s1 + ch + SHA_K[t] + W[t]) >>> 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
      const t2 = (s0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
  }
  const out = new Uint8Array(32);
  const result = new DataView(out.buffer);
  for (let i = 0; i < 8; i += 1) result.setUint32(i * 4, H[i]);
  return out;
}

export function sha256Hex(data) {
  let hex = '';
  for (const byte of sha256Bytes(data)) hex += byte.toString(16).padStart(2, '0');
  return hex;
}

/** Deterministic JSON with recursively sorted object keys. Rejects anything else. */
export function canonicalJson(value) {
  const seen = new Set();
  const encode = (v) => {
    if (v === null) return 'null';
    const t = typeof v;
    if (t === 'boolean') return v ? 'true' : 'false';
    if (t === 'number') {
      if (!Number.isFinite(v)) throw new Error('Non-finite numbers cannot be canonicalized');
      return Object.is(v, -0) ? '0' : String(v);
    }
    if (t === 'string') return JSON.stringify(v);
    if (Array.isArray(v)) {
      if (seen.has(v)) throw new Error('Circular arrays cannot be canonicalized');
      seen.add(v);
      const out = '[' + v.map(encode).join(',') + ']';
      seen.delete(v);
      return out;
    }
    if (t === 'object') {
      const proto = Object.getPrototypeOf(v);
      if (proto !== Object.prototype && proto !== null) throw new Error('Only plain objects can be canonicalized');
      if (seen.has(v)) throw new Error('Circular objects cannot be canonicalized');
      seen.add(v);
      const keys = Object.keys(v).filter((k) => v[k] !== undefined).sort();
      const out = '{' + keys.map((k) => JSON.stringify(k) + ':' + encode(v[k])).join(',') + '}';
      seen.delete(v);
      return out;
    }
    throw new Error('Unsupported value cannot be canonicalized');
  };
  return encode(value);
}

export const LAB_STRATEGIES = Object.freeze({
  'fifo': Object.freeze({ id: 'fifo', label: 'Listed order (FIFO)', short: 'FIFO', constructive: true }),
  'edf': Object.freeze({ id: 'edf', label: 'Earliest deadline first', short: 'EDF', constructive: true }),
  'nearest-neighbor': Object.freeze({ id: 'nearest-neighbor', label: 'Nearest neighbor', short: 'Nearest', constructive: true }),
  'loopless-exact': Object.freeze({ id: 'loopless-exact', label: 'LoopLess exact search', short: 'LoopLess', constructive: false }),
});
export const LAB_STRATEGY_IDS = Object.freeze(Object.keys(LAB_STRATEGIES));
const RESERVED_TOKENS = new Set(['__proto__', 'prototype', 'constructor', '__anchor__']);

function ownToken(table, key, label) {
  if (typeof key !== 'string' || RESERVED_TOKENS.has(key) || !Object.prototype.hasOwnProperty.call(table, key)) {
    throw new Error(`Unknown ${label} "${String(key)}"`);
  }
  return table[key];
}

function delayIn(value, fallback = 0) {
  const delay = value ?? fallback;
  if (typeof delay !== 'number' || !Number.isInteger(delay) || delay < LAB_DELAY_MIN || delay > LAB_DELAY_MAX) {
    throw new Error(`Delay must be an integer from ${LAB_DELAY_MIN} to ${LAB_DELAY_MAX} minutes`);
  }
  return delay;
}

/** Run one named strategy on an already normalized scenario; returns schedule plus honest telemetry. */
export function runLabStrategy(scenario, strategyId) {
  const spec = ownToken(LAB_STRATEGIES, strategyId, 'strategy');
  if (spec.id === 'fifo') return { schedule: baselineFifo(scenario), telemetry: { kind: 'constructive-fifo', nodesExplored: null } };
  if (spec.id === 'edf') return { schedule: baselineEdf(scenario), telemetry: { kind: 'constructive-edf', nodesExplored: null } };
  if (spec.id === 'nearest-neighbor') return { schedule: baselineNearest(scenario), telemetry: { kind: 'constructive-nearest', nodesExplored: null } };
  const solved = solveOptimal(scenario);
  return { schedule: solved.optimal, telemetry: { kind: solved.method, nodesExplored: solved.nodesExplored } };
}

function metricRow(modeId, strategyId, outcome, fifoSchedule) {
  const spec = LAB_STRATEGIES[strategyId];
  const schedule = outcome.schedule;
  return {
    modeId,
    strategyId,
    strategyLabel: spec.label,
    strategyShort: spec.short,
    missedDeadlines: schedule.missedDeadlines,
    totalLatenessMin: schedule.totalLatenessMin,
    totalSpanMin: schedule.totalSpanMin,
    totalTravelMin: schedule.totalTravelMin,
    totalWaitMin: schedule.totalWaitMin,
    minBufferSlackMin: schedule.minBufferSlackMin,
    feasible: schedule.feasible,
    onTime: schedule.legTimeline.length - schedule.missedDeadlines,
    stopCount: schedule.legTimeline.length,
    travelSavedVsFifoMin: fifoSchedule.totalTravelMin - schedule.totalTravelMin,
    rescuedDeadlines: fifoSchedule.missedDeadlines - schedule.missedDeadlines,
    method: outcome.telemetry.kind,
    nodesExplored: outcome.telemetry.nodesExplored,
    orderIds: [...schedule.orderIds],
  };
}

/** Four strategies x four transit modes, all evaluated by the same solver and model. */
export function compareStrategyModes(rawTour) {
  const tour = validateTour(rawTour);
  const modes = Object.values(TRANSIT_MODES).map((mode) => {
    const scenario = normalizeScenario({ ...tour, mode: mode.id });
    const outcomes = new Map();
    for (const strategyId of LAB_STRATEGY_IDS) outcomes.set(strategyId, runLabStrategy(scenario, strategyId));
    const fifoSchedule = outcomes.get('fifo').schedule;
    return {
      modeId: mode.id,
      modeLabel: mode.id === 'car' ? 'Carpool' : mode.label,
      rows: LAB_STRATEGY_IDS.map((strategyId) => metricRow(mode.id, strategyId, outcomes.get(strategyId), fifoSchedule)),
    };
  });
  return { modes, modeIds: modes.map((mode) => mode.modeId) };
}

/** Every strategy re-evaluated at each whole-minute delay from +0 to +15 on one mode. */
export function buildDelayMatrix(rawTour, modeId = 'bike') {
  const tour = validateTour(rawTour);
  const mode = ownToken(TRANSIT_MODES, modeId, 'transit mode');
  const strategies = LAB_STRATEGY_IDS.map((strategyId) => {
    const spec = LAB_STRATEGIES[strategyId];
    let tippingPointMin = null;
    let allExact = true;
    const points = [];
    for (let delayMin = LAB_DELAY_MIN; delayMin <= LAB_DELAY_MAX; delayMin += 1) {
      const scenario = normalizeScenario({ ...tour, mode: mode.id, transitJitterMin: delayMin });
      const outcome = runLabStrategy(scenario, strategyId);
      const schedule = outcome.schedule;
      const exactPoint = outcome.telemetry.kind === 'exact' || outcome.telemetry.kind === 'exact-bnb' || spec.constructive;
      if (!exactPoint) allExact = false;
      if (tippingPointMin === null && schedule.missedDeadlines > 0) tippingPointMin = delayMin;
      points.push({
        delayMin,
        missedDeadlines: schedule.missedDeadlines,
        minSlackMin: schedule.minBufferSlackMin,
        travelMin: schedule.totalTravelMin,
        spanMin: schedule.totalSpanMin,
        latenessMin: schedule.totalLatenessMin,
        method: outcome.telemetry.kind,
        nodesExplored: outcome.telemetry.nodesExplored,
        lateStopIds: schedule.legTimeline.filter((leg) => !leg.onTime).map((leg) => leg.stopId),
      });
    }
    return { strategyId, label: spec.label, short: spec.short, constructive: spec.constructive, points, tippingPointMin, allExact };
  });
  return { modeId: mode.id, modeLabel: mode.id === 'car' ? 'Carpool' : mode.label, strategies };
}

export function firstBreakDelay(points) {
  const first = points.find((point) => point.missedDeadlines > 0);
  return first ? first.delayMin : null;
}

function proofDay(tour) {
  return {
    id: tour.id, title: tour.title, mode: tour.mode, metric: tour.metric,
    startTime: tour.startTime, returnToAnchor: tour.returnToAnchor, transitJitterMin: tour.transitJitterMin,
    anchor: { name: tour.anchor.name, x: tour.anchor.x, y: tour.anchor.y },
    stops: tour.stops.map((stop) => ({
      id: stop.id, name: stop.name, x: stop.x, y: stop.y, durationMin: stop.durationMin,
      windowStart: stop.windowStart, windowEnd: stop.windowEnd, priority: stop.priority,
      category: stop.category, dependsOn: stop.dependsOn,
    })),
  };
}

function slimRow(row) {
  const { orderIds, ...rest } = row;
  return { ...rest, orderIds };
}

/** One deterministic proof payload: no timestamps, no randomness, sorted at export time. */
export function buildProofPayload(report) {
  return {
    schema: 'loopless-lab-proof',
    version: LAB_VERSION,
    day: proofDay(report.tour),
    lab: { modeId: report.modeId, focusStrategyId: report.focusStrategyId, delayMin: report.delayMin },
    comparator: report.comparator.modes.map((mode) => ({
      modeId: mode.modeId, modeLabel: mode.modeLabel, rows: mode.rows.map(slimRow),
    })),
    delayMatrix: {
      modeId: report.delayMatrix.modeId,
      strategies: report.delayMatrix.strategies.map((strategy) => ({
        strategyId: strategy.strategyId,
        tippingPointMin: strategy.tippingPointMin,
        allExact: strategy.allExact,
        points: strategy.points.map(({ lateStopIds, ...point }) => ({ ...point, lateStopIds })),
      })),
    },
    scope: 'Synthetic mile grid, constant mode speeds, whole-minute delay sweep. No GPS, traffic, or transit timetables. Constructive rows are deterministic baselines; only LoopLess rows claim a search result.',
  };
}

/** Single-entry-per-key digest cache so every export surface shares one digest. */
export function createProofCache(limit = 32) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 256) throw new Error('Proof cache limit must be an integer from 1 to 256');
  const map = new Map();
  return {
    stamp(proof) {
      const stateKey = canonicalJson(proof);
      const cached = map.get(stateKey);
      if (cached) return { stamped: cached, stateKey, cached: true };
      const digest = sha256Hex(stateKey);
      const stamped = {
        proof,
        integrity: { algorithm: 'SHA-256', canonical: 'sorted-key-json-v1', digest },
      };
      if (map.size >= limit) map.delete(map.keys().next().value);
      map.set(stateKey, stamped);
      return { stamped, stateKey, cached: false };
    },
    get size() { return map.size; },
  };
}

const sharedProofCache = createProofCache();

/** Full lab computation for one day: 4x4 comparator plus a 16-point delay matrix. */
export function buildLabReport(rawTour, options = {}) {
  const tour = validateTour(rawTour);
  const modeId = ownToken(TRANSIT_MODES, options.modeId ?? tour.mode ?? 'bike', 'transit mode').id;
  const focusStrategyId = ownToken(LAB_STRATEGIES, options.focusStrategyId ?? 'loopless-exact', 'strategy').id;
  const delayMin = delayIn(options.delayMin ?? tour.transitJitterMin ?? 0);
  const cache = options.cache ?? sharedProofCache;
  const comparator = compareStrategyModes(tour);
  const delayMatrix = buildDelayMatrix(tour, modeId);
  const report = { tour, modeId, focusStrategyId, delayMin, comparator, delayMatrix };
  const proof = buildProofPayload(report);
  const { stamped, stateKey } = cache.stamp(proof);
  return { ...report, proof, stamped, stateKey, digest: stamped.integrity.digest };
}

export function verifyStamped(stamped) {
  if (!stamped || typeof stamped !== 'object' || Array.isArray(stamped)) throw new Error('A stamped proof object is required');
  if (!stamped.proof || !stamped.integrity || typeof stamped.integrity.digest !== 'string') throw new Error('Malformed stamped proof');
  const recomputed = sha256Hex(canonicalJson(stamped.proof));
  return { ok: recomputed === stamped.integrity.digest, digest: stamped.integrity.digest, recomputed };
}

/** Returns a copy with one numeric field perturbed; its digest check must fail. */
export function buildTamperedStamped(stamped) {
  if (!stamped || typeof stamped !== 'object' || !stamped.proof || !stamped.integrity) throw new Error('A stamped proof object is required');
  const clone = structuredClone(stamped);
  const row = clone.proof.comparator[0].rows.find((item) => item.strategyId === 'loopless-exact') ?? clone.proof.comparator[0].rows[0];
  row.totalTravelMin += 1;
  return clone;
}

const FORMULA_TRIGGER = /^[=+\-@]/;
/** Spreadsheet-safe cell: quotes commas/newlines, prefixes formula triggers with a single quote. */
export function csvCell(value) {
  let text = value == null ? '' : String(value);
  if (FORMULA_TRIGGER.test(text)) text = "'" + text;
  if (/[",\r\n\t]/.test(text)) text = '"' + text.replace(/"/g, '""') + '"';
  return text;
}

export function csvRow(values) {
  return values.map(csvCell).join(',');
}

export function exportProofJson(stamped) {
  if (!stamped || !stamped.proof || !stamped.integrity) throw new Error('A stamped proof object is required');
  return JSON.stringify(stamped, null, 2) + '\n';
}

export function exportProofCsv(stamped) {
  if (!stamped || !stamped.proof || !stamped.integrity) throw new Error('A stamped proof object is required');
  const { proof, integrity } = stamped;
  const lines = [
    csvRow(['# LoopLess schedule proof', 'sha256=' + integrity.digest]),
    csvRow(['# Day', proof.day.title, 'mode ' + proof.lab.modeId, 'delay +' + proof.lab.delayMin + ' min']),
    '',
    csvRow(['mode', 'strategy', 'on_time', 'missed', 'lateness_min', 'travel_min', 'day_span_min', 'min_margin_min', 'saved_vs_fifo_min', 'rescued', 'search', 'nodes']),
  ];
  for (const mode of proof.comparator) {
    for (const row of mode.rows) {
      lines.push(csvRow([
        mode.modeLabel, row.strategyLabel, row.onTime + '/' + row.stopCount, row.missedDeadlines,
        row.totalLatenessMin, row.totalTravelMin, row.totalSpanMin, row.minBufferSlackMin,
        row.travelSavedVsFifoMin, row.rescuedDeadlines, row.method, row.nodesExplored == null ? 'n/a' : row.nodesExplored,
      ]));
    }
  }
  lines.push('');
  lines.push(csvRow(['delay_min', 'fifo_missed', 'fifo_min_margin', 'edf_missed', 'edf_min_margin', 'nearest_missed', 'nearest_min_margin', 'loopless_missed', 'loopless_min_margin']));
  const byStrategy = new Map(proof.delayMatrix.strategies.map((strategy) => [strategy.strategyId, strategy.points]));
  for (let delay = LAB_DELAY_MIN; delay <= LAB_DELAY_MAX; delay += 1) {
    const cells = ['+' + delay];
    for (const strategyId of LAB_STRATEGY_IDS) {
      const point = byStrategy.get(strategyId)[delay];
      cells.push(point.missedDeadlines, point.minSlackMin);
    }
    lines.push(csvRow(cells));
  }
  return lines.join('\r\n') + '\r\n';
}

export function exportProofMarkdown(stamped) {
  if (!stamped || !stamped.proof || !stamped.integrity) throw new Error('A stamped proof object is required');
  const { proof, integrity } = stamped;
  const lines = [
    '# LoopLess schedule proof',
    '',
    'Day: ' + proof.day.title + ' (' + proof.day.id + '). Mode under test: ' + proof.lab.modeId + '. Delay under test: +' + proof.lab.delayMin + ' min per moving leg.',
    '',
    '## Strategy by mode comparator',
    '',
    '| Mode | Strategy | On time | Travel | Day span | Min margin | Saved vs FIFO | Rescued | Search |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ];
  for (const mode of proof.comparator) {
    for (const row of mode.rows) {
      lines.push('| ' + [mode.modeLabel, row.strategyLabel, row.onTime + '/' + row.stopCount, row.totalTravelMin + ' min', row.totalSpanMin + ' min', row.minBufferSlackMin + ' min', row.travelSavedVsFifoMin + ' min', row.rescuedDeadlines, row.method + (row.nodesExplored == null ? '' : ' / ' + row.nodesExplored + ' nodes')].join(' | ') + ' |');
    }
  }
  lines.push('', '## Delay tipping matrix (' + proof.delayMatrix.modeId + ')', '');
  for (const strategy of proof.delayMatrix.strategies) {
    const spec = LAB_STRATEGIES[strategy.strategyId];
    lines.push('- ' + spec.label + ': ' + (strategy.tippingPointMin === null ? 'no missed deadline through +15 min' : 'first missed deadline at +' + strategy.tippingPointMin + ' min') + (strategy.allExact ? '' : ' (bounded points labeled)'));
  }
  lines.push(
    '',
    'Scope: ' + proof.scope,
    '',
    'Proof SHA-256: ' + integrity.digest,
    '',
    'Deterministic on-device proof over ' + proof.day.stops.length + ' stops. Verify by re-canonicalizing the proof object and recomputing the digest.',
  );
  return lines.join('\n') + '\n';
}

const HASH_TOKEN = /^[a-z0-9_-]{1,48}$/;

export function encodeLabHash(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) throw new Error('Lab state object required');
  const day = state.day ?? 'current';
  const mode = ownToken(TRANSIT_MODES, state.mode, 'transit mode').id;
  const strategy = ownToken(LAB_STRATEGIES, state.strategy, 'strategy').id;
  const delay = delayIn(state.delay);
  if (day !== 'current' && (!HASH_TOKEN.test(day) || RESERVED_TOKENS.has(day))) throw new Error('Unknown lab day');
  return `${LAB_HASH_PREFIX}v${LAB_VERSION}.${day}.${mode}.${strategy}.${delay}`;
}

/** Strict #llab= decoder. dayIds lists resolvable day tokens; 'current' is always allowed. */
export function decodeLabHash(hash, dayIds = []) {
  if (typeof hash !== 'string') throw new Error('Lab link must be a string');
  if (!hash.startsWith(LAB_HASH_PREFIX)) throw new Error('Not a lab link');
  const body = hash.slice(LAB_HASH_PREFIX.length);
  if (body.length === 0 || body.length > 260) throw new Error('Malformed lab link');
  const parts = body.split('.');
  if (parts.length !== 5 || parts[0] !== 'v' + LAB_VERSION) throw new Error('Unsupported lab link version');
  const [, day, mode, strategy, delayText] = parts;
  for (const token of [day, mode, strategy]) {
    if (!HASH_TOKEN.test(token) || RESERVED_TOKENS.has(token)) throw new Error('Malformed lab link token');
  }
  const allowedDays = new Set(['current', ...dayIds]);
  if (!allowedDays.has(day)) throw new Error('Unknown lab day');
  const modeId = ownToken(TRANSIT_MODES, mode, 'transit mode').id;
  const strategyId = ownToken(LAB_STRATEGIES, strategy, 'strategy').id;
  if (!/^[0-9]{1,2}$/.test(delayText)) throw new Error('Malformed lab delay');
  const delay = delayIn(Number(delayText));
  return { day, mode: modeId, strategy: strategyId, delay };
}

function smallDay(stops, extras = {}) {
  return validateTour({
    id: 'lab-self-test', title: 'Lab self-test day', mode: 'bike', metric: 'manhattan',
    startTime: '10:00', returnToAnchor: true, transitJitterMin: 0,
    anchor: { name: 'Base', x: 0, y: 0 },
    stops,
    ...extras,
  });
}

function bruteForceBest(scenario) {
  const byId = new Map(scenario.stops.map((stop) => [stop.id, stop]));
  const ids = scenario.stops.map((stop) => stop.id);
  let best = null;
  const permute = (index) => {
    if (index === ids.length) {
      const seen = new Set();
      for (const id of ids) {
        const stop = byId.get(id);
        if (stop.dependsOn && !seen.has(stop.dependsOn)) return;
        seen.add(id);
      }
      const evaluation = evaluateOrder(scenario, ids);
      if (!best || compareSchedules(evaluation, best) < 0) best = evaluation;
      return;
    }
    for (let i = index; i < ids.length; i += 1) {
      [ids[index], ids[i]] = [ids[i], ids[index]];
      permute(index + 1);
      [ids[index], ids[i]] = [ids[i], ids[index]];
    }
  };
  permute(0);
  return best;
}

/** Deterministic in-page self-tests. Each run() returns true or throws. */
export const SELF_TESTS = Object.freeze([
  { id: 'sha-empty', name: 'SHA-256 known vector: empty message', run() { return sha256Hex('') === 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'; } },
  { id: 'sha-abc', name: 'SHA-256 known vector: abc', run() { return sha256Hex('abc') === 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'; } },
  { id: 'sha-56', name: 'SHA-256 known vector: 56-byte message', run() { return sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq') === '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1'; } },
  { id: 'sha-long', name: 'SHA-256 known vector: one million a characters', run() { return sha256Hex('a'.repeat(1000000)) === 'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0'; } },
  { id: 'sha-utf8', name: 'SHA-256 hashes raw UTF-8 bytes for multibyte text', run() { const text = 'Caf' + String.fromCharCode(233); return sha256Hex(text) === sha256Hex(new TextEncoder().encode(text)); } },
  { id: 'canon-order', name: 'Canonical JSON ignores key order', run() { return canonicalJson({ b: 1, a: [3, { z: 1, y: 2 }] }) === canonicalJson({ a: [3, { y: 2, z: 1 }], b: 1 }); } },
  { id: 'canon-strict', name: 'Canonical JSON rejects NaN, Infinity, and class instances', run() {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, new Date(0), new Map()]) {
      let threw = false;
      try { canonicalJson(bad); } catch { threw = true; }
      if (!threw) return false;
    }
    return true;
  } },
  { id: 'oracle-gap', name: 'Branch-and-Bound matches a brute-force oracle on small tours', run() {
    const cases = [
      smallDay([
        { id: 'a', name: 'Near errand', x: 0.4, y: 0.1, durationMin: 10, windowStart: '10:00', windowEnd: '11:00', priority: 2 },
        { id: 'b', name: 'Far errand', x: 2.2, y: 1.1, durationMin: 15, windowStart: '10:00', windowEnd: '11:30', priority: 3 },
        { id: 'c', name: 'Late errand', x: -1.0, y: -0.5, durationMin: 10, windowStart: '10:30', windowEnd: '12:30', priority: 1 },
      ]),
      smallDay([
        { id: 'x', name: 'Tight errand', x: 1.4, y: 0.6, durationMin: 15, windowStart: '10:00', windowEnd: '10:45', priority: 3 },
        { id: 'y', name: 'Depends errand', x: 1.6, y: 0.5, durationMin: 10, windowStart: '10:00', windowEnd: '12:00', priority: 2, dependsOn: 'x' },
        { id: 'z', name: 'Wide errand', x: -0.6, y: 0.4, durationMin: 20, windowStart: '10:00', windowEnd: '13:00', priority: 1 },
      ], { metric: 'euclidean', returnToAnchor: false }),
    ];
    for (const tour of cases) {
      const scenario = normalizeScenario(tour);
      const solved = solveOptimal(scenario);
      const oracle = bruteForceBest(scenario);
      if (solved.method !== 'exact-bnb' || compareSchedules(solved.optimal, oracle) !== 0) return false;
    }
    return true;
  } },
  { id: 'dominance', name: 'LoopLess beats or ties FIFO, EDF, and Nearest on every mode of the default day', run() {
    const comparator = compareStrategyModes(STUDIO_PRESETS[0]);
    for (const mode of comparator.modes) {
      const exact = mode.rows.find((row) => row.strategyId === 'loopless-exact');
      for (const row of mode.rows) {
        if (row.strategyId === 'loopless-exact') continue;
        const scenario = normalizeScenario({ ...validateTour(STUDIO_PRESETS[0]), mode: mode.modeId });
        const a = evaluateOrder(scenario, exact.orderIds);
        const b = evaluateOrder(scenario, row.orderIds);
        if (compareSchedules(a, b) > 0) return false;
      }
    }
    return true;
  } },
  { id: 'default-savings', name: 'Default day saves exactly 56 travel minutes and rescues 3 deadlines', run() {
    const comparator = compareStrategyModes(STUDIO_PRESETS[0]);
    const bike = comparator.modes.find((mode) => mode.modeId === 'bike');
    const exact = bike.rows.find((row) => row.strategyId === 'loopless-exact');
    return exact.travelSavedVsFifoMin === 56 && exact.rescuedDeadlines === 3 && exact.missedDeadlines === 0;
  } },
  { id: 'tipping-default', name: 'Default day stays feasible at +12 min and first breaks at +13', run() {
    const matrix = buildDelayMatrix(STUDIO_PRESETS[0], 'bike');
    const exact = matrix.strategies.find((strategy) => strategy.strategyId === 'loopless-exact');
    return exact.tippingPointMin === 13
      && exact.points[12].missedDeadlines === 0 && exact.points[12].minSlackMin === 1
      && exact.points[13].missedDeadlines === 1;
  } },
  { id: 'cycle-reject', name: 'Prerequisite cycles are rejected before any search runs', run() {
    let threw = false;
    try {
      buildLabReport({
        id: 'cyc', title: 'Cycle', startTime: '10:00',
        stops: [
          { id: 'a', name: 'A', x: 0, y: 0, durationMin: 5, windowStart: '10:00', windowEnd: '12:00', priority: 1, dependsOn: 'b' },
          { id: 'b', name: 'B', x: 1, y: 0, durationMin: 5, windowStart: '10:00', windowEnd: '12:00', priority: 1, dependsOn: 'a' },
        ],
      });
    } catch { threw = true; }
    return threw;
  } },
  { id: 'budget-honest', name: 'A one-node budget is labeled bounded and never claims exactness', run() {
    const scenario = normalizeScenario(validateTour(STUDIO_PRESETS[0]));
    const solved = solveOptimal(scenario, { nodeBudget: 1 });
    return solved.method === 'bounded-bnb' && compareSchedules(solved.optimal, solved.baselines.fifo) <= 0;
  } },
  { id: 'csv-escape', name: 'CSV cells escape formula triggers and embedded quotes', run() {
    return csvCell('=CMD()') === "'=CMD()"
      && csvCell('+1') === "'+1" && csvCell('-2') === "'-2" && csvCell('@x') === "'@x"
      && csvCell('a,b') === '"a,b"' && csvCell('say "hi"') === '"say ""hi"""';
  } },
  { id: 'tamper-detect', name: 'A perturbed proof fails digest verification', run() {
    const report = buildLabReport(smallDay([{ id: 'a', name: 'A', x: 0.5, y: 0.5, durationMin: 10, windowStart: '10:00', windowEnd: '12:00', priority: 1 }]));
    const clean = verifyStamped(report.stamped);
    const dirty = verifyStamped(buildTamperedStamped(report.stamped));
    return clean.ok && !dirty.ok && clean.digest === report.digest;
  } },
  { id: 'hash-roundtrip', name: 'Lab hash encode/decode round-trips exactly', run() {
    const state = { day: 'current', mode: 'car', strategy: 'edf', delay: 9 };
    const decoded = decodeLabHash(encodeLabHash(state), ['houston-stem']);
    return decoded.day === 'current' && decoded.mode === 'car' && decoded.strategy === 'edf' && decoded.delay === 9;
  } },
  { id: 'hash-proto', name: 'Lab hash rejects prototype and constructor tokens fail-closed', run() {
    for (const bad of ['#llab=v1.__proto__.bike.fifo.0', '#llab=v1.current.__proto__.fifo.0', '#llab=v1.current.bike.constructor.0', '#llab=v1.constructor.bike.fifo.0']) {
      let threw = false;
      try { decodeLabHash(bad, ['houston-stem']); } catch { threw = true; }
      if (!threw) return false;
    }
    return true;
  } },
  { id: 'matrix-shape', name: 'Delay matrix covers all four strategies across sixteen delay points', run() {
    const matrix = buildDelayMatrix(STUDIO_PRESETS[0], 'bike');
    return matrix.strategies.length === 4 && matrix.strategies.every((strategy) => strategy.points.length === 16);
  } },
  { id: 'margin-parity', name: 'Matrix minimum margins equal the solver schedule at each delay', run() {
    const matrix = buildDelayMatrix(STUDIO_PRESETS[0], 'bike');
    const exact = matrix.strategies.find((strategy) => strategy.strategyId === 'loopless-exact');
    for (const point of exact.points) {
      const solved = solveOptimal({ ...validateTour(STUDIO_PRESETS[0]), mode: 'bike', transitJitterMin: point.delayMin });
      if (point.minSlackMin !== solved.optimal.minBufferSlackMin || point.missedDeadlines !== solved.optimal.missedDeadlines) return false;
    }
    return true;
  } },
  { id: 'digest-parity', name: 'One digest stamps the page payload, JSON, CSV, and Markdown', run() {
    const report = buildLabReport(smallDay([{ id: 'a', name: 'A', x: 0.5, y: 0.5, durationMin: 10, windowStart: '10:00', windowEnd: '12:00', priority: 1 }]));
    const digest = report.digest;
    return exportProofJson(report.stamped).includes(digest)
      && exportProofCsv(report.stamped).includes('sha256=' + digest)
      && exportProofMarkdown(report.stamped).includes('Proof SHA-256: ' + digest)
      && /^[0-9a-f]{64}$/.test(digest);
  } },
  { id: 'delay-bounds', name: 'Delay bounds reject negatives, fractions, and over-range values', run() {
    for (const bad of [-1, 16, 1.5, Number.NaN, 'x']) {
      let threw = false;
      try { buildLabReport(smallDay([{ id: 'a', name: 'A', x: 0, y: 0, durationMin: 5, windowStart: '10:00', windowEnd: '12:00', priority: 1 }]), { delayMin: bad }); } catch { threw = true; }
      if (!threw) return false;
    }
    return true;
  } },
  { id: 'report-determinism', name: 'Identical lab state produces an identical state key and digest', run() {
    const day = smallDay([{ id: 'a', name: 'A', x: 0.5, y: 0.5, durationMin: 10, windowStart: '10:00', windowEnd: '12:00', priority: 1 }]);
    const one = buildLabReport(day, { modeId: 'walk' });
    const two = buildLabReport(day, { modeId: 'walk' });
    return one.stateKey === two.stateKey && one.digest === two.digest;
  } },
]);

export function runSelfTests(tests = SELF_TESTS) {
  const results = tests.map((entry) => {
    try {
      const outcome = entry.run();
      if (outcome !== true) return { id: entry.id, name: entry.name, ok: false, detail: 'returned ' + JSON.stringify(outcome) };
      return { id: entry.id, name: entry.name, ok: true, detail: 'pass' };
    } catch (error) {
      return { id: entry.id, name: entry.name, ok: false, detail: error.message || String(error) };
    }
  });
  const passed = results.filter((result) => result.ok).length;
  return { total: results.length, passed, ok: passed === results.length, results };
}
