import { normalizeScenario, solveOptimal, TRANSIT_MODES, formatMinToClock } from './planner.mjs?v=studio-c49dfe94a109';

export const MAX_STOPS = 12;
export const MAX_HASH_LENGTH = 16000;
export const MAX_JSON_BYTES = 10000;
export const STORAGE_KEY = 'loopless.studio.v2';
const TOUR_KEYS = new Set(['id', 'title', 'mode', 'metric', 'startTime', 'returnToAnchor', 'transitJitterMin', 'anchor', 'stops']);
const STOP_KEYS = new Set(['id', 'name', 'x', 'y', 'durationMin', 'windowStart', 'windowEnd', 'priority', 'category', 'dependsOn']);
const ANCHOR_KEYS = new Set(['name', 'x', 'y']);
const RESERVED = new Set(['__proto__', 'prototype', 'constructor', '__anchor__']);
const clone = (value) => structuredClone(value);

function allowKeys(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    throw new Error(`${label} must be a plain object`);
  }
  for (const key of Object.keys(value)) {
    if (!keys.has(key) || RESERVED.has(key)) throw new Error(`Unexpected ${label.toLowerCase()} field`);
  }
}

function plainText(value, fallback, max, label) {
  const text = value ?? fallback;
  if (typeof text !== 'string' || !text.trim() || text.length > max || /[<>\u0000-\u001f\u007f\u2013\u2014\u2018\u2019\u201c\u201d\u2028\u2029]/u.test(text)) {
    throw new Error(`${label} must be plain text, 1 to ${max} characters, with no markup or control characters`);
  }
  return text.trim();
}

function identifier(value, fallback) {
  const id = value ?? fallback;
  if (typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,47}$/.test(id) || RESERVED.has(id)) {
    throw new Error('IDs must be short, plain identifiers');
  }
  return id;
}

function numberIn(value, fallback, min, max, label, integer = false) {
  const number = value ?? fallback;
  if (typeof number !== 'number' || !Number.isFinite(number) || number < min || number > max || (integer && !Number.isInteger(number))) {
    throw new Error(`${label} must be ${integer ? 'an integer' : 'a number'} from ${min} to ${max}`);
  }
  return number;
}

function clock(value, fallback) {
  const time = value ?? fallback;
  if (typeof time !== 'string' || !/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(time)) throw new Error('Use a valid 24-hour HH:MM time');
  return time;
}

/** Strict boundary for editor, storage, and URLs. Copies only explicitly allowed fields. */
export function validateTour(raw) {
  allowKeys(raw, TOUR_KEYS, 'Tour');
  const anchor = raw.anchor ?? {};
  allowKeys(anchor, ANCHOR_KEYS, 'Anchor');
  if (!Array.isArray(raw.stops) || raw.stops.length > MAX_STOPS) throw new Error(`Use at most ${MAX_STOPS} stops`);
  if (raw.mode != null && (typeof raw.mode !== 'string' || !Object.hasOwn(TRANSIT_MODES, raw.mode))) throw new Error('Unknown transit mode');
  if (raw.metric != null && !['manhattan', 'euclidean'].includes(raw.metric)) throw new Error('Unknown distance metric');
  if (raw.returnToAnchor != null && typeof raw.returnToAnchor !== 'boolean') throw new Error('Return to base must be true or false');
  const startTime = clock(raw.startTime, '15:30');
  const tour = {
    id: identifier(raw.id, 'custom'),
    title: plainText(raw.title, 'My day', 100, 'Day name'),
    mode: raw.mode ?? 'bike',
    metric: raw.metric ?? 'manhattan',
    startTime,
    returnToAnchor: raw.returnToAnchor ?? true,
    transitJitterMin: numberIn(raw.transitJitterMin, 0, 0, 15, 'Transit delay', true),
    anchor: {
      name: plainText(anchor.name, 'Home base', 80, 'Base name'),
      x: numberIn(anchor.x, 0, -10, 10, 'Base x'),
      y: numberIn(anchor.y, 0, -10, 10, 'Base y'),
    },
    stops: raw.stops.map((stop, index) => {
      allowKeys(stop, STOP_KEYS, 'Stop');
      const category = stop.category ?? 'errand';
      if (!['errand', 'study', 'club', 'health', 'family'].includes(category)) throw new Error('Unknown stop category');
      return {
        id: identifier(stop.id, `stop-${index + 1}`),
        name: plainText(stop.name, `Errand ${index + 1}`, 80, 'Stop name'),
        x: numberIn(stop.x, 0, -10, 10, 'Stop x'),
        y: numberIn(stop.y, 0, -10, 10, 'Stop y'),
        durationMin: numberIn(stop.durationMin, 15, 1, 240, 'Service duration', true),
        windowStart: clock(stop.windowStart, startTime),
        windowEnd: clock(stop.windowEnd, '23:59'),
        priority: numberIn(stop.priority, 2, 1, 3, 'Priority', true),
        category,
        dependsOn: stop.dependsOn == null || stop.dependsOn === '' ? null : identifier(stop.dependsOn),
      };
    }),
  };
  normalizeScenario(tour); // Unique IDs, finite coordinates, window order, missing targets, and cycles.
  return tour;
}

export function addStop(raw, coordinates = { x: 0, y: 0 }) {
  const tour = validateTour(raw);
  if (tour.stops.length >= MAX_STOPS) throw new Error(`This studio supports up to ${MAX_STOPS} stops`);
  allowKeys(coordinates, new Set(['x', 'y']), 'Coordinates');
  let suffix = 1;
  const ids = new Set(tour.stops.map((stop) => stop.id));
  while (ids.has(`stop-${suffix}`)) suffix += 1;
  const stop = {
    id: `stop-${suffix}`, name: `New errand ${suffix}`,
    x: numberIn(coordinates.x, 0, -10, 10, 'Stop x'),
    y: numberIn(coordinates.y, 0, -10, 10, 'Stop y'),
    durationMin: 15, windowStart: tour.startTime,
    windowEnd: formatMinToClock(Math.min(1439, normalizeScenario(tour).startMin + 180)),
    priority: 2, category: 'errand', dependsOn: null,
  };
  return { tour: validateTour({ ...tour, stops: [...tour.stops, stop] }), stopId: stop.id };
}

export function editStop(raw, id, patch) {
  const tour = validateTour(raw);
  allowKeys(patch, new Set([...STOP_KEYS].filter((key) => key !== 'id')), 'Stop edit');
  if (!tour.stops.some((stop) => stop.id === id)) throw new Error('Stop no longer exists');
  return validateTour({ ...tour, stops: tour.stops.map((stop) => stop.id === id ? { ...stop, ...patch } : stop) });
}

export function deleteStop(raw, id) {
  const tour = validateTour(raw);
  if (!tour.stops.some((stop) => stop.id === id)) throw new Error('Stop no longer exists');
  const dependent = tour.stops.find((stop) => stop.dependsOn === id);
  if (dependent) throw new Error(`Remove the prerequisite from "${dependent.name}" before deleting this stop`);
  return validateTour({ ...tour, stops: tour.stops.filter((stop) => stop.id !== id) });
}

/** Invalid edits never enter history. Readers receive copies, so snapshots cannot be mutated. */
export function createHistory(initial, limit = 40) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('History limit must be from 1 to 100');
  let present = validateTour(initial);
  const past = [], future = [];
  return {
    get current() { return clone(present); },
    get canUndo() { return past.length > 0; },
    get canRedo() { return future.length > 0; },
    apply(raw) {
      const next = validateTour(raw);
      if (JSON.stringify(next) === JSON.stringify(present)) return false;
      past.push(present);
      if (past.length > limit) past.shift();
      present = next;
      future.length = 0;
      return true;
    },
    undo() { if (past.length) { future.push(present); present = past.pop(); } return clone(present); },
    redo() { if (future.length) { past.push(present); present = future.pop(); } return clone(present); },
  };
}

function serialize(raw) {
  const json = JSON.stringify({ v: 1, tour: validateTour(raw) });
  if (new TextEncoder().encode(json).length > MAX_JSON_BYTES) throw new Error('Day is too large to share');
  return json;
}

function deserialize(json) {
  if (typeof json !== 'string' || json.length > MAX_JSON_BYTES || new TextEncoder().encode(json).length > MAX_JSON_BYTES) throw new Error('Stored day is too large');
  let data;
  try { data = JSON.parse(json); } catch { throw new Error('Day link is not valid JSON'); }
  allowKeys(data, new Set(['v', 'tour']), 'Shared day');
  if (data.v !== 1) throw new Error('Unsupported day link version');
  return validateTour(data.tour);
}

export function encodeTourHash(raw) {
  const bytes = new TextEncoder().encode(serialize(raw));
  const encoded = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const hash = `#tour=${encoded}`;
  if (hash.length > MAX_HASH_LENGTH) throw new Error('Day link is too long');
  return hash;
}

export function decodeTourHash(hash) {
  if (hash === '' || hash === '#capybara-buddy') return null;
  if (typeof hash !== 'string' || hash.length > MAX_HASH_LENGTH || !/^#tour=[A-Za-z0-9_-]+$/.test(hash)) throw new Error('Malformed day link');
  const payload = hash.slice(6);
  let bytes;
  try {
    bytes = Uint8Array.from(atob(payload.replace(/-/g, '+').replace(/_/g, '/')), (ch) => ch.charCodeAt(0));
  } catch { throw new Error('Malformed day link encoding'); }
  if (bytes.length > MAX_JSON_BYTES) throw new Error('Day link is too large');
  let json;
  try { json = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { throw new Error('Day link is not valid UTF-8'); }
  return deserialize(json);
}

export function readStoredTour(storage) {
  try {
    const json = storage.getItem(STORAGE_KEY);
    return { tour: json == null ? null : deserialize(json), error: null };
  } catch { return { tour: null, error: 'Saved day could not be loaded. A fresh example is ready.' }; }
}

export function writeStoredTour(storage, raw) {
  try { storage.setItem(STORAGE_KEY, serialize(raw)); return true; } catch { return false; }
}

export function compareModes(raw) {
  const tour = validateTour(raw);
  return Object.values(TRANSIT_MODES).map((mode) => {
    const result = solveOptimal({ ...tour, mode: mode.id });
    return {
      id: mode.id, label: mode.id === 'car' ? 'Carpool' : mode.label,
      travelMin: result.optimal.totalTravelMin, spanMin: result.optimal.totalSpanMin,
      missedDeadlines: result.optimal.missedDeadlines, onTime: tour.stops.length - result.optimal.missedDeadlines,
      feasible: result.optimal.feasible, method: result.method,
    };
  });
}

/** Every point is independently optimized. The tipping point is exact only if the searches finish. */
export function buildJitterSweep(raw) {
  const tour = validateTour(raw);
  const points = Array.from({ length: 16 }, (_, delayMin) => {
    const solution = solveOptimal({ ...tour, transitJitterMin: delayMin });
    const schedule = solution.optimal;
    return {
      delayMin, missedDeadlines: schedule.missedDeadlines,
      minSlackMin: schedule.minBufferSlackMin, travelMin: schedule.totalTravelMin,
      method: solution.method, solution,
    };
  });
  const first = points.find((point) => point.missedDeadlines > 0);
  return {
    points, firstBreakMin: first?.delayMin ?? null,
    firstBrokenStopIds: first ? first.solution.optimal.legTimeline.filter((leg) => !leg.onTime).map((leg) => leg.stopId) : [],
    exact: points.every((point) => ['exact', 'exact-bnb'].includes(point.method)),
  };
}

export function createAnalyzer() {
  let key = null, sweep = null;
  return (raw) => {
    const tour = validateTour(raw);
    const nextKey = JSON.stringify({ ...tour, transitJitterMin: 0 });
    if (key !== nextKey) { sweep = buildJitterSweep(tour); key = nextKey; }
    return { solution: sweep.points[tour.transitJitterMin].solution, sweep, modes: compareModes(tour) };
  };
}
