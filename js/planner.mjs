/**
 * LoopLess deterministic time-windowed daily route and task tour optimizer.
 * Pure ES module shared between browser UI, CLI evaluation, and Node tests.
 * All speeds, buffers, and coordinates are explicit local model inputs;
 * no live traffic, GPS, or external routing API is called.
 */

export const TRANSIT_MODES = Object.freeze({
  walk: Object.freeze({ id: 'walk', label: 'Walk', mph: 3.1, stopOverheadMin: 1 }),
  bike: Object.freeze({ id: 'bike', label: 'Bike', mph: 11.5, stopOverheadMin: 2 }),
  bus: Object.freeze({ id: 'bus', label: 'Bus / Rail', mph: 14.0, stopOverheadMin: 6 }),
  car: Object.freeze({ id: 'car', label: 'Car / Carpool', mph: 22.0, stopOverheadMin: 4 }),
});

export const DISTANCE_METRICS = Object.freeze({
  manhattan: 'manhattan',
  euclidean: 'euclidean',
});

export const BNB_NODE_BUDGET = 1_500_000;

export function parseClockToMin(hhmm) {
  if (typeof hhmm === 'number') {
    if (!Number.isInteger(hhmm) || hhmm < 0 || hhmm > 1439) throw new Error('Clock minutes must be an integer from 0 to 1439');
    return hhmm;
  }
  const str = String(hhmm || '').trim();
  const match = /^(\d{1,2}):(\d{2})$/.exec(str);
  if (!match) throw new Error(`Invalid clock time "${hhmm}" (expected HH:MM)`);
  const hours = Number(match[1]);
  const mins = Number(match[2]);
  if (hours < 0 || hours > 23 || mins < 0 || mins > 59) {
    throw new Error(`Out-of-range clock time "${hhmm}"`);
  }
  return hours * 60 + mins;
}

export function formatMinToClock(totalMin) {
  const clamped = Math.max(0, Math.round(totalMin));
  const hours = Math.floor(clamped / 60) % 24;
  const mins = clamped % 60;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

export function distanceMiles(a, b, metric = DISTANCE_METRICS.manhattan) {
  const dx = Math.abs(Number(a.x) - Number(b.x));
  const dy = Math.abs(Number(a.y) - Number(b.y));
  if (metric === DISTANCE_METRICS.euclidean) {
    return Math.hypot(dx, dy);
  }
  return dx + dy;
}

export function travelMinutes(a, b, modeSpec, metric = DISTANCE_METRICS.manhattan) {
  const dist = distanceMiles(a, b, metric);
  if (dist === 0) return 0;
  const driveMin = (dist / modeSpec.mph) * 60;
  return Math.max(1, Math.round(driveMin + modeSpec.stopOverheadMin));
}

export function normalizeScenario(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Scenario object required');
  const modeId = raw?.mode && typeof raw.mode === 'object' ? raw.mode.id : (raw?.mode ?? 'bike');
  if (!Object.hasOwn(TRANSIT_MODES, modeId)) throw new Error('Unknown transit mode');
  const mode = TRANSIT_MODES[modeId];
  if (raw.metric != null && !Object.hasOwn(DISTANCE_METRICS, raw.metric)) throw new Error('Unknown distance metric');
  const metric = raw.metric === DISTANCE_METRICS.euclidean
    ? DISTANCE_METRICS.euclidean
    : DISTANCE_METRICS.manhattan;
  const anchor = {
    id: '__anchor__',
    name: raw.anchor?.name || 'Home Base',
    x: boundedNumber(raw.anchor?.x ?? 0, -50, 50, 'Anchor x'),
    y: boundedNumber(raw.anchor?.y ?? 0, -50, 50, 'Anchor y'),
  };
  const startMin = parseClockToMin(raw.startTime ?? raw.startMin ?? '15:30');
  const returnToAnchor = raw.returnToAnchor !== false;
  const transitJitterMin = boundedNumber(raw.transitJitterMin ?? 0, 0, 120, 'Transit delay', true);
  if (raw.returnToAnchor != null && typeof raw.returnToAnchor !== 'boolean') throw new Error('Return to anchor must be a boolean');
  if (raw.stops != null && !Array.isArray(raw.stops)) throw new Error('Stops must be an array');
  const rawStops = raw.stops ?? [];
  if (rawStops.length > 32) throw new Error('A tour can contain at most 32 stops');

  const stops = rawStops.map((s, idx) => {
    if (!s || typeof s !== 'object' || Array.isArray(s)) throw new Error('Each stop must be an object');
    const id = String(s.id || `stop-${idx + 1}`);
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,47}$/.test(id)) throw new Error('Stop IDs must be short, plain identifiers');
    const wStart = s.windowStart != null && s.windowStart !== ''
      ? parseClockToMin(s.windowStart)
      : (s.windowStartMin != null ? s.windowStartMin : startMin);
    const wEnd = s.windowEnd != null && s.windowEnd !== ''
      ? parseClockToMin(s.windowEnd)
      : (s.windowEndMin != null ? s.windowEndMin : 23 * 60 + 59);
    if (wEnd < wStart) throw new Error(`Closing time must follow opening time for "${id}"`);
    return {
      id,
      name: String(s.name || `Stop ${idx + 1}`),
      x: boundedNumber(s.x ?? 0, -50, 50, 'Stop x'),
      y: boundedNumber(s.y ?? 0, -50, 50, 'Stop y'),
      durationMin: boundedNumber(s.durationMin ?? 15, 1, 240, 'Service duration', true),
      windowStartMin: wStart,
      windowEndMin: wEnd,
      priority: boundedNumber(s.priority ?? 2, 1, 3, 'Priority', true),
      category: String(s.category || 'errand'),
      dependsOn: s.dependsOn ? String(s.dependsOn) : null,
    };
  });

  const ids = new Set(stops.map((s) => s.id));
  if (ids.size !== stops.length) throw new Error('Stop IDs must be unique');
  for (const s of stops) {
    if (s.dependsOn && (!ids.has(s.dependsOn) || s.dependsOn === s.id)) {
      throw new Error(`Invalid dependency "${s.dependsOn}" on stop "${s.id}"`);
    }
  }
  validateNoCycle(stops);

  return {
    id: String(raw.id || 'custom'),
    title: String(raw.title || 'Custom Day Plan'),
    mode,
    metric,
    anchor,
    startMin,
    returnToAnchor,
    transitJitterMin,
    stops,
  };
}

function boundedNumber(value, min, max, label, integer = false) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
    throw new Error(`${label} must be ${integer ? 'an integer' : 'a number'} from ${min} to ${max}`);
  }
  return value;
}

function validateNoCycle(stops) {
  const byId = new Map(stops.map((s) => [s.id, s]));
  const state = new Map();
  for (const s of stops) {
    let curr = s;
    const seen = new Set();
    while (curr && curr.dependsOn) {
      if (state.get(curr.id) === 'ok') break;
      if (seen.has(curr.id)) {
        throw new Error(`Dependency cycle detected at "${curr.id}"`);
      }
      seen.add(curr.id);
      curr = byId.get(curr.dependsOn);
    }
    for (const id of seen) state.set(id, 'ok');
  }
}

/**
 * Evaluate a specific stop order under time windows, prerequisites, and mode parameters.
 */
export function evaluateOrder(scenarioInput, orderIds) {
  const sc = scenarioInput.stops && scenarioInput.mode?.mph
    ? scenarioInput
    : normalizeScenario(scenarioInput);

  const byId = new Map(sc.stops.map((s) => [s.id, s]));
  const ordered = orderIds.map((id) => {
    const found = byId.get(id);
    if (!found) throw new Error(`Unknown stop id "${id}" in order`);
    return found;
  });
  if (ordered.length !== sc.stops.length) {
    throw new Error(`Order length (${ordered.length}) must match stop count (${sc.stops.length})`);
  }
  if (new Set(orderIds).size !== orderIds.length) throw new Error('Order must visit every stop exactly once');

  let clockMin = sc.startMin;
  let prev = sc.anchor;
  let totalTravelMin = 0;
  let totalWaitMin = 0;
  let totalServiceMin = 0;
  let totalDistanceMi = 0;
  let totalLatenessMin = 0;
  let missedDeadlines = 0;
  let prerequisiteViolations = 0;
  let minBufferSlackMin = Infinity;
  const visited = new Set();
  const legTimeline = [];

  for (const stop of ordered) {
    if (stop.dependsOn && !visited.has(stop.dependsOn)) {
      prerequisiteViolations += 1;
    }
    const dist = distanceMiles(prev, stop, sc.metric);
    const baseTravel = travelMinutes(prev, stop, sc.mode, sc.metric);
    const travel = dist > 0 ? baseTravel + sc.transitJitterMin : 0;
    const arrivalMin = clockMin + travel;
    const waitMin = Math.max(0, stop.windowStartMin - arrivalMin);
    const serviceStartMin = arrivalMin + waitMin;
    const finishMin = serviceStartMin + stop.durationMin;
    const latenessMin = Math.max(0, finishMin - stop.windowEndMin);
    const slackMin = stop.windowEndMin - finishMin;
    if (latenessMin > 0) missedDeadlines += 1;
    if (slackMin < minBufferSlackMin) minBufferSlackMin = slackMin;

    totalDistanceMi += dist;
    totalTravelMin += travel;
    totalWaitMin += waitMin;
    totalServiceMin += stop.durationMin;
    totalLatenessMin += latenessMin;

    legTimeline.push({
      stopId: stop.id,
      name: stop.name,
      category: stop.category,
      priority: stop.priority,
      fromName: prev.name,
      distanceMi: Number(dist.toFixed(2)),
      departMin: clockMin,
      travelMin: travel,
      arrivalMin,
      waitMin,
      serviceStartMin,
      finishMin,
      windowStartMin: stop.windowStartMin,
      windowEndMin: stop.windowEndMin,
      latenessMin,
      slackMin,
      onTime: latenessMin === 0,
      dependsOn: stop.dependsOn,
      prereqSatisfied: !stop.dependsOn || visited.has(stop.dependsOn),
    });

    visited.add(stop.id);
    clockMin = finishMin;
    prev = stop;
  }

  let returnLeg = null;
  if (sc.returnToAnchor && ordered.length > 0) {
    const dist = distanceMiles(prev, sc.anchor, sc.metric);
    const baseTravel = travelMinutes(prev, sc.anchor, sc.mode, sc.metric);
    const travel = dist > 0 ? baseTravel + sc.transitJitterMin : 0;
    totalDistanceMi += dist;
    totalTravelMin += travel;
    returnLeg = {
      fromName: prev.name,
      toName: sc.anchor.name,
      distanceMi: Number(dist.toFixed(2)),
      departMin: clockMin,
      travelMin: travel,
      arrivalMin: clockMin + travel,
    };
    clockMin += travel;
  }

  const totalSpanMin = clockMin - sc.startMin;
  return {
    orderIds: ordered.map((s) => s.id),
    startMin: sc.startMin,
    endMin: clockMin,
    totalSpanMin,
    totalTravelMin,
    totalWaitMin,
    totalServiceMin,
    totalDistanceMi: Number(totalDistanceMi.toFixed(2)),
    missedDeadlines,
    totalLatenessMin,
    prerequisiteViolations,
    minBufferSlackMin: minBufferSlackMin === Infinity ? 0 : minBufferSlackMin,
    feasible: missedDeadlines === 0 && prerequisiteViolations === 0,
    legTimeline,
    returnLeg,
  };
}

/**
 * Lexicographic cost comparison: lower is strictly better.
 */
export function compareSchedules(a, b) {
  if (a.prerequisiteViolations !== b.prerequisiteViolations) {
    return a.prerequisiteViolations - b.prerequisiteViolations;
  }
  if (a.missedDeadlines !== b.missedDeadlines) {
    return a.missedDeadlines - b.missedDeadlines;
  }
  if (a.totalLatenessMin !== b.totalLatenessMin) {
    return a.totalLatenessMin - b.totalLatenessMin;
  }
  if (a.totalSpanMin !== b.totalSpanMin) {
    return a.totalSpanMin - b.totalSpanMin;
  }
  if (a.totalTravelMin !== b.totalTravelMin) {
    return a.totalTravelMin - b.totalTravelMin;
  }
  return b.minBufferSlackMin - a.minBufferSlackMin;
}

export function baselineFifo(sc) {
  const stops = topologicalRepair(sc.stops);
  return evaluateOrder(sc, stops.map((s) => s.id));
}

export function baselineEdf(sc) {
  const remaining = [...sc.stops];
  const visited = new Set();
  const order = [];
  while (remaining.length > 0) {
    const ready = remaining.filter((s) => !s.dependsOn || visited.has(s.dependsOn));
    ready.sort((a, b) => (a.windowEndMin - b.windowEndMin) || (a.windowStartMin - b.windowStartMin) || (b.priority - a.priority));
    const pick = ready[0];
    order.push(pick.id);
    visited.add(pick.id);
    remaining.splice(remaining.indexOf(pick), 1);
  }
  return evaluateOrder(sc, order);
}

export function baselineNearest(sc) {
  const remaining = [...sc.stops];
  const visited = new Set();
  const order = [];
  let curr = sc.anchor;
  while (remaining.length > 0) {
    const ready = remaining.filter((s) => !s.dependsOn || visited.has(s.dependsOn));
    ready.sort((a, b) => {
      const da = travelMinutes(curr, a, sc.mode, sc.metric);
      const db = travelMinutes(curr, b, sc.mode, sc.metric);
      return (da - db) || (a.windowEndMin - b.windowEndMin);
    });
    const pick = ready[0];
    order.push(pick.id);
    visited.add(pick.id);
    curr = pick;
    remaining.splice(remaining.indexOf(pick), 1);
  }
  return evaluateOrder(sc, order);
}

function topologicalRepair(stops) {
  const remaining = [...stops];
  const visited = new Set();
  const out = [];
  while (remaining.length > 0) {
    const idx = remaining.findIndex((s) => !s.dependsOn || visited.has(s.dependsOn));
    const pick = remaining.splice(idx >= 0 ? idx : 0, 1)[0];
    out.push(pick);
    visited.add(pick.id);
  }
  return out;
}

/**
 * Exact Branch-and-Bound tour solver for N <= 12 stops;
 * restarts + bounded 2-opt polish for N > 12.
 */
export function solveOptimal(scenarioInput, options = {}) {
  const sc = normalizeScenario(scenarioInput);
  const nodeBudget = boundedNumber(options.nodeBudget ?? BNB_NODE_BUDGET, 1, BNB_NODE_BUDGET, 'Search node budget', true);
  const n = sc.stops.length;
  if (n === 0) {
    const empty = evaluateOrder(sc, []);
    return { scenario: sc, method: 'exact', optimal: empty, baselines: { fifo: empty, edf: empty, nearest: empty }, nodesExplored: 0 };
  }

  const fifo = baselineFifo(sc);
  const edf = baselineEdf(sc);
  const nearest = baselineNearest(sc);

  if (n <= 12) {
    const bnb = branchAndBoundSolve(sc, [fifo, edf, nearest], nodeBudget);
    return {
      scenario: sc,
      method: bnb.exact ? 'exact-bnb' : 'bounded-bnb',
      optimal: bnb.evalResult,
      baselines: { fifo, edf, nearest },
      nodesExplored: bnb.nodesExplored,
    };
  }

  let best = [fifo, edf, nearest].sort(compareSchedules)[0];
  best = polishTwoOpt(sc, best);
  return {
    scenario: sc,
    method: 'heuristic-2opt',
    optimal: best,
    baselines: { fifo, edf, nearest },
    nodesExplored: null,
  };
}

function branchAndBoundSolve(sc, seeds, nodeBudget) {
  const stops = sc.stops;
  const n = stops.length;
  const idToIdx = new Map(stops.map((s, i) => [s.id, i]));
  const depIdx = stops.map((s) => (s.dependsOn ? idToIdx.get(s.dependsOn) : -1));

  // Precompute pairwise travel matrices (0..n-1 are stops, n is anchor)
  const nodes = [...stops, sc.anchor];
  const travel = Array.from({ length: n + 1 }, () => new Int32Array(n + 1));
  for (let i = 0; i <= n; i++) {
    for (let j = 0; j <= n; j++) {
      if (i === j) continue;
      const d = distanceMiles(nodes[i], nodes[j], sc.metric);
      const t = travelMinutes(nodes[i], nodes[j], sc.mode, sc.metric);
      travel[i][j] = d > 0 ? t + sc.transitJitterMin : 0;
    }
  }

  // Minimum outgoing travel lower bound per unvisited stop
  const minOutWithAnchor = new Int32Array(n);
  const minOutStopOnly = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    let mAll = Infinity;
    let mStop = Infinity;
    for (let j = 0; j <= n; j++) {
      if (i === j) continue;
      if (j < n && travel[i][j] < mStop) mStop = travel[i][j];
      if ((j < n || sc.returnToAnchor) && travel[i][j] < mAll) mAll = travel[i][j];
    }
    minOutWithAnchor[i] = mAll === Infinity ? 0 : mAll;
    minOutStopOnly[i] = mStop === Infinity ? 0 : mStop;
  }

  let bestMetric = seeds.reduce((acc, s) => (compareSchedules(s, acc) < 0 ? s : acc), seeds[0]);
  let bestOrderIdx = bestMetric.orderIds.map((id) => idToIdx.get(id));

  const used = new Uint8Array(n);
  const path = new Int32Array(n);
  const remainingService = stops.reduce((sum, s) => sum + s.durationMin, 0);
  const MAX_BNB_NODES = nodeBudget;
  let nodesVisited = 0;
  let budgetExhausted = false;

  function computeLowerBounds(prevIdx, remCount, clockMin, remService, pathMinSlack) {
    if (remCount === 0) {
      const returnT = sc.returnToAnchor ? travel[prevIdx][n] : 0;
      return {
        remTravelLB: returnT,
        lbFinish: clockMin + returnT,
        ubMinSlack: pathMinSlack,
      };
    }

    let sumOut = 0;
    let maxOutStop = 0;
    let minFromAnchor = Infinity;
    let maxWindowEnd = -Infinity;
    for (let i = 0; i < n; i++) {
      if (used[i]) continue;
      if (stops[i].windowEndMin > maxWindowEnd) maxWindowEnd = stops[i].windowEndMin;
      if (prevIdx === n && travel[n][i] < minFromAnchor) minFromAnchor = travel[n][i];
      if (sc.returnToAnchor) {
        sumOut += minOutWithAnchor[i];
      } else {
        const mo = minOutStopOnly[i];
        sumOut += mo;
        if (mo > maxOutStop) maxOutStop = mo;
      }
    }

    let remTravelLB;
    if (sc.returnToAnchor) {
      const entry = prevIdx === n ? (minFromAnchor === Infinity ? 0 : minFromAnchor) : minOutWithAnchor[prevIdx];
      remTravelLB = entry + sumOut;
    } else {
      const entry = prevIdx === n ? (minFromAnchor === Infinity ? 0 : minFromAnchor) : minOutStopOnly[prevIdx];
      remTravelLB = entry + sumOut - maxOutStop;
    }

    const lbFinish = clockMin + remService + remTravelLB;
    const maxLastSlack = maxWindowEnd - (clockMin + remService);
    const ubMinSlack = Math.min(pathMinSlack, maxLastSlack);
    return { remTravelLB, lbFinish, ubMinSlack };
  }

  function dfs(depth, prevIdx, clockMin, travelSum, missed, latenessSum, remService, pathMinSlack) {
    if (budgetExhausted) return;
    nodesVisited += 1;
    if (nodesVisited > MAX_BNB_NODES) {
      budgetExhausted = true;
      return;
    }

    // Lower-bound pruning
    if (missed > bestMetric.missedDeadlines) return;
    if (missed === bestMetric.missedDeadlines && latenessSum > bestMetric.totalLatenessMin) return;

    const remCount = n - depth;
    const { remTravelLB, lbFinish, ubMinSlack } = computeLowerBounds(
      prevIdx,
      remCount,
      clockMin,
      remService,
      pathMinSlack,
    );
    const lbSpan = lbFinish - sc.startMin;
    const lbTravel = travelSum + remTravelLB;

    if (missed === bestMetric.missedDeadlines && latenessSum === bestMetric.totalLatenessMin) {
      if (lbSpan > bestMetric.totalSpanMin) return;
      if (lbSpan === bestMetric.totalSpanMin) {
        if (lbTravel > bestMetric.totalTravelMin) return;
        if (lbTravel === bestMetric.totalTravelMin && ubMinSlack <= bestMetric.minBufferSlackMin) return;
      }
    }

    if (depth === n) {
      const returnT = sc.returnToAnchor ? travel[prevIdx][n] : 0;
      const finalTravel = travelSum + returnT;
      const finalSpan = (clockMin + returnT) - sc.startMin;
      const maybeBetter =
        missed < bestMetric.missedDeadlines
        || (missed === bestMetric.missedDeadlines && latenessSum < bestMetric.totalLatenessMin)
        || (missed === bestMetric.missedDeadlines && latenessSum === bestMetric.totalLatenessMin && finalSpan < bestMetric.totalSpanMin)
        || (missed === bestMetric.missedDeadlines && latenessSum === bestMetric.totalLatenessMin && finalSpan === bestMetric.totalSpanMin && finalTravel < bestMetric.totalTravelMin)
        || (missed === bestMetric.missedDeadlines && latenessSum === bestMetric.totalLatenessMin && finalSpan === bestMetric.totalSpanMin && finalTravel === bestMetric.totalTravelMin && pathMinSlack > bestMetric.minBufferSlackMin);
      if (maybeBetter) {
        const orderIds = Array.from(path, (idx) => stops[idx].id);
        const candEval = evaluateOrder(sc, orderIds);
        if (compareSchedules(candEval, bestMetric) < 0) {
          bestMetric = candEval;
          bestOrderIdx = Array.from(path);
        }
      }
      return;
    }

    // Order candidates heuristically: earliest deadline / earliest start first to tighten UB fast
    const candidates = [];
    for (let i = 0; i < n; i++) {
      if (used[i]) continue;
      if (depIdx[i] >= 0 && !used[depIdx[i]]) continue;
      const t = travel[prevIdx][i];
      const arr = clockMin + t;
      const start = Math.max(arr, stops[i].windowStartMin);
      const fin = start + stops[i].durationMin;
      const late = Math.max(0, fin - stops[i].windowEndMin);
      const slack = stops[i].windowEndMin - fin;
      candidates.push({ i, t, fin, late, slack, wEnd: stops[i].windowEndMin });
    }

    candidates.sort((a, b) => (a.late - b.late) || (a.wEnd - b.wEnd) || (a.fin - b.fin));

    for (const c of candidates) {
      if (budgetExhausted) break;
      const nextMissed = missed + (c.late > 0 ? 1 : 0);
      const nextLate = latenessSum + c.late;
      if (nextMissed > bestMetric.missedDeadlines) continue;
      if (nextMissed === bestMetric.missedDeadlines && nextLate > bestMetric.totalLatenessMin) continue;

      used[c.i] = 1;
      path[depth] = c.i;
      dfs(
        depth + 1,
        c.i,
        c.fin,
        travelSum + c.t,
        nextMissed,
        nextLate,
        remService - stops[c.i].durationMin,
        Math.min(pathMinSlack, c.slack),
      );
      used[c.i] = 0;
    }
  }

  dfs(0, n, sc.startMin, 0, 0, 0, remainingService, Infinity);
  const solved = evaluateOrder(sc, bestOrderIdx.map((idx) => stops[idx].id));
  if (budgetExhausted) {
    return { evalResult: polishTwoOpt(sc, solved), exact: false, nodesExplored: nodesVisited };
  }
  return { evalResult: solved, exact: true, nodesExplored: nodesVisited };
}

function polishTwoOpt(sc, initialEval) {
  const byId = new Map(sc.stops.map((s) => [s.id, s]));
  let best = initialEval;
  let order = [...initialEval.orderIds];
  let improved = true;

  while (improved) {
    improved = false;
    for (let i = 0; i < order.length - 1; i++) {
      for (let j = i + 1; j < order.length; j++) {
        const candidate = [
          ...order.slice(0, i),
          ...order.slice(i, j + 1).reverse(),
          ...order.slice(j + 1),
        ];
        if (!isTopologicallyValid(candidate, byId)) continue;
        const evalCand = evaluateOrder(sc, candidate);
        if (compareSchedules(evalCand, best) < 0) {
          best = evalCand;
          order = candidate;
          improved = true;
        }
      }
    }
  }
  return best;
}

function isTopologicallyValid(orderIds, byId) {
  const seen = new Set();
  for (const id of orderIds) {
    const s = byId.get(id);
    if (s.dependsOn && !seen.has(s.dependsOn)) return false;
    seen.add(id);
  }
  return true;
}

/**
 * RFC-5545 valid iCalendar (.ics) exporter with CRLF line endings,
 * midnight day rollover handling, 75-octet UTF-8 folding, and text escaping.
 */
export function buildIcsCalendar(scenarioInput, evaluation, dateStr = '2026-11-21') {
  const sc = scenarioInput.stops && scenarioInput.mode?.mph
    ? scenarioInput
    : normalizeScenario(scenarioInput);
  const baseCompactDate = formatCompactIcsDate(dateStr, 0);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//LoopLess//Daily Tour Optimizer 1.0//EN',
    'CALSCALE:GREGORIAN',
  ];

  for (const leg of evaluation.legTimeline) {
    const startDayOffset = Math.floor(leg.serviceStartMin / 1440);
    const startMinuteOfDay = ((leg.serviceStartMin % 1440) + 1440) % 1440;
    const endDayOffset = Math.floor(leg.finishMin / 1440);
    const endMinuteOfDay = ((leg.finishMin % 1440) + 1440) % 1440;

    const startDate = formatCompactIcsDate(dateStr, startDayOffset);
    const endDate = formatCompactIcsDate(dateStr, endDayOffset);
    const startH = String(Math.floor(startMinuteOfDay / 60)).padStart(2, '0');
    const startM = String(startMinuteOfDay % 60).padStart(2, '0');
    const endH = String(Math.floor(endMinuteOfDay / 60)).padStart(2, '0');
    const endM = String(endMinuteOfDay % 60).padStart(2, '0');
    const summary = escapeIcsText(leg.name);
    const desc = escapeIcsText(
      `Arrive ${formatMinToClock(leg.arrivalMin)} (travel ${leg.travelMin} min from ${leg.fromName}, `
      + `${leg.distanceMi} mi). ${formatSlackLabel(leg.slackMin)}.`
    );
    lines.push(
      'BEGIN:VEVENT',
      `UID:loopless-${encodeURIComponent(sc.id)}-${encodeURIComponent(leg.stopId)}-${startDate}@local`,
      `DTSTAMP:${baseCompactDate}T000000Z`,
      `DTSTART:${startDate}T${startH}${startM}00`,
      `DTEND:${endDate}T${endH}${endM}00`,
      `SUMMARY:${summary}`,
      `DESCRIPTION:${desc}`,
      'END:VEVENT'
    );
  }

  lines.push('END:VCALENDAR');
  return lines.map(foldIcsLine).join('\r\n') + '\r\n';
}

function formatCompactIcsDate(dateStr, dayOffset) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr).trim());
  if (!match || Number(match[1]) < 1000 || Number(match[1]) > 9998) throw new Error('Calendar date must be a valid YYYY-MM-DD date');
  const base = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (base.getUTCFullYear() !== Number(match[1]) || base.getUTCMonth() + 1 !== Number(match[2]) || base.getUTCDate() !== Number(match[3])) {
    throw new Error('Calendar date does not exist');
  }
  if (dayOffset) base.setUTCDate(base.getUTCDate() + dayOffset);
  const y = String(base.getUTCFullYear()).padStart(4, '0');
  const m = String(base.getUTCMonth() + 1).padStart(2, '0');
  const d = String(base.getUTCDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

function foldIcsLine(line) {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;
  const out = [];
  let current = '';
  let currentBytes = 0;
  let limit = 75;
  for (const ch of line) {
    const chBytes = encoder.encode(ch).length;
    if (currentBytes + chBytes > limit && current.length > 0) {
      out.push(current);
      current = ' ' + ch;
      currentBytes = 1 + chBytes;
      limit = 75;
    } else {
      current += ch;
      currentBytes += chBytes;
    }
  }
  if (current.length > 0) out.push(current);
  return out.join('\r\n');
}

function escapeIcsText(value) {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/\r\n|\r|\n/g, '\\n')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,');
}

/**
 * Format a deadline result as plain text. A missed deadline is reported as
 * lateness, never as a negative margin that could be mistaken for slack.
 */
export function formatSlackLabel(slackMin) {
  const value = Number.isFinite(slackMin) ? Math.round(slackMin) : 0;
  return value < 0 ? Math.abs(value) + ' min late' : value + ' min margin';
}

/**
 * Compare the deterministic nearest-neighbor greedy tour with the exact
 * Branch-and-Bound tour. Returns both schedules and the minutes and late
 * penalties saved by the exact search.
 */
export function compareGreedyExact(scenarioInput) {
  const sc = normalizeScenario(scenarioInput);
  const greedy = baselineNearest(sc);
  const exactResult = solveOptimal(scenarioInput);
  const exact = exactResult.optimal;
  return {
    scenario: sc,
    greedy,
    exact,
    exactMethod: exactResult.method,
    travelSavedMin: greedy.totalTravelMin - exact.totalTravelMin,
    latePenaltiesSaved: greedy.missedDeadlines - exact.missedDeadlines,
    latenessSavedMin: greedy.totalLatenessMin - exact.totalLatenessMin,
    spanSavedMin: greedy.totalSpanMin - exact.totalSpanMin,
  };
}

export const greedyVsExact = compareGreedyExact;
export const compareGreedyVsExact = compareGreedyExact;
export const compareNearestExact = compareGreedyExact;

/**
 * Detect time windows that cannot possibly hold their stop under the active
 * model: a window shorter than its own service, or a closing time that is
 * unreachable from the anchor even after allowing for prerequisite chains and
 * the selected delay. Zero-distance legs never receive added delay.
 * Returns a list of { stopId, reason }.
 */
export function diagnoseInfeasibleWindows(scenarioInput) {
  const sc = normalizeScenario(scenarioInput);
  const byId = new Map(sc.stops.map((stop) => [stop.id, stop]));
  const legTravel = (from, to) => {
    const base = travelMinutes(from, to, sc.mode, sc.metric);
    return distanceMiles(from, to, sc.metric) > 0 ? base + sc.transitJitterMin : 0;
  };

  // Earliest possible finish for each stop, walking prerequisite chains from
  // the anchor. A stop's chain may start after its prerequisite finishes, and
  // waiting for an opening window can only push that finish later.
  const earliestFinish = new Map();
  function finishFor(stop, seen) {
    if (earliestFinish.has(stop.id)) return earliestFinish.get(stop.id);
    if (seen.has(stop.id)) return Infinity;
    seen.add(stop.id);
    const from = stop.dependsOn && byId.has(stop.dependsOn)
      ? byId.get(stop.dependsOn)
      : sc.anchor;
    const base = from === sc.anchor ? sc.startMin : finishFor(from, seen);
    const arrival = base + legTravel(from, stop);
    const start = Math.max(arrival, stop.windowStartMin);
    const finish = start + stop.durationMin;
    earliestFinish.set(stop.id, finish);
    return finish;
  }

  const results = [];
  for (const stop of sc.stops) {
    if (stop.windowEndMin - stop.windowStartMin < stop.durationMin) {
      results.push({ stopId: stop.id, reason: 'window shorter than service' });
      continue;
    }
    // The earliest realistic finish is the anchor path for independent stops
    // and the prerequisite chain for dependent ones. If even that lower bound
    // misses the closing time, no order can save this stop.
    const direct = sc.startMin + legTravel(sc.anchor, stop) + stop.durationMin;
    const chained = finishFor(stop, new Set());
    const earliest = stop.dependsOn ? chained : Math.min(direct, chained);
    if (earliest > stop.windowEndMin) {
      results.push({ stopId: stop.id, reason: 'cannot finish by closing time' });
    }
  }
  return results;
}

export const infeasibleStops = diagnoseInfeasibleWindows;
export const infeasibleWindows = diagnoseInfeasibleWindows;
export const detectInfeasibleWindows = diagnoseInfeasibleWindows;
