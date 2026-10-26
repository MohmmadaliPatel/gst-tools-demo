import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeLine, computeQuote, amountInWords, nextQuoteNo, fyLabel, followUpQueue, winRate } from '../js/quote.js';

const pipe = { name: 'Pipe', hsn: '7306', unit: 'm', basis: 'kg', kgPerUnit: 2.5, rate: 60, gst: 18 };
const svc = { name: 'Cutting', unit: 'Nos', basis: 'unit', rate: 40, gst: 18 };

test('per-kg line: length x kg/m x rate, then discount and GST', () => {
  const l = computeLine(pipe, 100, 10); // 250 kg x 60 = 15000, -10% = 13500, GST 2430
  assert.equal(l.weight, 250); assert.equal(l.gross, 15000); assert.equal(l.taxable, 13500); assert.equal(l.tax, 2430); assert.equal(l.total, 15930);
});
test('negative quantity is rejected', () => assert.throws(() => computeLine(svc, -1), /negative/));
test('same state -> CGST+SGST split; different state -> IGST', () => {
  const lines = [{ item: pipe, qty: 100, disc: 0 }, { item: svc, qty: 5, disc: 0 }];
  const intra = computeQuote(lines, { sellerState: 'Tamil Nadu', buyerState: 'Tamil Nadu' });
  assert.equal(intra.taxable, 15200); assert.equal(intra.cgst, 1368); assert.equal(intra.sgst, 1368); assert.equal(intra.igst, 0);
  const inter = computeQuote(lines, { sellerState: 'Tamil Nadu', buyerState: 'Karnataka' });
  assert.equal(inter.igst, 2736); assert.equal(inter.cgst, 0); assert.equal(inter.grand, 17936);
});
test('freight is taxed at 18% and totals round to whole rupees with round-off', () => {
  const q = computeQuote([{ item: { ...svc, rate: 33.33 }, qty: 1 }], { sellerState: 'A', buyerState: 'B', freight: 10 });
  assert.equal(q.taxable, 43.33); assert.equal(q.tax, 7.8); assert.equal(q.grand, 51); assert.equal(q.roundOff, -0.13);
});
test('export quote is zero-rated and reports CBM / container fill', () => {
  const q = computeQuote([{ item: { name: 'Towels', unit: 'ctn', rate: 1000, gst: 5, cbmPerUnit: 0.1 }, qty: 140 }], { export: true });
  assert.equal(q.tax, 0); assert.equal(q.cbm, 14); assert.equal(q.fill20, 50); assert.equal(q.grand, 140000);
});
test('amount in words uses Indian numbering', () => {
  assert.equal(amountInWords(0), 'Rupees Zero Only');
  assert.equal(amountInWords(17936), 'Rupees Seventeen Thousand Nine Hundred Thirty Six Only');
  assert.equal(amountInWords(1250000), 'Rupees Twelve Lakh Fifty Thousand Only');
  assert.equal(amountInWords(30405001), 'Rupees Three Crore Four Lakh Five Thousand One Only');
});
test('quote numbers follow the Indian financial year', () => {
  assert.equal(fyLabel('2026-03-31'), '2025-26'); assert.equal(fyLabel('2026-04-01'), '2026-27');
  const reg = [{ no: 'Q/2026-27/0009' }, { no: 'Q/2025-26/0120' }];
  assert.equal(nextQuoteNo(reg, '2026-10-26'), 'Q/2026-27/0010');
  assert.equal(nextQuoteNo([], '2027-04-02'), 'Q/2027-28/0001');
});
test('follow-up queue: only open quotes due today or overdue, most overdue first', () => {
  const reg = [
    { no: 'a', status: 'Sent', date: '2026-10-10', followUp: '2026-10-20', amount: 10 },
    { no: 'b', status: 'Sent', date: '2026-10-20', followUp: '2026-10-26', amount: 50 },
    { no: 'c', status: 'Sent', date: '2026-10-22', followUp: '2026-10-30', amount: 99 },
    { no: 'd', status: 'Won', date: '2026-10-01', followUp: '2026-10-05', amount: 99 },
  ];
  const q = followUpQueue(reg, '2026-10-26');
  assert.deepEqual(q.map((r) => r.no), ['a', 'b']); assert.equal(q[0].overdueBy, 6); assert.equal(q[0].daysOpen, 16);
  assert.equal(winRate([...reg, { status: 'Lost' }]), 50); assert.equal(winRate([]), null);
});
