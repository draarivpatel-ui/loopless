import test from 'node:test';
import assert from 'node:assert/strict';
import { solveOptimal, buildIcsCalendar } from '../js/planner.mjs';

const day = (name = 'Errand') => ({ id: 'export', startTime: '10:00', mode: 'bike', returnToAnchor: false, stops: [{ id: 'one', name, x: 0, y: 0, durationMin: 20, windowStart: '10:00', windowEnd: '12:00' }] });
const calendar = (raw, date = '2026-11-21') => { const result = solveOptimal(raw); return buildIcsCalendar(result.scenario, result.optimal, date); };
test('calendar escapes backslashes, commas, semicolons, LF, CRLF, and bare CR', () => {
  const ics = calendar(day('A\\B, C; D\nE\r\nF\rG'));
  assert.ok(ics.includes('SUMMARY:A\\\\B\\, C\\; D\\nE\\nF\\nG\r\n'));
  assert.equal(ics.split('BEGIN:VEVENT').length - 1, 1);
});
test('UTF-8 folding counts octets and never splits a multibyte character', () => {
  const name = ('Caf' + String.fromCharCode(233) + ' ' + String.fromCodePoint(0x1f34a) + ' ').repeat(24);
  const ics = calendar(day(name));
  for (const line of ics.split('\r\n').filter(Boolean)) assert.ok(Buffer.byteLength(line, 'utf8') <= 75);
  assert.ok(!ics.includes(String.fromCharCode(0xfffd)));
  assert.ok(ics.replace(/\r\n /g, '').includes('SUMMARY:' + name + '\r\n'));
});
test('calendar emits only CRLF line boundaries and one VEVENT per errand', () => {
  const raw = day(); raw.stops.push({ ...raw.stops[0], id: 'two', name: 'Second' });
  const ics = calendar(raw);
  assert.equal(ics.replace(/\r\n/g, '').includes('\n'), false);
  assert.equal(ics.split('BEGIN:VEVENT').length - 1, 2);
  assert.equal(ics.split('END:VEVENT').length - 1, 2);
});
test('UID values are encoded and date-qualified to resist calendar line injection', () => {
  const raw = day(); raw.id = 'bad\r\nBEGIN:VEVENT';
  const ics = calendar(raw);
  assert.ok(ics.includes('UID:loopless-bad%0D%0ABEGIN%3AVEVENT-one-20261121@local'));
  assert.equal(ics.split('BEGIN:VEVENT\r\n').length - 1, 1);
});
test('calendar rejects invalid format and nonexistent dates rather than normalizing silently', () => {
  for (const date of ['bad', '2026-02-29', '2026-13-01', '2026-00-20', '2026-04-31', '0000-01-01']) assert.throws(() => calendar(day(), date), /date/i);
});
test('calendar correctly accepts leap days and rolls a late errand into the next year', () => {
  assert.ok(calendar(day(), '2028-02-29').includes('DTSTART:20280229T100000'));
  const raw = day(); raw.startTime = '23:50'; raw.stops[0].windowStart = '23:50'; raw.stops[0].windowEnd = '23:59'; raw.stops[0].durationMin = 20;
  assert.ok(calendar(raw, '2026-12-31').includes('DTEND:20270101T001000'));
});
test('calendar output is deterministic and uses documented local floating times', () => {
  const one = calendar(day()), two = calendar(day());
  assert.equal(one, two);
  assert.ok(one.includes('DTSTART:20261121T100000\r\n'));
  assert.ok(!one.includes('DTSTART;TZID='));
  assert.ok(one.includes('DTSTAMP:20261121T000000Z\r\n'));
});
test('an empty day exports a valid empty calendar', () => {
  const ics = calendar({ startTime: '09:00', stops: [] });
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n')); assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
  assert.equal(ics.includes('BEGIN:VEVENT'), false);
});
