// TDS credit check: 26AS text parser, Form 168 CSV mapper, engine golden results on the synthetic samples.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as F from '../js/form26as.js';
import * as T from '../js/tds.js';

const rd = (f) => readFileSync(new URL(`../samples/tds/${f}`, import.meta.url), 'utf8');
const table = JSON.parse(readFileSync(new URL('../js/tds-sections.json', import.meta.url), 'utf8'));
const expected = JSON.parse(rd('expected_results.json'));
const cur = F.readStatement(rd('form26as_sample.txt'), 'cur');
const prev = F.readStatement(rd('form26as_prev_sample.txt'), 'prev');
const stmt = [...cur.records, ...prev.records];
const partyMap = F.readPartyMap(rd('party_tan_map.csv'));
function books(file, preset = 'auto') {
  const t = F.readTable(rd(file), F.BOOKS_FIELDS);
  return T.applyPartyMap(F.mapBooksRows(t.rows, F.autoMap(t.headers, F.BOOKS_FIELDS, F.BOOKS_PRESETS[preset].map)), partyMap);
}
const run = (b, o = {}) => T.reconcileTds(stmt, b, { sectionTable: table, partyMap, deductee: { name: 'Demo', pan: 'ABCDE1234F' }, ...o });

test('26AS text: header, 12 deductors, Part I lines, empty parts, deductor totals equal line sums', () => {
  assert.equal(cur.kind, '26AS text');
  assert.equal(cur.header.pan, 'ABCDE1234F');
  assert.equal(cur.header.taxYear, '2026-27');
  assert.equal(cur.deductors.length, 12);
  assert.equal(cur.records.length, expected.counts.currentYearLines);
  assert.deepEqual(cur.parts.map((p) => p.id), ['I', 'II', 'VI', 'X']);
  assert.ok(cur.parts.filter((p) => p.id !== 'I').every((p) => p.empty));
  for (const d of cur.deductors) {
    const s = cur.records.filter((r) => r.tan === d.tan).reduce((a, r) => a + r.tds, 0);
    assert.ok(Math.abs(s - d.totalTds) < 0.01, d.tan);
  }
  assert.deepEqual(cur.warnings, []);
  assert.ok(cur.records.every((r) => F.TAN_RE.test(r.tan) && r.date && r.quarter.startsWith('2026-27')));
});

test('26AS text: CRLF prior-year file with FY/AY header parses the same way', () => {
  assert.match(rd('form26as_prev_sample.txt'), /\r\n/);
  assert.equal(prev.records.length, expected.counts.priorYearLines);
  assert.equal(prev.header.pan, 'ABCDE1234F');
  assert.ok(prev.header.fy.startsWith('2025'));
  assert.ok(prev.records.every((r) => r.fy === '2025-26' && r.section.startsWith('194')));
});

test('26AS text: warns on a summary that does not match its lines and on a missing Part I', () => {
  const broken = rd('form26as_sample.txt').replace('^51950.00^51950.00^', '^99999.00^99999.00^');
  assert.ok(F.parse26asText(broken).warnings.some((w) => /DEMO00001A/.test(w)));
  assert.ok(F.parse26asText('^Form 26AS^\n^PART-II^\n^No Transactions Present^\n').warnings.some((w) => /PART/.test(w)));
});

test('Form 168 CSV (title line above header) maps to the same records as the 26AS text', () => {
  const c = F.readStatement(rd('form168_sample.csv'), 'f168');
  assert.equal(c.kind, 'CSV (header-mapped)');
  assert.deepEqual(c.warnings, []);
  const strip = (r) => [r.id, r.tan, r.deductor, r.section, r.date, r.status, r.gross, r.tds, r.deposited];
  assert.deepEqual(c.records.map(strip), cur.records.map(strip));
});

test('helpers: PAN masking, quarters across the April boundary, TAN check, name similarity', () => {
  assert.equal(F.maskPan('ABCDE1234F'), 'ABCDE****F');
  assert.equal(F.quarterOf('2026-03-31'), '2025-26 Q4');
  assert.equal(F.quarterOf('2026-04-01'), '2026-27 Q1');
  assert.equal(F.quarterIndex('2026-04-01') - F.quarterIndex('2026-03-31'), 1);
  assert.ok(F.isTan('demo00001a') && !F.isTan('DEMO0001A'));
  assert.ok(T.nameSimilarity('Example Realty Pvt. Ltd.', 'EXAMPLE REALTY DEVELOPERS PVT LTD') >= 0.8);
  assert.equal(T.nameSimilarity('Imaginary Software Private Limited', 'IMAGINARY SOFTWARE PVT LTD'), 1);
  assert.ok(T.nameSimilarity('Sample Retail', 'Specimen Pharma') < 0.5);
});

test('section index: old and new labels, sub-items, payment codes; only 194C and 194J(b) confirmed', () => {
  const sx = T.buildSectionIndex(table);
  assert.equal(sx.lookup('194C').family, 'C');
  assert.equal(sx.lookup('393(1) Table Sl. No. 6(i)').family, 'C');
  assert.equal(sx.lookup('393(1) Sl. 6(iii).D(b)').id, '194J(b)');
  assert.equal(sx.lookup('194JB').id, '194J(b)');
  assert.equal(sx.lookup('1027').family, 'J');
  assert.equal(sx.lookup('393(1) Sl. 1(ii)').family, 'H');
  assert.deepEqual(table.entries.filter((e) => e.confirmed).map((e) => e.id).sort(), ['194C', '194J(b)']);
  assert.ok(table.version);
});

test('golden: every books row and statement line gets the expected status', () => {
  const out = run(books('books_generic.csv'));
  const gotB = {}, gotS = {};
  for (const r of out.results) { r.books.forEach((b) => (gotB[b.id] = r.status)); r.stmt.forEach((s) => (gotS[s.id] = r.status)); }
  assert.deepEqual(gotB, expected.books);
  assert.deepEqual(gotS, expected.statement);
});

test('golden: flags (not final, not deposited, rate, old code after 1 Apr 2026)', () => {
  const out = run(books('books_generic.csv'));
  const got = {};
  for (const r of out.results) for (const s of r.stmt) if (r.flags.length) got[s.id] = r.flags;
  for (const [id, fl] of Object.entries(expected.flags)) assert.deepEqual([...(got[id] || [])].sort(), [...fl].sort(), id);
  assert.equal(Object.keys(got).length, Object.keys(expected.flags).length, 'no unexpected flags');
});

test('golden: summary totals (credit at risk = missing + short + not final)', () => {
  const s = run(books('books_generic.csv')).summary, e = expected.totals;
  for (const k of ['booksTds', 'stmtTds', 'missingTds', 'shortTds', 'notFinalTds', 'unbookedTds', 'creditAtRisk']) assert.equal(s[k], e[k], k);
  assert.equal(s.creditAtRisk, Math.round((s.missingTds + s.shortTds + s.notFinalTds) * 100) / 100);
  assert.equal(s.counts['Duplicate in books'], 1);
});

test('Tally-style books (no TAN, gross or section) give the same credit at risk', () => {
  const b = books('books_tally_style.csv', 'tally');
  assert.equal(b.length, expected.counts.booksRows);
  assert.ok(b.every((x) => x.tanSource === 'map'));
  const s = run(b).summary;
  assert.equal(s.creditAtRisk, expected.totals.creditAtRisk);
  assert.equal(s.counts['Section mismatch'], 0, 'no books section, so no section check');
});

test('follow-ups: one per deductor, sorted by ₹ at risk, PAN masked, never a mailto or address', () => {
  const out = run(books('books_generic.csv'));
  const tans = out.deductors.map((d) => d.tan);
  assert.equal(new Set(tans).size, tans.length);
  assert.ok(out.deductors.every((d, i, a) => i === 0 || a[i - 1].atRisk >= d.atRisk));
  assert.equal(out.deductors[0].tan, 'DEMO00004D');
  assert.ok(tans.includes('DEMO00011K'), 'wrong-TAN note goes to our customer, not the TAN that reported it');
  for (const d of out.deductors) {
    assert.match(d.email, /ABCDE\*\*\*\*F/);
    assert.doesNotMatch(d.email, /ABCDE1234F|mailto:|@/);
  }
  assert.match(run(books('books_generic.csv'), { deductee: { name: 'Demo', pan: 'ABCDE1234F', maskPan: false } }).deductors[0].email, /ABCDE1234F/);
});

test('engine options: aggregation and cross-quarter can be switched off', () => {
  const noAgg = run(books('books_generic.csv'), { aggregate: false }).summary.counts;
  assert.equal(noAgg['Matched (aggregate)'], 0);
  assert.ok(noAgg['Missing in 26AS'] > 5);
  const noX = run(books('books_generic.csv'), { crossQuarter: false }).summary.counts;
  assert.equal(noX.Timing, 1, 'only the fuzzy 3-day pair remains');
});

test('the same statement loaded twice is counted once', () => {
  const once = run(books('books_generic.csv')).summary;
  const twice = T.reconcileTds([...stmt, ...cur.records], books('books_generic.csv'), { sectionTable: table, partyMap }).summary;
  assert.equal(twice.repeatedStatementLines, cur.records.length);
  assert.equal(twice.creditAtRisk, once.creditAtRisk);
  assert.deepEqual(twice.counts, once.counts);
});

test('export rows never include the PAN; party map CSV round-trips', () => {
  const rows = T.resultsToRowsTds(run(books('books_generic.csv')).results);
  assert.ok(rows.length > 40);
  assert.doesNotMatch(JSON.stringify(rows), /ABCDE1234F/);
  assert.equal(Object.keys(partyMap).length, 11);
  assert.equal(partyMap['Example Realty Pvt. Ltd.'], 'DEMO00011K');
});
