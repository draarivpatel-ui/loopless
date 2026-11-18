import { normalizeScenario } from './planner.mjs?v=studio-c49dfe94a109';

const scenario = (raw) => raw.mode?.mph ? raw : normalizeScenario(raw);

export function createMapProjection(raw, width = 900, height = 430, padding = 52) {
  const tour = scenario(raw);
  const nodes = [tour.anchor, ...tour.stops];
  const minX = Math.floor(Math.min(...nodes.map((node) => node.x)) - 0.4);
  const maxX = Math.ceil(Math.max(...nodes.map((node) => node.x)) + 0.4);
  const minY = Math.floor(Math.min(...nodes.map((node) => node.y)) - 0.4);
  const maxY = Math.ceil(Math.max(...nodes.map((node) => node.y)) + 0.4);
  const scale = Math.min((width - padding * 2) / (maxX - minX), (height - padding * 2) / (maxY - minY));
  const left = (width - (maxX - minX) * scale) / 2;
  const top = (height - (maxY - minY) * scale) / 2;
  return {
    width, height, minX, maxX, minY, maxY, scale,
    project: ({ x, y }) => ({ x: left + (x - minX) * scale, y: top + (maxY - y) * scale }),
    unproject: ({ x, y }) => ({ x: (x - left) / scale + minX, y: maxY - (y - top) / scale }),
  };
}

export function legPoints(from, to, metric) {
  return metric === 'manhattan' ? [from, { x: to.x, y: from.y }, to] : [from, to];
}

/** Separate nearby hit targets with leader lines; route geometry stays at the exact input coordinates. */
export function layoutMapPins(stops, projection, separation = 52, anchor = null) {
  const placed = anchor ? [projection.project(anchor)] : [];
  return stops.map((stop) => {
    const real = projection.project(stop);
    const candidates = [real];
    for (let ring = 1; ring <= 6; ring += 1) {
      for (let angle = 0; angle < 16; angle += 1) {
        const radians = angle / 16 * Math.PI * 2;
        candidates.push({ x: real.x + Math.cos(radians) * ring * separation * .65, y: real.y + Math.sin(radians) * ring * separation * .65 });
      }
    }
    const position = candidates.find((candidate) => candidate.x >= 30 && candidate.x <= projection.width - 30 && candidate.y >= 30 && candidate.y <= projection.height - 35 && placed.every((other) => Math.hypot(candidate.x - other.x, candidate.y - other.y) >= separation)) ?? real;
    placed.push(position);
    return { stopId: stop.id, ...position, realX: real.x, realY: real.y, moved: Math.hypot(position.x - real.x, position.y - real.y) > .01 };
  });
}

export function routePoints(raw, schedule) {
  const tour = scenario(raw);
  const byId = new Map(tour.stops.map((stop) => [stop.id, stop]));
  const nodes = [tour.anchor, ...schedule.orderIds.map((id) => byId.get(id))];
  if (schedule.returnLeg) nodes.push(tour.anchor);
  return nodes.flatMap((node, index) => index ? legPoints(nodes[index - 1], node, tour.metric).slice(1) : [node]);
}

function alongLeg(from, to, metric, fraction) {
  const points = legPoints(from, to, metric);
  const lengths = points.slice(1).map((point, index) => Math.hypot(point.x - points[index].x, point.y - points[index].y));
  let distance = lengths.reduce((sum, value) => sum + value, 0) * Math.max(0, Math.min(1, fraction));
  for (let index = 0; index < lengths.length; index += 1) {
    if (distance <= lengths[index] && lengths[index] > 0) {
      const t = distance / lengths[index];
      return { x: points[index].x + (points[index + 1].x - points[index].x) * t, y: points[index].y + (points[index + 1].y - points[index].y) * t };
    }
    distance -= lengths[index];
  }
  return { x: to.x, y: to.y };
}

/** One clock drives both the map marker and the Gantt playhead, including waits and the return. */
export function replayPosition(raw, schedule, elapsedMin) {
  const tour = scenario(raw);
  const elapsed = Math.max(0, Math.min(schedule.totalSpanMin, Number.isFinite(elapsedMin) ? elapsedMin : 0));
  const clockMin = schedule.startMin + elapsed;
  const byId = new Map(tour.stops.map((stop) => [stop.id, stop]));
  let from = tour.anchor;
  for (const leg of schedule.legTimeline) {
    const to = byId.get(leg.stopId);
    if (clockMin < leg.finishMin) {
      const traveling = clockMin < leg.arrivalMin;
      return {
        ...(traveling ? alongLeg(from, to, tour.metric, (clockMin - leg.departMin) / leg.travelMin) : { x: to.x, y: to.y }),
        clockMin, elapsedMin: elapsed, stopId: leg.stopId,
        phase: traveling ? 'travel' : clockMin < leg.serviceStartMin ? 'wait' : 'service',
      };
    }
    from = to;
  }
  if (schedule.returnLeg && clockMin < schedule.endMin) {
    const leg = schedule.returnLeg;
    return { ...alongLeg(from, tour.anchor, tour.metric, (clockMin - leg.departMin) / (leg.travelMin || 1)), clockMin, elapsedMin: elapsed, stopId: null, phase: 'return' };
  }
  const to = schedule.returnLeg ? tour.anchor : from;
  return { x: to.x, y: to.y, clockMin, elapsedMin: elapsed, stopId: null, phase: 'complete' };
}

export function nextReplayStep(schedule, elapsedMin) {
  const steps = [...schedule.legTimeline.map((leg) => leg.serviceStartMin - schedule.startMin), schedule.totalSpanMin];
  return steps.find((time) => time > elapsedMin + 0.001) ?? schedule.totalSpanMin;
}
