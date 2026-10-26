// Generates the SYNTHETIC samples for tds.html into samples/tds/. Deterministic (seeded), so tests are stable.
// Every TAN starts with DEMO and every name is fictional. Deductee PAN ABCDE1234F is the generic example format.
// Run: node scripts/make-tds-samples.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { toCsv } from '../js/csv.js';

const OUT = new URL('../samples/tds/', import.meta.url);
mkdirSync(OUT, { recursive: true });
let seed = 2026;
const rnd = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pick = (a, b) => a + Math.floor(rnd() * (b - a + 1));

const ME = { pan: 'ABCDE1234F', name: 'DEMO DESIGN STUDIO LLP' };
// key: [TAN, statement name, books party name, family, books carries TAN?]
const D = {
  d01: ['DEMO00001A', 'SAMPLE RETAIL PVT LTD', 'Sample Retail Pvt Ltd', 'J', true],
  d02: ['DEMO00002B', 'EXAMPLE HOSPITALS LLP', 'Example Hospitals LLP', 'J', true],
  d03: ['DEMO00003C', 'DEMO INFRA PROJECTS LIMITED', 'Demo Infra Projects Ltd', 'C', true],
  d04: ['DEMO00004D', 'PLACEHOLDER MEDIA PVT LTD', 'Placeholder Media Private Limited', 'J', true],
  d05: ['DEMO00005E', 'FICTIONAL FOODS LTD', 'Fictional Foods Ltd.', 'J', true],
  d06: ['DEMO00006F', 'MOCK LOGISTICS LLP', 'Mock Logistics LLP', 'C', true],
  d07: ['DEMO00007G', 'TEST EDUCATION TRUST', 'Test Education Trust', 'J', false],
  d08: ['DEMO00008H', 'IMAGINARY SOFTWARE PVT LTD', 'Imaginary Software Private Limited', 'J', false],
  d09: ['DEMO00009I', 'SPECIMEN PHARMA LTD', 'Specimen Pharma Ltd', 'J', false],
  d10: ['DEMO00010J', 'SAMPLE CIVIC AUTHORITY', 'Sample Civic Authority', 'J', false],
  d11: ['DEMO00011K', 'EXAMPLE REALTY PVT LTD', 'Example Realty Pvt. Ltd.', 'C', false],
  d12: ['DEMO00012L', 'EXAMPLE REALTY DEVELOPERS PVT LTD', '', 'C', false],
};
const RATE = { J: 10, C: 2 };
const OLD = { J: '194JB', C: '194C' };                       // as shown in a 2025-26 Form 26AS
const BOOKS_OLD = { J: '194J(b)', C: '194C' };               // ledger habit
const NEW = { J: '393(1) Sl. 6(iii).D(b)', C: '393(1) Sl. 6(i)' }; // Tax Year 2026-27 statement
const BOOKS_NEW = { J: '393(1) Table Sl. No. 6(iii).D(b)', C: '393(1) Table Sl. No. 6(i)' };

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const iso = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const ddmmyyyy = (s) => `${s.slice(8, 10)}-${s.slice(5, 7)}-${s.slice(0, 4)}`;
const ddMonyyyy = (s) => `${s.slice(8, 10)}-${MON[+s.slice(5, 7) - 1]}-${s.slice(0, 4)}`;
const tallyDate = (s) => `${+s.slice(8, 10)}-${MON[+s.slice(5, 7) - 1]}-${s.slice(2, 4)}`;
const addDays = (s, n) => new Date(Date.parse(s) + n * 864e5).toISOString().slice(0, 10);
const qtr = (s) => { const m = +s.slice(5, 7); return m >= 4 ? Math.floor((m - 4) / 3) + 1 : 4; };
const sameQ = (a, b) => a.slice(0, 4) === b.slice(0, 4) && qtr(a) === qtr(b);
const grossFor = (fam) => (fam === 'J' ? pick(5, 60) * 2500 : pick(20, 150) * 2500);

const books = [], stmtCur = [], stmtPrev = [];
const used = new Set();
let inv = 100;
function book(k, date, gross, o = {}) {
  const [tan, , party, fam, hasTan] = D[k];
  const tds = o.tds ?? Math.round(gross * RATE[fam]) / 100;
  const sec = o.section ?? (date < '2026-07-01' ? BOOKS_OLD[fam] : BOOKS_NEW[fam]);
  const row = { k, date, party: o.party ?? party, tan: hasTan ? tan : '', ref: o.ref ?? `DDS/${date < '2026-04-01' ? '25-26' : '26-27'}/${String(inv++).padStart(4, '0')}`, gross, tds, section: sec, expect: o.expect };
  books.push(row); return row;
}
function line(k, file, date, gross, tds, o = {}) {
  const [, , , fam] = D[k];
  const sec = o.section ?? (file === stmtPrev ? OLD[fam] : NEW[fam]);
  const r = { k, date, gross, tds, deposited: o.deposited ?? tds, status: o.status ?? 'F', section: sec, expect: o.expect, flags: o.flags || [] };
  file.push(r); return r;
}
/** a books row + identical statement line (credit date 0-5 days later, same quarter) */
function exact(k, date, o = {}) {
  let gross, tds, guard = 0;
  do { gross = grossFor(D[k][3]); tds = Math.round(gross * RATE[D[k][3]]) / 100; } while (used.has(`${k}|${tds}`) && ++guard < 50);
  used.add(`${k}|${tds}`);
  const b = book(k, date, gross, { expect: o.expect ?? 'Matched' });
  let sd = addDays(date, pick(0, 5)); if (!sameQ(sd, date)) sd = date;
  line(k, date < '2026-04-01' ? stmtPrev : stmtCur, sd, gross, tds, { status: o.status, deposited: o.deposited, expect: o.expect ?? 'Matched', flags: o.flags });
  return b;
}
const pd = (k, d) => exact(k, d); // shorthand

// --- FY 2025-26 Q4 (prior-year Form 26AS, old 194-series codes) : 8 exact
pd('d01', '2026-01-12'); pd('d01', '2026-02-18'); pd('d02', '2026-01-22'); pd('d03', '2026-02-05');
pd('d05', '2026-03-02'); pd('d06', '2026-02-24'); pd('d08', '2026-03-10'); pd('d09', '2026-01-28');
// --- Tax Year 2026-27 exact matches (books 194 codes in Q1, 393 labels in Q2; statement 393 labels): 26
const dupSource = pd('d01', '2026-04-14'); pd('d01', '2026-05-20'); pd('d01', '2026-07-08'); pd('d01', '2026-08-25'); pd('d01', '2026-09-15');
pd('d02', '2026-04-09'); pd('d02', '2026-06-17');
pd('d03', '2026-04-27'); pd('d03', '2026-07-21'); pd('d03', '2026-09-02');
pd('d04', '2026-04-16'); pd('d04', '2026-06-04');
pd('d05', '2026-05-07'); pd('d05', '2026-07-30'); pd('d05', '2026-08-19');
pd('d06', '2026-07-13'); pd('d06', '2026-09-09');
pd('d07', '2026-05-12'); pd('d07', '2026-08-11');
pd('d08', '2026-04-22'); pd('d08', '2026-08-04');
pd('d09', '2026-06-10'); pd('d09', '2026-07-16');
pd('d10', '2026-05-26');
pd('d11', '2026-04-29'); pd('d11', '2026-06-23');
// --- Booking status U (2) and P (1): matched lines whose credit is not final
exact('d05', '2026-06-15', { status: 'U', expect: 'Not final (U/P/O)', flags: ['not_final'] });
exact('d03', '2026-08-12', { status: 'U', deposited: 0, expect: 'Not final (U/P/O)', flags: ['not_final', 'not_deposited'] });
exact('d10', '2026-08-28', { status: 'P', expect: 'Not final (U/P/O)', flags: ['not_final'] });
// --- Rate anomaly: 2% deducted on a professional fee expected at 10% (exact match, flagged)
book('d01', '2026-06-26', 85000, { tds: 1700, expect: 'Matched' }); line('d01', stmtCur, '2026-06-29', 85000, 1700, { expect: 'Matched', flags: ['rate'] });
// --- Monthly consolidation (aggregate): 3 deductors
function monthly(k, y, m, days) {
  const rows = days.map((d) => book(k, iso(y, m, d), grossFor(D[k][3]), { expect: 'Matched (aggregate)' }));
  const last = iso(y, m, new Date(Date.UTC(y, m, 0)).getUTCDate());
  line(k, stmtCur, last, rows.reduce((a, r) => a + r.gross, 0), Math.round(rows.reduce((a, r) => a + r.tds, 0) * 100) / 100, { expect: 'Matched (aggregate)' });
}
monthly('d02', 2026, 7, [3, 14, 27]); monthly('d02', 2026, 8, [5, 12, 19, 26]);
monthly('d06', 2026, 5, [6, 15, 28]); monthly('d06', 2026, 6, [2, 16, 25]);
monthly('d08', 2026, 9, [3, 10, 17, 24]);
// --- Short reported (2): statement TDS = books - 2,000 (gross reported lower too, so no rate flag)
book('d03', '2026-05-19', 300000, { expect: 'Short in 26AS' }); line('d03', stmtCur, '2026-05-21', 200000, 4000, { expect: 'Short in 26AS' });
book('d09', '2026-08-21', 175000, { expect: 'Short in 26AS' }); line('d09', stmtCur, '2026-08-24', 155000, 15500, { expect: 'Short in 26AS' });
// --- Missing, not filed: whole Q2 absent for one deductor (4 invoices)
for (const d of ['2026-07-06', '2026-07-28', '2026-08-17', '2026-09-22']) book('d04', d, grossFor('J'), { expect: 'Missing in 26AS' });
// --- Wrong PAN by deductor: one Q2 line absent though the deductor filed Q2
book('d05', '2026-09-11', 137500, { expect: 'Missing in 26AS' });
// --- Wrong TAN / sister entity: books under DEMO00011K, statement under DEMO00012L
book('d11', '2026-08-14', 240000, { expect: 'Possible wrong TAN' }); line('d12', stmtCur, '2026-08-14', 240000, 4800, { expect: 'Possible wrong TAN' });
// --- Timing (2): late-March invoice, statement line in Tax Year 2026-27 under the OLD code 194J
book('d07', '2026-03-30', 60000, { expect: 'Timing' }); line('d07', stmtCur, '2026-04-02', 60000, 6000, { section: '194J', expect: 'Timing', flags: ['old_code'] });
book('d07', '2026-03-28', 45000, { expect: 'Timing' }); line('d07', stmtCur, '2026-04-21', 45000, 4500, { section: '194J', expect: 'Timing', flags: ['old_code'] });
// --- Section mismatch: professional fee reported as commission
book('d08', '2026-06-12', 95000, { expect: 'Section mismatch' }); line('d08', stmtCur, '2026-06-12', 95000, 9500, { section: '393(1) Sl. 1(ii)', expect: 'Section mismatch' });
// --- Only in statement (2): unbooked receipts
line('d01', stmtCur, '2026-09-18', 42500, 4250, { expect: 'Only in 26AS' });
line('d09', stmtCur, '2026-05-14', 62500, 6250, { expect: 'Only in 26AS' });
// --- Books duplicate: the same invoice keyed twice
books.push({ ...dupSource, expect: 'Duplicate in books' });

// ---------- sort and number ----------
books.sort((a, b) => a.date.localeCompare(b.date) || a.ref.localeCompare(b.ref) || (a.expect === 'Duplicate in books') - (b.expect === 'Duplicate in books'));
books.forEach((b, i) => { b.id = `R${i + 1}`; });
function number(file) {
  const out = [];
  for (const k of Object.keys(D)) {
    const ls = file.filter((l) => l.k === k).sort((a, b) => a.date.localeCompare(b.date));
    ls.forEach((l, i) => { l.sr = i + 1; l.id = `${l.date < '2026-04-01' ? '2025-26' : '2026-27'}/${D[k][0]}#${i + 1}`; });
    if (ls.length) out.push([k, ls]);
  }
  return out;
}
const curGroups = number(stmtCur), prevGroups = number(stmtPrev);
const bookingDate = (l) => (l.status === 'U' ? '-' : ddMonyyyy(addDays(l.date, 50)));

function text26as(groups, head, crlf) {
  const L = ['^Form 26AS^', ...head, '^PART-I - Details of Tax Deducted at Source^',
    'Sr. No.^Name of Deductor^TAN of Deductor^^^^^Total Amount Paid / Credited(Rs.)^Total Tax Deducted(Rs.)^Total TDS Deposited(Rs.)'];
  groups.forEach(([k, ls], i) => {
    const t = (f) => ls.reduce((a, l) => a + l[f], 0).toFixed(2);
    L.push(`${i + 1}^${D[k][1]}^${D[k][0]}^^^^^${t('gross')}^${t('tds')}^${t('deposited')}^`);
    L.push('^Sr. No.^Section^Transaction Date^Status of Booking^Date of Booking^Remarks^Amount Paid / Credited(Rs.)^Tax Deducted(Rs.)^TDS Deposited(Rs.)');
    for (const l of ls) L.push(`^${l.sr}^${l.section}^${ddMonyyyy(l.date)}^${l.status}^${bookingDate(l)}^-^${l.gross.toFixed(2)}^${l.tds.toFixed(2)}^${l.deposited.toFixed(2)}^`);
  });
  L.push('^PART-II - Details of Tax Deducted at Source for 15G / 15H^', '^No Transactions Present^',
    '^PART-VI - Details of Tax Collected at Source^', '^No Transactions Present^',
    '^PART-X - TDS / TCS Defaults* (Processing of Statements)^', '^No Transactions Present^');
  return L.join(crlf ? '\r\n' : '\n') + (crlf ? '\r\n' : '\n');
}
const ADDR = 'DEMO ADDRESS LINE 1^SAMPLE AREA^^^^27^400001';
writeFileSync(new URL('form26as_sample.txt', OUT), text26as(curGroups, [
  'File Creation Date^Permanent Account Number (PAN)^Current Status of PAN^Tax Year^Name of Assessee^Address Line 1^Address Line 2^Address Line 3^Address Line 4^Address Line 5^Statecode^Pin Code',
  `26-10-2026^${ME.pan}^Active^2026-27^${ME.name}^${ADDR}`], false));
writeFileSync(new URL('form26as_prev_sample.txt', OUT), text26as(prevGroups, [
  'File Creation Date^Permanent Account Number (PAN)^Current Status of PAN^Financial Year^Assessment Year^Name of Assessee^Address Line 1^Address Line 2^Address Line 3^Address Line 4^Address Line 5^Statecode^Pin Code',
  `26-10-2026^${ME.pan}^Active^2025-2026^2026-2027^${ME.name}^${ADDR}`], true));

// Form 168 as CSV: HYPOTHETICAL flat layout (real column layout unpublished)
const f168 = curGroups.flatMap(([k, ls]) => ls.map((l) => ({
  'TAN of Deductor': D[k][0], 'Name of Deductor': D[k][1], 'Sr. No.': l.sr, 'Section/Table Sl. No.': l.section, 'Payment Code': '',
  'Transaction Date': ddMonyyyy(l.date), 'Status of Booking': l.status, 'Date of Booking': bookingDate(l),
  'Amount Paid / Credited (Rs.)': l.gross.toFixed(2), 'Tax Deducted (Rs.)': l.tds.toFixed(2), 'TDS Deposited (Rs.)': l.deposited.toFixed(2),
})));
writeFileSync(new URL('form168_sample.csv', OUT), '\uFEFFILLUSTRATIVE ONLY: real Form 168 column layout is unverified. Synthetic DEMO data for Tax Year 2026-27.\r\n' + toCsv(f168).replace(/^\uFEFF/, ''));

// Books: generic Excel-style and Tally-style (headers unverified)
writeFileSync(new URL('books_generic.csv', OUT), toCsv(books.map((b) => ({
  Date: ddmmyyyy(b.date), Party: b.party, TAN: b.tan, 'Invoice No': b.ref, 'Gross Amount': b.gross.toFixed(2), 'TDS Amount': b.tds.toFixed(2), Section: b.section,
}))));
writeFileSync(new URL('books_tally_style.csv', OUT), toCsv([
  ...books.map((b) => ({ Date: tallyDate(b.date), Particulars: b.party, 'Vch Type': 'Journal', 'Vch No.': b.ref, Debit: b.tds.toFixed(2), Credit: '' })),
]));
// Party <-> TAN map (what a saved run looks like)
writeFileSync(new URL('party_tan_map.csv', OUT), toCsv(Object.values(D).filter((d) => d[2]).map((d) => ({ Party: d[2], TAN: d[0] }))));
// AIS TDS CSV (header names illustrative): every current-year line except the two Only-in-26AS receipts
writeFileSync(new URL('ais_tds_sample.csv', OUT), toCsv(curGroups.flatMap(([k, ls]) => ls.filter((l) => l.expect !== 'Only in 26AS').map((l) => ({
  'Information Code': 'TDS-393', 'Information Description': 'TDS (illustrative code)', 'Information Source': `${D[k][1]} (${D[k][0]})`,
  'Transaction Date': ddmmyyyy(l.date), Amount: l.gross.toFixed(2), Status: 'Active',
})))));

// Golden expectations, written from the scenario table (independent of the engine)
const allStmt = [...curGroups, ...prevGroups].flatMap(([, ls]) => ls);
const r2 = (n) => Math.round(n * 100) / 100;
const bt = (st) => r2(books.filter((b) => b.expect === st).reduce((a, b) => a + b.tds, 0));
const expected = {
  _note: 'Golden results for samples/tds (generic books + both statement files + party map). Generated by scripts/make-tds-samples.mjs from the scenario table, not from the engine.',
  books: Object.fromEntries(books.map((b) => [b.id, b.expect])),
  statement: Object.fromEntries(allStmt.map((l) => [l.id, l.expect])),
  flags: Object.fromEntries(allStmt.filter((l) => l.flags.length).map((l) => [l.id, l.flags])),
  counts: { booksRows: books.length, statementRows: allStmt.length, currentYearLines: stmtCur.length, priorYearLines: stmtPrev.length, deductorsInCurrentFile: curGroups.length },
  totals: {
    booksTds: r2(books.filter((b) => b.expect !== 'Duplicate in books').reduce((a, b) => a + b.tds, 0)),
    stmtTds: r2(allStmt.reduce((a, l) => a + l.tds, 0)),
    missingTds: bt('Missing in 26AS'),
    shortTds: 4000,
    notFinalTds: r2(allStmt.filter((l) => l.status !== 'F').reduce((a, l) => a + l.tds, 0)),
    unbookedTds: r2(allStmt.filter((l) => l.expect === 'Only in 26AS').reduce((a, l) => a + l.tds, 0)),
  },
};
expected.totals.creditAtRisk = r2(expected.totals.missingTds + expected.totals.shortTds + expected.totals.notFinalTds);
writeFileSync(new URL('expected_results.json', OUT), JSON.stringify(expected, null, 2) + '\n');
console.log(expected.counts, expected.totals);
