// Sample dates follow the visitor's "today". Every test injects its own dates, so results never depend on the real clock.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SAMPLE_DAY, localToday, sampleOffset, shiftIso, shiftSampleText } from '../js/sample-dates.js';
import { parseCsv } from '../js/csv.js';
import { normalizeMembers, buildBoard, renewalPipeline } from '../js/renewals.js';
import { normalizeMaster, normalizeMoves, computeStock, reconcileChannels, daySummary } from '../js/stock.js';

const sample = (f) => readFileSync(new URL(`../samples/${f}`, import.meta.url), 'utf8');
const DAYS = ['2026-10-26', '2026-11-03', '2027-01-01', '2027-03-01', '2028-02-29', '2030-12-31', '2026-01-15'];

test('localToday uses the local calendar date of the injected clock', () => {
  assert.equal(localToday(new Date(2027, 0, 5, 23, 59)), '2027-01-05');
  assert.equal(localToday(new Date(2026, 9, 26, 0, 1)), '2026-10-26');
});

test('offsets and shifts cross month, year and leap-day boundaries', () => {
  assert.equal(sampleOffset(SAMPLE_DAY), 0);
  assert.equal(sampleOffset('2026-11-03'), 8);
  assert.equal(sampleOffset('2026-10-20'), -6);
  assert.equal(shiftIso('2026-12-30', 3), '2027-01-02');
  assert.equal(shiftIso('2028-02-27', 2), '2028-02-29');
  assert.equal(shiftIso('2026-03-01', -1), '2026-02-28');
});

test('shiftSampleText keeps each date format and leaves other text alone', () => {
  const t = 'a,2026-10-24,20-10-2026,25/10/2026,ORD20261026,2500\n';
  assert.equal(shiftSampleText(t, 8), 'a,2026-11-01,28-10-2026,02/11/2026,ORD20261026,2500\n');
  assert.equal(shiftSampleText(t, 0), t);
});

const board = (today) => {
  const ms = normalizeMembers(parseCsv(shiftSampleText(sample('members.csv'), sampleOffset(today))));
  const b = buildBoard(ms, today, { dueDays: 7, lowSessions: 2 });
  const p = renewalPipeline(b, 30);
  return { rows: b.map((r) => [r.name, r.status, r.flags.join(' '), r.daysLeft]), pending: p.pendingFees, value: p.value, count: p.count };
};

test('renewals sample tells the same story (expired, due soon, low, fees) on any day', () => {
  const ref = board(SAMPLE_DAY);
  assert.ok(ref.rows.some((r) => r[1] === 'Expired') && ref.rows.some((r) => r[2].includes('Due-soon')), 'reference has expired and due-soon members');
  for (const d of DAYS) assert.deepEqual(board(d), ref, `story on ${d}`);
});

const stock = (today) => {
  const moves = normalizeMoves(parseCsv(shiftSampleText(sample('stock_movements.csv'), sampleOffset(today))));
  const s = computeStock(normalizeMaster(parseCsv(sample('stock_master.csv'))), moves, today);
  const rec = reconcileChannels(s, parseCsv(sample('shopify_inventory.csv')));
  return { stock: s.map((x) => [x.sku, x.available, x.status]), rec: rec.map((r) => [r.sku, r.status]), day: daySummary(moves, today) };
};

test('stock sample: same levels, low/out items, channel mismatches and "dispatched today" on any day', () => {
  const ref = stock(SAMPLE_DAY);
  assert.ok(ref.day.outward > 0 && ref.stock.some((x) => x[2] === 'Low'), 'reference has dispatches today and low stock');
  for (const d of DAYS) assert.deepEqual(stock(d), ref, `story on ${d}`);
});
