import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  solveOptimal, evaluateOrder, compareSchedules, normalizeScenario, TRANSIT_MODES, BNB_NODE_BUDGET,
} from '../js/planner.mjs';
import { validateTour } from '../js/studio.mjs';
import { STUDIO_PRESETS } from '../js/presets.mjs';
import {
  sha256Bytes, sha256Hex, canonicalJson,
  LAB_STRATEGIES, LAB_STRATEGY_IDS, runLabStrategy, compareStrategyModes,
  buildDelayMatrix, firstBreakDelay, buildLabReport, buildProofPayload,
  createProofCache, verifyStamped, buildTamperedStamped,
  csvCell, csvRow, exportProofJson, exportProofCsv, exportProofMarkdown,
  encodeLabHash, decodeLabHash, SELF_TESTS, runSelfTests,
  LAB_HASH_PREFIX, LAB_DELAY_MAX, LAB_VERSION,
} from '../js/bnb-lab.js';

const refSha = (text) => createHash('sha256').update(text, 'utf8').digest('hex');
const defaultDay = () => validateTour(structuredClone(STUDIO_PRESETS[0]));
const tinyDay = (name = 'Tiny day', stops) => validateTour({
  id: 'tiny', title: name, mode: 'bike', metric: 'manhattan', startTime: '10:00',
  returnToAnchor: true, transitJitterMin: 0, anchor: { name: 'Base', x: 0, y: 0 },
  stops: stops ?? [{ id: 'a', name: 'Errand', x: 0.5, y: 0.5, durationMin: 10, windowStart: '10:00', windowEnd: '12:00', priority: 1, dependsOn: null }],
});

// ---- SHA-256: FIPS 180-4 known-answer vectors and node:crypto parity ----
const KAT = [
  ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
  ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
  ['abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq', '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1'],
  ['abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu', 'cf5b16a778af8380036ce59e7b0492370b249b11e8f07a51afac45037afee9d1'],
  ['a'.repeat(1000000), 'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0'],
];
for (const [input, expected] of KAT) {
  test(`sha256 known vector of length ${input.length}`, () => {
    assert.equal(sha256Hex(input), expected);
  });
}
const parityInputs = [
  'x', 'LoopLess', '0', ' ', '\n', 'hello world', 'a'.repeat(55), 'a'.repeat(56),
  'a'.repeat(63), 'a'.repeat(64), 'a'.repeat(65), 'a'.repeat(119), 'a'.repeat(120),
  'a'.repeat(128), 'a'.repeat(129), 'a'.repeat(512), 'Caf' + String.fromCharCode(233),
  String.fromCodePoint(0x1f34a), 'multibyte ' + String.fromCodePoint(0x1f600) + ' tail',
  '{"json":true,"n":42}',
];
for (const input of parityInputs) {
  test(`sha256 matches node:crypto for input length ${input.length} (${JSON.stringify(input.slice(0, 16))})`, () => {
    assert.equal(sha256Hex(input), refSha(input));
  });
}
test('sha256 accepts Uint8Array and hashes raw bytes', () => {
  const bytes = new TextEncoder().encode('Caf' + String.fromCharCode(233));
  assert.equal(sha256Hex(bytes), refSha('Caf' + String.fromCharCode(233)));
  assert.equal(sha256Bytes(new Uint8Array(0)).length, 32);
  assert.equal(sha256Hex(new Uint8Array([0])), refSha(new Uint8Array([0])));
});
test('sha256 output is 64 lowercase hex characters and 32 bytes', () => {
  assert.match(sha256Hex('any'), /^[0-9a-f]{64}$/);
  assert.equal(sha256Bytes('any').length, 32);
});
test('sha256 rejects non-string non-bytes input', () => {
  for (const bad of [5, null, undefined, {}, [], true]) assert.throws(() => sha256Hex(bad));
});
test('sha256 is deterministic across calls', () => {
  assert.equal(sha256Hex('stable'), sha256Hex('stable'));
  assert.notEqual(sha256Hex('a'), sha256Hex('b'));
});

// ---- canonicalJson determinism and strictness ----
test('canonicalJson sorts keys recursively', () => {
  assert.equal(canonicalJson({ b: 1, a: { d: 4, c: 3 } }), '{"a":{"c":3,"d":4},"b":1}');
});
test('canonicalJson preserves array order', () => {
  assert.equal(canonicalJson([3, 1, 2]), '[3,1,2]');
});
test('canonicalJson handles strings, numbers, booleans, null', () => {
  assert.equal(canonicalJson({ s: 'x"y', n: 1.5, b: false, z: null }), '{"b":false,"n":1.5,"s":"x\\"y","z":null}');
});
test('canonicalJson normalizes negative zero to zero', () => {
  assert.equal(canonicalJson(-0), '0');
});
test('canonicalJson drops undefined object fields', () => {
  assert.equal(canonicalJson({ a: undefined, b: 1 }), '{"b":1}');
});
for (const [label, bad] of [
  ['NaN', Number.NaN], ['Infinity', Number.POSITIVE_INFINITY], ['-Infinity', Number.NEGATIVE_INFINITY],
  ['BigInt', 10n], ['function', () => 1], ['symbol', Symbol('x')], ['undefined', undefined],
  ['Date', new Date(0)], ['Map', new Map()], ['Set', new Set()], ['Uint8Array', new Uint8Array(2)],
]) {
  test(`canonicalJson rejects ${label}`, () => {
    assert.throws(() => canonicalJson(bad), /canonicalized/);
  });
}
test('canonicalJson rejects circular structures', () => {
  const obj = { a: 1 }; obj.self = obj;
  assert.throws(() => canonicalJson(obj), /[Cc]ircular/);
  const arr = [1]; arr.push(arr);
  assert.throws(() => canonicalJson(arr), /[Cc]ircular/);
});
test('canonicalJson is independent of insertion order on deep structures', () => {
  const one = { z: [1, { y: 2, x: [3] }], a: 's' };
  const two = { a: 's', z: [1, { x: [3], y: 2 }] };
  assert.equal(canonicalJson(one), canonicalJson(two));
});

// ---- CSV cells and rows ----
for (const trigger of ['=', '+', '-', '@']) {
  test(`csvCell prefixes formula trigger ${trigger}`, () => {
    const out = csvCell(trigger + 'SUM(1)');
    assert.equal(out, "'" + trigger + 'SUM(1)');
  });
}
test('csvCell wraps commas, quotes, tabs, and newlines in double quotes', () => {
  assert.equal(csvCell('a,b'), '"a,b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell('a\tb'), '"a\tb"');
  assert.equal(csvCell('a\nb'), '"a\nb"');
  assert.equal(csvCell('a\rb'), '"a\rb"');
});
test('csvCell formula-prefixes before quoting so both protections stack', () => {
  assert.equal(csvCell('=x,y'), '"\'=x,y"');
});
test('csvCell leaves ordinary values untouched and stringifies numbers', () => {
  assert.equal(csvCell('plain'), 'plain');
  assert.equal(csvCell(42), '42');
  assert.equal(csvCell(0), '0');
});
test('csvCell renders null and undefined as empty cells', () => {
  assert.equal(csvCell(null), '');
  assert.equal(csvCell(undefined), '');
});
test('csvRow joins escaped cells with commas', () => {
  assert.equal(csvRow(['a', 'b,c', '=d']), 'a,"b,c",\'=d');
});
test('csvCell hardens whitespace-prefixed formulas while leaving plain text unchanged', () => {
  assert.equal(csvCell(' =x'), "' =x");
  assert.equal(csvCell('plain text'), 'plain text');
});

// ---- strategy registry and runLabStrategy ----
test('lab exposes exactly four frozen strategies', () => {
  assert.deepEqual(LAB_STRATEGY_IDS, ['fifo', 'edf', 'nearest-neighbor', 'loopless-exact']);
  assert.ok(Object.isFrozen(LAB_STRATEGIES));
  for (const id of LAB_STRATEGY_IDS) assert.ok(Object.isFrozen(LAB_STRATEGIES[id]));
});
for (const bad of ['nope', '__proto__', 'constructor', 'prototype', 'FIFO', 'Loopless', '', 'hasOwnProperty']) {
  test(`runLabStrategy rejects unknown strategy "${bad}"`, () => {
    assert.throws(() => runLabStrategy(normalizeScenario(defaultDay()), bad), /Unknown strategy/);
  });
}
for (const bad of [5, null, undefined, {}, []]) {
  test('runLabStrategy rejects non-string strategy ' + JSON.stringify(bad), () => {
    assert.throws(() => runLabStrategy(normalizeScenario(defaultDay()), bad), /Unknown strategy/);
  });
}
for (const id of LAB_STRATEGY_IDS) {
  test(`runLabStrategy(${id}) returns schedule and honest telemetry`, () => {
    const { schedule, telemetry } = runLabStrategy(normalizeScenario(defaultDay()), id);
    assert.ok(schedule.orderIds.length === 4);
    if (id === 'loopless-exact') {
      assert.equal(telemetry.kind, 'exact-bnb');
      assert.ok(Number.isInteger(telemetry.nodesExplored) && telemetry.nodesExplored > 0);
    } else {
      assert.match(telemetry.kind, /^constructive-/);
      assert.equal(telemetry.nodesExplored, null);
    }
  });
}

// ---- compareStrategyModes: structure, math, dominance ----
test('comparator produces 4 modes x 4 strategy rows on the default day', () => {
  const matrix = compareStrategyModes(defaultDay());
  assert.equal(matrix.modes.length, 4);
  for (const mode of matrix.modes) {
    assert.equal(mode.rows.length, 4);
    assert.deepEqual(mode.rows.map((row) => row.strategyId), LAB_STRATEGY_IDS);
  }
  assert.deepEqual(matrix.modeIds, ['walk', 'bus', 'bike', 'car'].sort((a, b) => Object.keys(TRANSIT_MODES).indexOf(a) - Object.keys(TRANSIT_MODES).indexOf(b)));
});
for (const preset of STUDIO_PRESETS) {
  for (const modeId of Object.keys(TRANSIT_MODES)) {
    test(`LoopLess dominates all baselines on ${preset.id} in ${modeId}`, () => {
      const matrix = compareStrategyModes(preset);
      const mode = matrix.modes.find((entry) => entry.modeId === modeId);
      const exact = mode.rows.find((row) => row.strategyId === 'loopless-exact');
      const scenario = normalizeScenario({ ...validateTour(preset), mode: modeId });
      for (const row of mode.rows) {
        if (row.strategyId === 'loopless-exact') continue;
        const baselineEval = evaluateOrder(scenario, row.orderIds);
        const exactEval = evaluateOrder(scenario, exact.orderIds);
        assert.ok(compareSchedules(exactEval, baselineEval) <= 0, `${preset.id}/${modeId}/${row.strategyId}`);
      }
    });
  }
}
test('default day bike row: 56 min saved, 3 rescued, exact search', () => {
  const matrix = compareStrategyModes(defaultDay());
  const bike = matrix.modes.find((mode) => mode.modeId === 'bike');
  const exact = bike.rows.find((row) => row.strategyId === 'loopless-exact');
  assert.equal(exact.travelSavedVsFifoMin, 56);
  assert.equal(exact.rescuedDeadlines, 3);
  assert.equal(exact.method, 'exact-bnb');
  assert.ok(exact.nodesExplored > 0);
});
for (const preset of STUDIO_PRESETS) {
  test(`comparator saved/rescued math is self-consistent on ${preset.id}`, () => {
    const matrix = compareStrategyModes(preset);
    for (const mode of matrix.modes) {
      const fifo = mode.rows.find((row) => row.strategyId === 'fifo');
      for (const row of mode.rows) {
        assert.equal(row.travelSavedVsFifoMin, fifo.totalTravelMin - row.totalTravelMin);
        assert.equal(row.rescuedDeadlines, fifo.missedDeadlines - row.missedDeadlines);
        assert.equal(row.onTime + row.missedDeadlines, row.stopCount);
      }
    }
  });
}
test('comparator rejects malformed tours fail-closed', () => {
  for (const bad of [null, 5, 'x', [], { ...defaultDay(), extra: 1 }]) {
    assert.throws(() => compareStrategyModes(bad));
  }
});
test('comparator rows carry valid order ids covering every stop', () => {
  const matrix = compareStrategyModes(defaultDay());
  const ids = new Set(defaultDay().stops.map((stop) => stop.id));
  for (const mode of matrix.modes) {
    for (const row of mode.rows) {
      assert.equal(new Set(row.orderIds).size, ids.size);
      for (const id of row.orderIds) assert.ok(ids.has(id));
    }
  }
});

// ---- buildDelayMatrix ----
test('delay matrix has 4 strategies x 16 points on the default day', () => {
  const matrix = buildDelayMatrix(defaultDay(), 'bike');
  assert.equal(matrix.strategies.length, 4);
  for (const strategy of matrix.strategies) {
    assert.equal(strategy.points.length, 16);
    assert.deepEqual(strategy.points.map((point) => point.delayMin), Array.from({ length: 16 }, (_, i) => i));
  }
});
test('default day exact strategy tips at +13 and holds +12 with 1 min margin', () => {
  const matrix = buildDelayMatrix(defaultDay(), 'bike');
  const exact = matrix.strategies.find((strategy) => strategy.strategyId === 'loopless-exact');
  assert.equal(exact.tippingPointMin, 13);
  assert.equal(exact.points[12].missedDeadlines, 0);
  assert.equal(exact.points[12].minSlackMin, 1);
  assert.equal(exact.points[13].missedDeadlines, 1);
  assert.equal(exact.points[13].minSlackMin, -2);
  assert.equal(exact.allExact, true);
});
test('default day FIFO is already broken at +0 delay', () => {
  const matrix = buildDelayMatrix(defaultDay(), 'bike');
  const fifo = matrix.strategies.find((strategy) => strategy.strategyId === 'fifo');
  assert.equal(fifo.tippingPointMin, 0);
  assert.equal(fifo.points[0].missedDeadlines, 3);
});
for (const delay of [0, 5, 11, 12, 13, 14, 15]) {
  test(`matrix exact point +${delay} equals an independent solveOptimal call`, () => {
    const matrix = buildDelayMatrix(defaultDay(), 'bike');
    const exact = matrix.strategies.find((strategy) => strategy.strategyId === 'loopless-exact');
    const point = exact.points[delay];
    const solved = solveOptimal({ ...defaultDay(), mode: 'bike', transitJitterMin: delay });
    assert.equal(point.missedDeadlines, solved.optimal.missedDeadlines);
    assert.equal(point.minSlackMin, solved.optimal.minBufferSlackMin);
    assert.equal(point.travelMin, solved.optimal.totalTravelMin);
    assert.equal(point.nodesExplored, solved.nodesExplored);
  });
}
for (const bad of ['fly', '__proto__', 'constructor', '', 'WALK', null, 3]) {
  test('buildDelayMatrix rejects bad mode ' + JSON.stringify(bad), () => {
    assert.throws(() => buildDelayMatrix(defaultDay(), bad), /Unknown transit mode/);
  });
}
test('delay matrix on overload preset reports honest breakage for every strategy', () => {
  const matrix = buildDelayMatrix(STUDIO_PRESETS[3], 'walk');
  for (const strategy of matrix.strategies) {
    assert.equal(strategy.tippingPointMin, 0);
    assert.ok(strategy.points.every((point) => point.missedDeadlines > 0));
  }
});
test('firstBreakDelay returns first missed delay or null', () => {
  assert.equal(firstBreakDelay([{ delayMin: 0, missedDeadlines: 0 }, { delayMin: 1, missedDeadlines: 2 }]), 1);
  assert.equal(firstBreakDelay([{ delayMin: 0, missedDeadlines: 0 }]), null);
  assert.equal(firstBreakDelay([]), null);
  assert.equal(firstBreakDelay([{ delayMin: 0, missedDeadlines: 4 }]), 0);
});
test('delay matrix rejects malformed tours', () => {
  assert.throws(() => buildDelayMatrix(null));
  assert.throws(() => buildDelayMatrix({ ...defaultDay(), stops: defaultDay().stops.slice(0, 1).map((s) => ({ ...s, id: '__proto__' })) }));
});

// ---- buildLabReport ----
test('lab report includes comparator, matrix, proof, digest and state key', () => {
  const report = buildLabReport(defaultDay(), { modeId: 'bike', focusStrategyId: 'loopless-exact', delayMin: 0 });
  assert.equal(report.comparator.modes.length, 4);
  assert.equal(report.delayMatrix.modeId, 'bike');
  assert.match(report.digest, /^[0-9a-f]{64}$/);
  assert.equal(report.stamped.integrity.digest, report.digest);
  assert.equal(report.stamped.integrity.algorithm, 'SHA-256');
});
test('lab report is deterministic across independent calls', () => {
  const one = buildLabReport(defaultDay(), { modeId: 'walk', focusStrategyId: 'edf', delayMin: 3 });
  const two = buildLabReport(defaultDay(), { modeId: 'walk', focusStrategyId: 'edf', delayMin: 3 });
  assert.equal(one.stateKey, two.stateKey);
  assert.equal(one.digest, two.digest);
});
test('different lab options produce different digests', () => {
  const one = buildLabReport(defaultDay(), { modeId: 'walk' });
  const two = buildLabReport(defaultDay(), { modeId: 'bus' });
  assert.notEqual(one.digest, two.digest);
});
test('lab report defaults focus strategy and delay from options', () => {
  const report = buildLabReport(defaultDay());
  assert.equal(report.focusStrategyId, 'loopless-exact');
  assert.equal(report.delayMin, 0);
});
test('lab report honors a nonzero tour jitter default', () => {
  const jittered = validateTour({ ...defaultDay(), transitJitterMin: 5 });
  const report = buildLabReport(jittered);
  assert.equal(report.delayMin, 5);
});
for (const bad of [-1, 16, 1.5, Number.NaN, 'x', {}]) {
  test('lab report rejects delay ' + JSON.stringify(bad), () => {
    assert.throws(() => buildLabReport(defaultDay(), { delayMin: bad }), /Delay/);
  });
}
for (const bad of ['walkk', '__proto__', 9]) {
  test('lab report rejects mode ' + JSON.stringify(bad), () => {
    assert.throws(() => buildLabReport(defaultDay(), { modeId: bad }), /Unknown transit mode/);
  });
}
test('lab report falls back to the tour mode and default strategy on nullish options', () => {
  const report = buildLabReport(defaultDay(), { modeId: null, focusStrategyId: null });
  assert.equal(report.modeId, 'bike');
  assert.equal(report.focusStrategyId, 'loopless-exact');
});
for (const bad of ['exact', '__proto__', 9]) {
  test('lab report rejects focus strategy ' + JSON.stringify(bad), () => {
    assert.throws(() => buildLabReport(defaultDay(), { focusStrategyId: bad }), /Unknown strategy/);
  });
}
for (const preset of STUDIO_PRESETS) {
  test(`lab report builds cleanly on preset ${preset.id}`, () => {
    const report = buildLabReport(preset, { modeId: preset.mode });
    assert.equal(report.tour.id, preset.id);
    assert.match(report.digest, /^[0-9a-f]{64}$/);
  });
}

// ---- proof payload, cache, verify, tamper ----
test('proof payload is deterministic and carries no timestamps', () => {
  const report = buildLabReport(defaultDay());
  const proof = report.proof;
  assert.equal(proof.schema, 'loopless-lab-proof');
  assert.equal(proof.version, LAB_VERSION);
  assert.equal(canonicalJson(proof), report.stateKey);
  assert.deepEqual(buildProofPayload(report), buildProofPayload(report));
  const keys = JSON.stringify(Object.keys(proof).sort());
  for (const volatile of ['timestamp', 'createdAt', 'generatedAt', 'nonce', 'random']) {
    assert.ok(!keys.includes(volatile), 'volatile proof key ' + volatile);
  }
  assert.equal(proof.day.stops.length, 4);
});
test('proof cache returns identical digest and marks the second stamp cached', () => {
  const cache = createProofCache();
  const report = buildLabReport(defaultDay(), { modeId: 'bike' });
  const first = cache.stamp(report.proof);
  const second = cache.stamp(report.proof);
  assert.equal(first.stamped.integrity.digest, second.stamped.integrity.digest);
  assert.equal(first.cached, false);
  assert.equal(second.cached, true);
});
test('proof cache evicts the oldest entry beyond its limit', () => {
  const cache = createProofCache(2);
  const a = { a: 1 }, b = { b: 2 }, c = { c: 3 };
  cache.stamp(a); cache.stamp(b); cache.stamp(c);
  assert.equal(cache.size, 2);
  assert.equal(cache.stamp(a).cached, false);
});
test('proof cache validates its limit', () => {
  for (const bad of [0, -1, 1.5, 'x', 257]) assert.throws(() => createProofCache(bad));
});
test('verifyStamped accepts a real stamped proof', () => {
  const report = buildLabReport(tinyDay());
  const result = verifyStamped(report.stamped);
  assert.equal(result.ok, true);
  assert.equal(result.recomputed, result.digest);
});
for (const bad of [null, 5, 'x', [], {}, { proof: {} }, { proof: {}, integrity: {} }, { integrity: { digest: 'x' } }]) {
  test('verifyStamped rejects malformed input ' + JSON.stringify(bad)?.slice(0, 40), () => {
    assert.throws(() => verifyStamped(bad));
  });
}
test('tampering with day title breaks verification', () => {
  const report = buildLabReport(tinyDay());
  const dirty = structuredClone(report.stamped);
  dirty.proof.day.title = 'Changed title';
  assert.equal(verifyStamped(dirty).ok, false);
});
test('tampering with a comparator number breaks verification', () => {
  const report = buildLabReport(tinyDay());
  const dirty = structuredClone(report.stamped);
  dirty.proof.comparator[0].rows[0].totalTravelMin += 7;
  assert.equal(verifyStamped(dirty).ok, false);
});
test('tampering with the recorded digest itself breaks verification', () => {
  const report = buildLabReport(tinyDay());
  const dirty = structuredClone(report.stamped);
  dirty.integrity.digest = 'f'.repeat(64);
  assert.equal(verifyStamped(dirty).ok, false);
});
test('buildTamperedStamped perturbs travel and fails verification without touching the original', () => {
  const report = buildLabReport(tinyDay());
  const before = JSON.stringify(report.stamped);
  const dirty = buildTamperedStamped(report.stamped);
  assert.equal(verifyStamped(dirty).ok, false);
  assert.equal(JSON.stringify(report.stamped), before);
});
test('buildTamperedStamped rejects malformed input', () => {
  for (const bad of [null, {}, { proof: {} }]) assert.throws(() => buildTamperedStamped(bad));
});

// ---- exports and digest parity ----
test('JSON export parses and re-verifies with the same digest', () => {
  const report = buildLabReport(tinyDay());
  const parsed = JSON.parse(exportProofJson(report.stamped));
  assert.equal(parsed.integrity.digest, report.digest);
  assert.equal(verifyStamped(parsed).ok, true);
});
test('CSV export carries sha256 provenance header, CRLF lines, and formula-safe cells', () => {
  const report = buildLabReport(tinyDay('=EVIL()'));
  const csv = exportProofCsv(report.stamped);
  assert.ok(csv.startsWith('# LoopLess schedule proof,sha256=' + report.digest));
  assert.ok(csv.includes('=EVIL'));
  assert.ok(csv.includes("'=EVIL()"));
  for (const line of csv.split('\r\n')) assert.ok(!line.includes('\n'));
  assert.ok(csv.endsWith('\r\n'));
});
test('CSV export lists all 16 comparator rows and 16 delay rows', () => {
  const csv = exportProofCsv(buildLabReport(tinyDay()).stamped);
  const lines = csv.split('\r\n').filter(Boolean);
  const comparatorRows = lines.filter((line) => /^(Walk|Bike|Bus \/ Rail|Carpool),/.test(line));
  const delayRows = lines.filter((line) => /^'\+\d+,/.test(line));
  assert.equal(comparatorRows.length, 16);
  assert.equal(delayRows.length, 16);
});
test('Markdown export carries digest footer, tables, and scope', () => {
  const report = buildLabReport(tinyDay());
  const md = exportProofMarkdown(report.stamped);
  assert.ok(md.includes('Proof SHA-256: ' + report.digest));
  assert.ok(md.includes('## Strategy by mode comparator'));
  assert.ok(md.includes('| Walk |'));
  assert.ok(md.includes('first missed deadline') || md.includes('no missed deadline'));
  assert.ok(md.endsWith('\n'));
});
test('page digest, JSON, CSV, and Markdown all carry the identical digest', () => {
  const report = buildLabReport(tinyDay());
  const digest = report.digest;
  assert.ok(exportProofJson(report.stamped).includes(digest));
  assert.ok(exportProofCsv(report.stamped).includes('sha256=' + digest));
  assert.ok(exportProofMarkdown(report.stamped).includes(digest));
});
for (const fn of [exportProofJson, exportProofCsv, exportProofMarkdown]) {
  test(`${fn.name} rejects malformed stamped input`, () => {
    for (const bad of [null, {}, { proof: {} }]) assert.throws(() => fn(bad));
  });
}
test('JSON export of the default day re-verifies after a serialize round-trip', () => {
  const report = buildLabReport(defaultDay());
  const round = JSON.parse(JSON.stringify(report.stamped));
  assert.equal(verifyStamped(round).ok, true);
});

// ---- lab hash codec ----
const codecStates = [
  { day: 'current', mode: 'bike', strategy: 'loopless-exact', delay: 0 },
  { day: 'current', mode: 'walk', strategy: 'fifo', delay: 15 },
  { day: 'houston-stem', mode: 'bus', strategy: 'edf', delay: 7 },
  { day: 'honest-overload', mode: 'car', strategy: 'nearest-neighbor', delay: 3 },
  { day: 'Riverside-family', mode: 'walk', strategy: 'loopless-exact', delay: 12 },
];
for (const state of codecStates) {
  test(`lab hash round-trips ${state.day}/${state.mode}/${state.strategy}/+${state.delay}`, () => {
    const decoded = decodeLabHash(encodeLabHash(state), STUDIO_PRESETS.map((p) => p.id));
    assert.deepEqual(decoded, state);
  });
}
test('encodeLabHash emits the versioned llab format', () => {
  const hash = encodeLabHash({ day: 'current', mode: 'bike', strategy: 'fifo', delay: 2 });
  assert.equal(hash, LAB_HASH_PREFIX + 'v' + LAB_VERSION + '.current.bike.fifo.2');
});
for (const bad of [
  '#tour=abc', '#capybara-buddy', '', 'llab=v1.current.bike.fifo.0',
  '#llab=v2.current.bike.fifo.0', '#llab=v1.current.bike.fifo', '#llab=v1.current.bike.fifo.0.x',
  '#llab=v1..bike.fifo.0', '#llab=v1.current.bike.fifo.', '#llab=',
]) {
  test('decodeLabHash rejects ' + JSON.stringify(bad), () => {
    assert.throws(() => decodeLabHash(bad, ['current']), /lab link|version|Malformed/i);
  });
}
for (const bad of [
  '#llab=v1.__proto__.bike.fifo.0', '#llab=v1.constructor.bike.fifo.0', '#llab=v1.prototype.bike.fifo.0',
  '#llab=v1.current.__proto__.fifo.0', '#llab=v1.current.bike.__proto__.0', '#llab=v1.current.bike.constructor.0',
]) {
  test('decodeLabHash fail-closed on ' + bad, () => {
    assert.throws(() => decodeLabHash(bad, ['current']), /Malformed lab link token|Unknown strategy/);
  });
}
for (const bad of ['#llab=v1.current.bike.fifo.16', '#llab=v1.current.bike.fifo.-1', '#llab=v1.current.bike.fifo.x', '#llab=v1.current.bike.fifo.1.5', '#llab=v1.current.bike.fifo.99']) {
  test('decodeLabHash rejects delay in ' + bad, () => {
    assert.throws(() => decodeLabHash(bad, ['current']));
  });
}
test('decodeLabHash rejects a day not in the allowlist', () => {
  assert.throws(() => decodeLabHash('#llab=v1.unknown-day.bike.fifo.0', ['houston-stem']), /Unknown lab day/);
  assert.deepEqual(decodeLabHash('#llab=v1.unknown-day.bike.fifo.0', ['unknown-day']).day, 'unknown-day');
});
test('decodeLabHash always allows the current day token', () => {
  assert.equal(decodeLabHash('#llab=v1.current.bus.edf.4', []).day, 'current');
});
test('decodeLabHash rejects non-string input', () => {
  for (const bad of [null, 5, {}, []]) assert.throws(() => decodeLabHash(bad));
});
test('decodeLabHash rejects overlong and uppercase tokens', () => {
  assert.throws(() => decodeLabHash('#llab=v1.' + 'a'.repeat(49) + '.bike.fifo.0', ['a'.repeat(49)]));
  assert.throws(() => decodeLabHash('#llab=v1.Current.bike.fifo.0', ['Current']));
  assert.throws(() => decodeLabHash('#llab=v1.current.BIKE.fifo.0', ['current']));
});
test('encodeLabHash rejects hostile state fields', () => {
  assert.throws(() => encodeLabHash({ day: '__proto__', mode: 'bike', strategy: 'fifo', delay: 0 }));
  assert.throws(() => encodeLabHash({ day: 'current', mode: '__proto__', strategy: 'fifo', delay: 0 }));
  assert.throws(() => encodeLabHash({ day: 'current', mode: 'bike', strategy: 'constructor', delay: 0 }));
  assert.throws(() => encodeLabHash({ day: 'current', mode: 'bike', strategy: 'fifo', delay: 20 }));
  assert.throws(() => encodeLabHash(null));
  assert.throws(() => encodeLabHash([]));
});
test('a decoded lab hash never pollutes Object.prototype', () => {
  decodeLabHash('#llab=v1.current.bike.fifo.0', []);
  assert.equal({}.polluted, undefined);
  assert.equal(Object.prototype.llab, undefined);
});

// ---- runSelfTests meta checks ----
test('runSelfTests reports at least 18 checks and all pass', () => {
  const outcome = runSelfTests();
  assert.ok(outcome.total >= 18);
  assert.equal(outcome.passed, outcome.total);
  assert.equal(outcome.ok, true);
});
test('runSelfTests flags a failing check instead of throwing', () => {
  const outcome = runSelfTests([
    { id: 'ok', name: 'passes', run: () => true },
    { id: 'bad', name: 'fails', run: () => { throw new Error('boom'); } },
    { id: 'falsey', name: 'returns non-true', run: () => 5 },
  ]);
  assert.equal(outcome.total, 3);
  assert.equal(outcome.passed, 1);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.results[1].detail, 'boom');
  assert.match(outcome.results[2].detail, /returned/);
});
for (const entry of SELF_TESTS) {
  test(`self-test ${entry.id}: ${entry.name}`, () => {
    assert.equal(entry.run(), true);
  });
}

// ---- planner telemetry ----
test('solveOptimal reports real explored node counts on exact searches', () => {
  const solved = solveOptimal(defaultDay());
  assert.ok(Number.isInteger(solved.nodesExplored));
  assert.ok(solved.nodesExplored > 0 && solved.nodesExplored <= BNB_NODE_BUDGET);
});
test('solveOptimal reports zero nodes on an empty day and null on the 14-stop heuristic', () => {
  assert.equal(solveOptimal({ startTime: '09:00', stops: [] }).nodesExplored, 0);
  const corpus14 = { id: 'big', title: 'Big', mode: 'car', startTime: '08:00', anchor: { x: 0, y: 0 }, stops: Array.from({ length: 14 }, (_, i) => ({ id: 's' + i, name: 'S' + i, x: (i % 5) - 2, y: (i % 3) - 1, durationMin: 10, windowStart: '08:00', windowEnd: '18:00', priority: 2 })) };
  const solved = solveOptimal(corpus14);
  assert.equal(solved.method, 'heuristic-2opt');
  assert.equal(solved.nodesExplored, null);
});
test('a one-node budget still reports its explored count and bounded label', () => {
  const solved = solveOptimal(defaultDay(), { nodeBudget: 1 });
  assert.equal(solved.method, 'bounded-bnb');
  assert.ok(Number.isInteger(solved.nodesExplored) && solved.nodesExplored >= 1 && solved.nodesExplored <= BNB_NODE_BUDGET);
});


test('batch4 csv guard covers invisible unicode prefixes and numeric negatives', () => {
  for (const input of ['\u200b=cmd', '\ufeff=cmd', '\u00a0=cmd', '\u2060@cmd', ' \u200b\t=cmd']) {
    const out = csvCell(input);
    assert.ok(out.startsWith("'") || out.startsWith("\"'"), input + ' -> ' + out);
  }
  assert.ok(!String(csvCell(-12.5)).includes("'"));
});
