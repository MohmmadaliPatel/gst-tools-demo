// The quote demo's sample register follows the visitor's "today". Dates are injected, never read from the real clock.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SAMPLE_REG, sampleRegister } from '../js/quote-sample.js';
import { SAMPLE_DAY } from '../js/sample-dates.js';
import { followUpQueue, winRate, nextQuoteNo, fyLabel } from '../js/quote.js';

const DAYS = ['2026-10-26', '2026-11-03', '2027-01-01', '2027-03-15', '2028-02-29', '2030-12-31', '2026-05-10'];
const story = (today) => {
  const reg = sampleRegister(today);
  return {
    due: followUpQueue(reg, today).map((r) => [r.no.split('/').pop(), r.client, r.amount, r.daysOpen, r.overdueBy]),
    open: reg.filter((r) => r.status === 'Sent').length, win: winRate(reg), next: nextQuoteNo(reg, today).split('/').pop(),
  };
};

test('on the sample day the register is unchanged', () => {
  assert.deepEqual(sampleRegister(SAMPLE_DAY), SAMPLE_REG);
});

test('quote follow-up story (overdue, due today, win rate, next number) is the same on any day', () => {
  const ref = story(SAMPLE_DAY);
  assert.deepEqual(ref.due.map((r) => r[4]), [5, 0], 'reference: one 5 days overdue, one due today');
  assert.equal(ref.next, '0046');
  for (const d of DAYS) assert.deepEqual(story(d), ref, `story on ${d}`);
});

test('dates move by whole days and quote numbers follow each quote\'s own financial year', () => {
  const reg = sampleRegister('2027-04-03'); // 159 days later: quotes straddle 1 April
  assert.deepEqual(reg.map((r) => r.date), ['2027-03-22', '2027-03-25', '2027-03-28', '2027-03-29', '2027-03-31']);
  assert.ok(reg.every((r) => r.no.startsWith(`Q/${fyLabel(r.date)}/`)), 'FY prefix matches each date');
  assert.equal(nextQuoteNo(reg, '2027-04-03'), 'Q/2027-28/0001', 'first quote of the new FY');
  assert.equal(sampleRegister('2027-04-03')[1].followUp, '', 'empty follow-up stays empty');
});

test('sampleRegister returns fresh objects (editing one never changes the sample)', () => {
  const a = sampleRegister('2027-01-01'); a[0].status = 'Won';
  assert.equal(sampleRegister('2027-01-01')[0].status, 'Sent'); assert.equal(SAMPLE_REG[0].status, 'Sent');
});
