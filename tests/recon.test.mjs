import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeInvoiceNo, parseDate, similarity, reconcile, flattenGstr2b, normalizeBooks } from '../js/recon.js';
import { parseCsv } from '../js/csv.js';
import { makeGstin } from '../js/gst.js';

const A = makeGstin('27', 'AABCE1111M');
const rec = (o) => ({ gstin: A, name: 'X', invoiceNo: 'INV/1', date: '2026-09-01', invoiceValue: 118, taxable: 100, igst: 0, cgst: 9, sgst: 9, cess: 0, kind: 'Invoice', itcAvailable: true, ...o });

test('invoice number normalisation', () => {
  assert.equal(normalizeInvoiceNo('inv/0045'), 'INV45');
  assert.equal(normalizeInvoiceNo('INV-45'), 'INV45');
  assert.equal(normalizeInvoiceNo(' SOS 0045 '), 'SOS45');
});
test('date parsing handles common Indian formats', () => {
  assert.equal(parseDate('03-09-2026'), '2026-09-03');
  assert.equal(parseDate('3/9/26'), '2026-09-03');
  assert.equal(parseDate('2026-09-03'), '2026-09-03');
  assert.equal(parseDate('03-Sep-2026'), '2026-09-03');
  assert.equal(parseDate('nonsense'), '');
});
test('similarity rewards identical numeric tail', () => {
  assert.ok(similarity('118', 'TL/26-27/118') >= 0.8);
  assert.ok(similarity('118', 'TL/26-27/119') < 0.75);
});
test('exact match after normalisation is Matched', () => {
  const r = reconcile([rec({ invoiceNo: 'INV-0001' })], [rec({ invoiceNo: 'inv/1' })]);
  assert.equal(r.results[0].status, 'Matched');
});
test('differences within tolerance stay Matched; beyond tolerance are Mismatch with field diffs', () => {
  let r = reconcile([rec({})], [rec({ taxable: 100.6 })], { valueTolerance: 1 });
  assert.equal(r.results[0].status, 'Matched');
  r = reconcile([rec({})], [rec({ taxable: 150, cgst: 13.5, sgst: 13.5 })], { valueTolerance: 1, taxTolerance: 1 });
  assert.equal(r.results[0].status, 'Mismatch');
  assert.deepEqual(r.results[0].diffs.map((d) => d.field), ['Taxable value', 'CGST', 'SGST']);
  assert.equal(r.results[0].diffs[0].diff, 50);
});
test('date tolerance is configurable', () => {
  const g = [rec({ date: '2026-09-01' })], b = [rec({ date: '2026-09-03' })];
  assert.equal(reconcile(g, b, { dateToleranceDays: 0 }).results[0].status, 'Mismatch');
  assert.equal(reconcile(g, b, { dateToleranceDays: 3 }).results[0].status, 'Matched');
});
test('fuzzy invoice-number match within same GSTIN', () => {
  const r = reconcile([rec({ invoiceNo: 'TL/26-27/118' })], [rec({ invoiceNo: '118' })]);
  assert.equal(r.results[0].status, 'Mismatch');
  assert.equal(r.results[0].matchType, 'fuzzy');
  assert.equal(r.results[0].diffs[0].field, 'Invoice no.');
  const off = reconcile([rec({ invoiceNo: 'TL/26-27/118' })], [rec({ invoiceNo: '118' })], { fuzzyInvoice: false });
  assert.deepEqual(off.results.map((x) => x.status).sort(), ['Only in 2B', 'Only in books']);
});
test('GSTIN typo with same PAN is paired and flagged', () => {
  const r = reconcile([rec({})], [rec({ gstin: makeGstin('27', 'AABCE1111M', '2') })]);
  assert.equal(r.results[0].status, 'Mismatch');
  assert.equal(r.results[0].diffs[0].field, 'Supplier GSTIN');
});
test('unmatched records and ITC summary', () => {
  const r = reconcile([rec({ invoiceNo: 'A1' }), rec({ invoiceNo: 'B77', itcAvailable: false })], [rec({ invoiceNo: 'A1' }), rec({ invoiceNo: 'Z900' })]);
  const st = r.results.map((x) => x.status).sort();
  assert.deepEqual(st, ['Matched', 'Only in 2B', 'Only in books']);
  assert.equal(r.summary.itcAsPer2B, 18);
  assert.equal(r.summary.itcNotAvailableIn2B, 18);
  assert.equal(r.summary.itcAtRisk, 18);
  assert.equal(r.vendors.length, 1);
  assert.match(r.vendors[0].action, /Z900/);
});
test('credit notes never pair with invoices', () => {
  const r = reconcile([rec({ kind: 'Credit note', taxable: -100 })], [rec({})]);
  assert.deepEqual(r.results.map((x) => x.status).sort(), ['Only in 2B', 'Only in books']);
});
test('bundled sample files reconcile to the documented scenario counts', () => {
  const g = flattenGstr2b(JSON.parse(readFileSync(new URL('../samples/gstr2b_sample.json', import.meta.url), 'utf8')));
  const b = normalizeBooks(parseCsv(readFileSync(new URL('../samples/purchase_register.csv', import.meta.url), 'utf8')));
  const r = reconcile(g, b);
  assert.deepEqual(r.summary.counts, { Matched: 4, Mismatch: 5, 'Only in 2B': 3, 'Only in books': 2 });
});
test('purchase register with missing required column throws a clear error', () => {
  assert.throws(() => normalizeBooks([{ Foo: 1 }]), /missing a "gstin" column/);
});
