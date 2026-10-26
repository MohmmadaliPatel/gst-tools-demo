import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isoDate, normalizeMembers, classify, buildBoard, fillTemplate, DEFAULT_TEMPLATES, renewalPipeline } from '../js/renewals.js';

const ms = normalizeMembers([
  { Name: 'Asha Rao', Plan: 'Monthly', Expiry: '20-10-2026', sessions_total: '12', sessions_used: '12', fee_total: '2500', fee_paid: '2500' },
  { Name: 'Vik Shah', Plan: 'Monthly', Expiry: '2026-10-30', sessions_total: '12', sessions_used: '4', fee_total: '2500', fee_paid: '1000', renewal_price: '2400' },
  { Name: 'Zoya Ali', Plan: '1:1 Physics', Expiry: '2026-12-30', sessions_total: '20', sessions_used: '19', fee_total: '18000', fee_paid: '18000' },
  { Name: 'Ravi Jain', Plan: 'Quarterly', Expiry: '2027-01-15', sessions_total: '36', sessions_used: '3', fee_total: '6500', fee_paid: '6500' },
  { Name: '', Plan: 'x' },
]);
test('Indian date formats are accepted', () => {
  assert.equal(isoDate('5/1/2027'), '2027-01-05'); assert.equal(isoDate('2026-10-20'), '2026-10-20'); assert.equal(isoDate('Oct 5'), '');
  assert.equal(ms.length, 4);
});
test('classification: expired, due soon, low balance, fee pending, active', () => {
  const [a, v, z, r] = ms.map((m) => classify(m, '2026-10-26'));
  assert.deepEqual(a.flags, ['Expired', 'Low-balance']); assert.equal(a.daysLeft, -6);
  assert.deepEqual(v.flags, ['Due-soon', 'Fee-pending']); assert.equal(v.pending, 1500); assert.equal(v.daysLeft, 4);
  assert.deepEqual(z.flags, ['Low-balance']); assert.equal(z.left, 1);
  assert.equal(r.status, 'Active');
  assert.deepEqual(classify(ms[1], '2026-10-26', { dueDays: 3 }).flags, ['Fee-pending']);
});
test('board is sorted by urgency', () => {
  assert.deepEqual(buildBoard(ms, '2026-10-26').map((r) => r.name), ['Asha Rao', 'Vik Shah', 'Zoya Ali', 'Ravi Jain']);
});
test('templates fill placeholders and leave unknown ones visible', () => {
  const v = classify(ms[1], '2026-10-26');
  assert.equal(fillTemplate(DEFAULT_TEMPLATES['Due-soon'], v, 'Studio'), 'Hi Vik, a quick reminder that your Monthly plan ends on 30 Oct 2026 (4 days left). Renewal is ₹2,400. Shall we renew it for you? – Studio');
  assert.equal(fillTemplate('{first} owes {pending} {oops}', v), 'Vik owes ₹1,500 {oops}');
});
test('renewal pipeline sums renewals due within the window and all pending fees', () => {
  const p = renewalPipeline(buildBoard(ms, '2026-10-26'), 30);
  assert.deepEqual(p, { count: 1, value: 2400, pendingFees: 1500 });
});
