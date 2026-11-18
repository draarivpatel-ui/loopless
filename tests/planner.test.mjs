import test from 'node:test';
import assert from 'node:assert/strict';
import {
  solveOptimal,
  evaluateOrder,
  compareSchedules,
  buildIcsCalendar,
  parseClockToMin,
  formatMinToClock,
} from '../js/planner.mjs';
import { BENCHMARK_CORPUS } from '../js/scenarios.mjs';

function bruteForceOptimal(scenario) {
  const stops = scenario.stops;
  const byId = new Map(stops.map((s) => [s.id, s]));
  const ids = stops.map((s) => s.id);
  let best = null;

  function permute(idx) {
    if (idx === ids.length) {
      const seen = new Set();
      for (const id of ids) {
        const s = byId.get(id);
        if (s.dependsOn && !seen.has(s.dependsOn)) return;
        seen.add(id);
      }
      const ev = evaluateOrder(scenario, ids);
      if (!best || compareSchedules(ev, best) < 0) best = ev;
      return;
    }
    for (let i = idx; i < ids.length; i++) {
      [ids[idx], ids[i]] = [ids[i], ids[idx]];
      permute(idx + 1);
      [ids[idx], ids[i]] = [ids[i], ids[idx]];
    }
  }

  permute(0);
  return best;
}

test('clock parsing and formatting round-trip cleanly', () => {
  assert.equal(parseClockToMin('15:30'), 930);
  assert.equal(formatMinToClock(930), '15:30');
  assert.throws(() => parseClockToMin('25:00'));
  assert.throws(() => parseClockToMin('bad'));
});

test('exact Branch-and-Bound matches brute-force permutation ground truth on all N <= 7 benchmark scenarios', () => {
  const smallCases = BENCHMARK_CORPUS.filter((c) => c.stops.length <= 7);
  assert.ok(smallCases.length >= 10);

  for (const raw of smallCases) {
    const sol = solveOptimal(raw);
    assert.equal(sol.method, 'exact-bnb');
    const brute = bruteForceOptimal(raw);
    assert.equal(
      compareSchedules(sol.optimal, brute),
      0,
      `Optimality gap on ${raw.id}: solver span=${sol.optimal.totalSpanMin} travel=${sol.optimal.totalTravelMin}, brute span=${brute.totalSpanMin} travel=${brute.totalTravelMin}`
    );
  }
});

test('prerequisite dependency constraints are enforced in optimal and baseline tours', () => {
  const sc = BENCHMARK_CORPUS.find((c) => c.id === 'bench-07-prereq-chain');
  const sol = solveOptimal(sc);
  assert.equal(sol.optimal.prerequisiteViolations, 0);
  const idx1 = sol.optimal.orderIds.indexOf('s1');
  const idx2 = sol.optimal.orderIds.indexOf('s2');
  const idx3 = sol.optimal.orderIds.indexOf('s3');
  assert.ok(idx1 < idx2 && idx2 < idx3, 's1 -> s2 -> s3 order must hold');
});

test('dependency cycles and missing dependency targets are rejected cleanly', () => {
  assert.throws(() => solveOptimal({
    startTime: '10:00',
    stops: [
      { id: 'a', name: 'A', x: 1, y: 0, dependsOn: 'b' },
      { id: 'b', name: 'B', x: 2, y: 0, dependsOn: 'a' },
    ],
  }), /cycle/i);

  assert.throws(() => solveOptimal({
    startTime: '10:00',
    stops: [{ id: 'a', name: 'A', x: 1, y: 0, dependsOn: 'missing' }],
  }), /Invalid dependency/);
});

test('empty stop list returns a valid zeroed schedule', () => {
  const sol = solveOptimal({ startTime: '09:00', stops: [] });
  assert.equal(sol.optimal.feasible, true);
  assert.equal(sol.optimal.totalTravelMin, 0);
  assert.equal(sol.optimal.legTimeline.length, 0);
});

test('intentional overload scenario reports missed deadlines honestly', () => {
  const sc = BENCHMARK_CORPUS.find((c) => c.id === 'bench-14-overload-honesty');
  const sol = solveOptimal(sc);
  assert.equal(sol.optimal.feasible, false);
  assert.ok(sol.optimal.missedDeadlines >= 1);
  assert.ok(sol.optimal.totalLatenessMin > 0);
});

test('14-stop scenario uses deterministic 2-opt heuristic and matches/beats all baselines', () => {
  const sc = BENCHMARK_CORPUS.find((c) => c.id === 'bench-13-fourteen-stop-2opt');
  const sol1 = solveOptimal(sc);
  const sol2 = solveOptimal(sc);
  assert.equal(sol1.method, 'heuristic-2opt');
  assert.deepEqual(sol1.optimal.orderIds, sol2.optimal.orderIds);
  assert.ok(compareSchedules(sol1.optimal, sol1.baselines.fifo) < 0);
  assert.ok(compareSchedules(sol1.optimal, sol1.baselines.nearest) <= 0);
});

test('RFC-5545 ICS calendar export emits CRLF lines, VEVENT blocks, and escaped commas/semicolons', () => {
  const sc = {
    id: 'ics-check',
    title: 'ICS Check',
    mode: 'bike',
    startTime: '15:00',
    stops: [
      { id: 'one', name: 'Clinic, Suite 2; Intake', x: 1, y: 1, durationMin: 20, windowStart: '15:00', windowEnd: '17:00' },
    ],
  };
  const sol = solveOptimal(sc);
  const ics = buildIcsCalendar(sol.scenario, sol.optimal, '2026-11-21');
  assert.ok(ics.includes('\r\n'));
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n'));
  assert.ok(ics.includes('BEGIN:VEVENT\r\n'));
  assert.ok(ics.includes('SUMMARY:Clinic\\, Suite 2\\; Intake\r\n'));
  assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
});

test('12 co-located stops solve quickly without browser freeze and match brute force on 7 co-located stops', () => {
  const stops12 = Array.from({ length: 12 }, (_, idx) => ({
    id: `c${idx}`,
    name: `Co-located Stop ${idx + 1}`,
    x: 2.5,
    y: 3.5,
    durationMin: 15,
    windowStart: '08:00',
    windowEnd: '20:00',
  }));
  const t0 = performance.now();
  const sol12 = solveOptimal({ id: 'coloc-12', startTime: '08:00', anchor: { x: 2.5, y: 3.5 }, stops: stops12 });
  const elapsedMs = performance.now() - t0;
  assert.equal(sol12.optimal.feasible, true);
  assert.equal(sol12.optimal.totalTravelMin, 0);
  assert.ok(elapsedMs < 250, `Expected < 250ms, got ${elapsedMs.toFixed(1)}ms`);

  const stops7 = stops12.slice(0, 7).map((s, idx) => ({
    ...s,
    windowEnd: idx % 2 === 0 ? '12:00' : '16:00',
  }));
  const sc7 = { id: 'coloc-7', startTime: '08:00', anchor: { x: 2.5, y: 3.5 }, stops: stops7 };
  const sol7 = solveOptimal(sc7);
  const brute7 = bruteForceOptimal(sol7.scenario);
  assert.equal(compareSchedules(sol7.optimal, brute7), 0);
});

test('ICS calendar handles midnight rollover and folds lines at 75 octets per RFC 5545', () => {
  const longName = 'Very Long Stop Name With Repeated Words For Folding Verification Across Seventy Five Octets Exact Boundary Check';
  const sc = {
    id: 'midnight-fold',
    title: 'Midnight & Fold',
    mode: 'walk',
    startTime: '23:30',
    anchor: { x: 0, y: 0 },
    returnToAnchor: false,
    stops: [
      { id: 'late', name: longName, x: 0, y: 0, durationMin: 60, windowStart: '23:30', windowEnd: '23:59' },
    ],
  };
  const sol = solveOptimal(sc);
  const ics = buildIcsCalendar(sol.scenario, sol.optimal, '2026-11-21');
  assert.ok(ics.includes('DTSTART:20261121T233000\r\n'));
  assert.ok(ics.includes('DTEND:20261122T003000\r\n'));
  const rawLines = ics.split('\r\n').filter(Boolean);
  for (const line of rawLines) {
    assert.ok(Buffer.byteLength(line, 'utf8') <= 75, `Line exceeded 75 octets: ${line}`);
  }
  const unfolded = ics.replace(/\r\n /g, '');
  assert.ok(unfolded.includes(`SUMMARY:${longName}\r\n`));
});
