import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEinvoice, validateEinvoice, computeItemTax, isInterState } from '../js/einvoice.js';
import { makeGstin } from '../js/gst.js';

const seller = { gstin: makeGstin('27', 'AAECD0001K'), lglNm: 'Demo Seller Pvt Ltd', addr1: '1 Road', loc: 'Pune', pin: '411001' };
const buyerKA = { gstin: makeGstin('29', 'AAHCD4444R'), lglNm: 'Demo Buyer Pvt Ltd', addr1: '2 Road', loc: 'Bengaluru', pin: '560001' };
const buyerMH = { gstin: makeGstin('27', 'AAJFM5555L'), lglNm: 'Demo Local Buyer', addr1: '3 Road', loc: 'Mumbai', pin: '400001' };
const item = { desc: 'Widget', isServc: 'N', hsn: '84433250', qty: 3, unit: 'NOS', unitPrice: 8499.99, gstRt: 18 };
const base = (o = {}) => ({ docNo: 'DEMO/1', docDt: '2026-10-20', seller, buyer: buyerKA, items: [item], ...o });

test('place of supply decides IGST vs CGST+SGST', () => {
  assert.equal(isInterState({ sellerStcd: '27', pos: '29' }), true);
  assert.equal(isInterState({ sellerStcd: '27', pos: '27' }), false);
  assert.equal(isInterState({ supTyp: 'SEZWP', sellerStcd: '27', pos: '27' }), true);
  assert.equal(isInterState({ sellerStcd: '27', pos: '27', igstOnIntra: 'Y' }), true);
});
test('tax math: intra-state halves are each rounded (CGST = SGST)', () => {
  const t = computeItemTax({ qty: 3, unitPrice: 8499.99, gstRt: 18 }, false);
  assert.equal(t.assAmt, 25499.97);
  assert.equal(t.cgst, 2295); assert.equal(t.sgst, 2295);
  assert.equal(t.totItemVal, 30089.97);
});
test('tax math: inter-state IGST', () => {
  const t = computeItemTax({ qty: 1, unitPrice: 30000, gstRt: 18, discount: 500 }, true);
  assert.equal(t.assAmt, 29500); assert.equal(t.igst, 5310); assert.equal(t.cgst, 0);
});
test('built inter-state and intra-state invoices validate clean, with round-off', () => {
  const a = buildEinvoice(base());
  assert.equal(a.ValDtls.IgstVal, 4589.99);
  assert.equal(a.ValDtls.TotInvVal, 30090); assert.equal(a.ValDtls.RndOffAmt, 0.04);
  assert.deepEqual(validateEinvoice(a).errors, []);
  const b = buildEinvoice(base({ buyer: buyerMH }));
  assert.equal(b.ItemList[0].CgstAmt, 2295);
  assert.equal(validateEinvoice(b).valid, true);
});
test('wrong tax head for place of supply is an error', () => {
  const j = buildEinvoice(base({ buyer: buyerMH }));
  j.ItemList[0].IgstAmt = 4590; j.ItemList[0].CgstAmt = 0; j.ItemList[0].SgstAmt = 0;
  const msgs = validateEinvoice(j).errors.map((e) => e.message).join('\n');
  assert.match(msgs, /Intra-state supply/);
});
test('tax amount off by more than ₹1 is an error, within ₹1 is tolerated', () => {
  const j = buildEinvoice(base());
  j.ItemList[0].IgstAmt += 0.5; j.ItemList[0].TotItemVal += 0.5; j.ValDtls.IgstVal += 0.5; j.ValDtls.TotInvVal += 0.5;
  assert.equal(validateEinvoice(j).valid, true);
  j.ItemList[0].IgstAmt += 5;
  assert.ok(validateEinvoice(j).errors.some((e) => e.path === 'ItemList[0].IgstAmt'));
});
test('field-level validation: GSTIN checksum, HSN length, service code, rate, doc no, date, PIN', () => {
  const j = buildEinvoice(base());
  j.SellerDtls.Gstin = j.SellerDtls.Gstin.slice(0, 14) + (j.SellerDtls.Gstin[14] === 'A' ? 'B' : 'A');
  j.ItemList[0].HsnCd = '84433';
  j.ItemList[0].GstRt = 17;
  j.DocDtls.No = '0INV/1';
  j.DocDtls.Dt = '31/02/2026';
  j.BuyerDtls.Pin = 5600;
  const paths = validateEinvoice(j).errors.map((e) => e.path);
  for (const p of ['SellerDtls.Gstin', 'ItemList[0].HsnCd', 'ItemList[0].GstRt', 'DocDtls.No', 'DocDtls.Dt', 'BuyerDtls.Pin']) assert.ok(paths.includes(p), p);
  const s = buildEinvoice(base({ items: [{ ...item, isServc: 'Y', hsn: '84433250' }] }));
  assert.ok(validateEinvoice(s).errors.some((e) => /does not start with 99/.test(e.message)));
});
test('exports: URP buyer and POS 96; without-payment means zero tax', () => {
  const j = buildEinvoice(base({ supTyp: 'EXPWOP', buyer: { gstin: 'URP', lglNm: 'Overseas Buyer Inc', addr1: 'x', loc: 'Dubai', pin: '999999', stcd: '96', pos: '96' } }));
  assert.equal(j.ValDtls.IgstVal, 0);
  assert.deepEqual(validateEinvoice(j).errors, []);
});
