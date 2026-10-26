// Statement and books readers for the TDS credit check (pure, testable, no network).
// - parse26asText: the ^-delimited Form 26AS text file (Part I only), and the same layout if Form 168 keeps it.
// - Header-driven CSV mapping for Form 168 (layout unpublished) and for books exports (Tally/Zoho/Busy/Excel).
import { parseDate } from './recon.js';
import { round2, toNum } from './gst.js';

export const TAN_RE = /^[A-Z]{4}[0-9]{5}[A-Z]$/;
export const normalizeTan = (s) => String(s ?? '').toUpperCase().replace(/[^0-9A-Z]/g, '');
export const isTan = (s) => TAN_RE.test(normalizeTan(s));
/** ABCDE1234F -> ABCDE****F (never show a full PAN). */
export function maskPan(p) {
  const s = String(p ?? '').toUpperCase().trim();
  return s.length === 10 ? `${s.slice(0, 5)}****${s.slice(9)}` : s ? '**********' : '';
}

/** Indian financial / tax year of a YYYY-MM-DD date: '2026-27'. */
export function fyOf(iso) {
  if (!iso) return '';
  const y = Number(iso.slice(0, 4)), m = Number(iso.slice(5, 7));
  const s = m >= 4 ? y : y - 1;
  return `${s}-${String((s + 1) % 100).padStart(2, '0')}`;
}
/** Quarter number 1-4 (Apr-Jun = Q1 ... Jan-Mar = Q4). */
export function qOf(iso) { if (!iso) return 0; const m = Number(iso.slice(5, 7)); return m >= 4 ? Math.floor((m - 4) / 3) + 1 : 4; }
export const quarterOf = (iso) => (iso ? `${fyOf(iso)} Q${qOf(iso)}` : '');
/** Sortable quarter index, so adjacent quarters differ by 1 across a year boundary. */
export const quarterIndex = (iso) => (iso ? Number(fyOf(iso).slice(0, 4)) * 4 + qOf(iso) - 1 : NaN);

/** Decode file bytes: UTF-8 first, falling back to windows-1252 if UTF-8 produced replacement characters. */
export function decodeBytes(buf) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const utf = new TextDecoder('utf-8').decode(u8);
  if (!utf.includes('\uFFFD')) return utf;
  try { return new TextDecoder('windows-1252').decode(u8); } catch { return utf; }
}

const PART_RE = /^\^?PART[- ]?([A-Z0-9]+)\b/i;
const isPartOne = (id) => /^(A|I)$/i.test(id);
const num = (v) => { const n = toNum(v); return Number.isFinite(n) ? round2(n) : 0; };

/** Is this text a ^-delimited 26AS-style statement? */
export const looksLike26asText = (text) => /\^/.test(text) && /^\^?PART[- ]?(A|I)\b/im.test(text);

/**
 * Parse ^-delimited Form 26AS text. Returns { header, deductors[], records[], parts[], warnings[] }.
 * Rules (spec §5.1): split lines, find PART markers, in Part I a line starting with a digit is a deductor
 * summary (TAN in column 3) and a line starting with ^ + digit is a transaction for the current deductor.
 */
export function parse26asText(text, fileName = 'statement.txt') {
  const lines = String(text).replace(/^\uFEFF/, '').split(/\r?\n/);
  const header = { pan: '', name: '', fy: '', ay: '', taxYear: '', fileDate: '', panStatus: '' };
  const deductors = [], records = [], parts = [], warnings = [];
  let part = null, ded = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const pm = line.match(PART_RE);
    if (pm) { part = { id: pm[1].toUpperCase(), title: line.replace(/\^/g, ' ').trim(), empty: false, lines: 0 }; parts.push(part); ded = null; continue; }
    if (!part) {
      // Person header: a row of column names followed by one row of values.
      if (/Permanent Account Number/i.test(line) && lines[i + 1]) {
        const h = line.split('^').map((s) => s.trim().toLowerCase()), v = lines[i + 1].split('^').map((s) => s.trim());
        const get = (re) => { const k = h.findIndex((x) => re.test(x)); return k >= 0 ? v[k] ?? '' : ''; };
        Object.assign(header, {
          fileDate: get(/file creation/), pan: get(/permanent account number|^pan$/).toUpperCase(), panStatus: get(/status of pan/),
          fy: get(/financial year/), ay: get(/assessment year/), taxYear: get(/tax year/), name: get(/name of assessee|name of taxpayer|^name$/),
        });
        i++;
      }
      continue;
    }
    if (/No Transactions Present/i.test(line)) { part.empty = true; continue; }
    if (!isPartOne(part.id)) continue;           // MVP: Part I (TDS) only
    if (/Sr\.?\s*No/i.test(line)) continue;       // repeated header rows
    const f = line.split('^');
    if (/^\d/.test(line)) {
      const tan = normalizeTan(f[2]);
      ded = { sr: Number(f[0]), name: (f[1] || '').trim(), tan, totalPaid: num(f[7]), totalTds: num(f[8]), totalDeposited: num(f[9]), txCount: 0 };
      if (!isTan(tan)) warnings.push(`Line ${i + 1}: deductor "${ded.name}" has an unreadable TAN "${f[2] ?? ''}".`);
      deductors.push(ded);
      part.lines++;
    } else if (/^\^\d/.test(line)) {
      if (!ded) { warnings.push(`Line ${i + 1}: transaction before any deductor row, skipped.`); continue; }
      const date = parseDate(f[3]);
      if (!date) warnings.push(`Line ${i + 1}: unreadable transaction date "${f[3] ?? ''}".`);
      ded.txCount++;
      part.lines++;
      records.push({
        id: `${fyOf(date) || '?'}/${ded.tan}#${f[1]}`, src: fileName, tan: ded.tan, deductor: ded.name, srNo: Number(f[1]),
        section: (f[2] || '').trim(), date, rawDate: (f[3] || '').trim(), quarter: quarterOf(date), fy: fyOf(date),
        status: (f[4] || '').trim().toUpperCase(), bookingDate: parseDate(f[5]) || (f[5] || '').trim(), remarks: (f[6] || '').trim(),
        gross: num(f[7]), tds: num(f[8]), deposited: num(f[9]),
      });
    }
  }
  if (!parts.some((p) => isPartOne(p.id))) warnings.push('No "PART A" / "PART-I" section found. Is this a Form 26AS text file?');
  for (const d of deductors) {
    const tx = records.filter((r) => r.tan === d.tan);
    const s = round2(tx.reduce((a, r) => a + r.tds, 0));
    if (tx.length && Math.abs(s - d.totalTds) > 0.5) warnings.push(`${d.name} (${d.tan}): summary TDS ${d.totalTds} differs from the sum of its lines ${s}.`);
  }
  return { kind: '26AS text', header, deductors, records, parts, warnings };
}

// ---------- header-driven column mapping (books exports and Form 168 CSV/Excel-as-CSV) ----------
const key = (h) => String(h ?? '').toLowerCase().replace(/[_]+/g, ' ').replace(/\(rs\.?\)|\(₹\)|\(inr\)/g, '').replace(/[^a-z0-9/. ]+/g, ' ').replace(/\s+/g, ' ').trim();

/** Statement (Form 168 / 26AS Excel saved as CSV) aliases. ASSUMPTION: Form 168 column names are unpublished. */
export const STMT_FIELDS = {
  tan: { label: 'TAN of deductor', req: true, aliases: ['tan of deductor', 'tan of deductor/collector', 'deductor tan', 'tan'] },
  deductor: { label: 'Name of deductor', req: false, aliases: ['name of deductor', 'deductor name', 'name of deductor/collector', 'deductor'] },
  section: { label: 'Section / Table Sl. No.', req: false, aliases: ['section', 'section/table sl. no.', 'section / table sl. no.', 'table sl. no.', 'nature of payment', 'section code'] },
  paymentCode: { label: 'Payment code (optional)', req: false, aliases: ['payment code', 'payment code (if any)'] },
  date: { label: 'Transaction date', req: true, aliases: ['transaction date', 'date of payment/credit', 'date of credit', 'date'] },
  status: { label: 'Status of booking', req: false, aliases: ['status of booking', 'booking status', 'status'] },
  bookingDate: { label: 'Date of booking', req: false, aliases: ['date of booking', 'booking date'] },
  gross: { label: 'Amount paid / credited', req: false, aliases: ['amount paid / credited', 'amount paid/credited', 'amount paid', 'amount credited', 'amount'] },
  tds: { label: 'Tax deducted', req: true, aliases: ['tax deducted', 'tds deducted', 'tds amount', 'tds'] },
  deposited: { label: 'TDS deposited', req: false, aliases: ['tds deposited', 'tax deposited', 'amount deposited'] },
  srNo: { label: 'Sr. No.', req: false, aliases: ['sr. no.', 'sr no', 'sl. no.', 'serial no'] },
};
/** Books export aliases. Tally/Zoho/Busy header names are NOT verified (see README assumptions). */
export const BOOKS_FIELDS = {
  date: { label: 'Date', req: true, aliases: ['date', 'invoice date', 'voucher date', 'bill date', 'txn date', 'transaction date'] },
  party: { label: 'Party (customer)', req: true, aliases: ['party', 'party name', 'customer', 'customer name', 'particulars', 'account', 'ledger', 'name'] },
  tan: { label: 'TAN (optional)', req: false, aliases: ['tan', 'customer tan', 'tan of deductor', 'party tan'] },
  ref: { label: 'Invoice ref', req: false, aliases: ['invoice no', 'invoice number', 'invoice ref', 'bill no', 'vch no.', 'vch no', 'voucher no', 'reference', 'ref', 'invoice#'] },
  gross: { label: 'Gross amount', req: false, aliases: ['gross amount', 'gross', 'invoice amount', 'amount before tds', 'taxable value', 'sub total', 'bill amount'] },
  tds: { label: 'TDS amount', req: true, aliases: ['tds amount', 'tds', 'tds receivable', 'tds deducted', 'debit', 'withholding tax', 'tax withheld'] },
  section: { label: 'Section (optional)', req: false, aliases: ['section', 'tds section', 'nature of payment', 'section code'] },
};
/**
 * Books presets. Every header here is an ASSUMPTION until checked against a real export from that product.
 * A preset only sets the preferred header for each field; anything not found falls back to the aliases.
 */
export const BOOKS_PRESETS = {
  auto: { label: 'Auto-detect (generic Excel)', map: {} },
  tally: { label: 'Tally ledger vouchers (unverified)', map: { date: 'Date', party: 'Particulars', ref: 'Vch No.', tds: 'Debit' } },
  zoho: { label: 'Zoho Books (unverified)', map: { date: 'Date', party: 'Customer Name', ref: 'Invoice#', gross: 'Sub Total', tds: 'TDS Amount', section: 'TDS Section' } },
  busy: { label: 'Busy (unverified)', map: { date: 'Date', party: 'Account', ref: 'Vch/Bill No', gross: 'Bill Amount', tds: 'TDS Amount', section: 'Nature of Payment' } },
};

/** Index of the header row: the first row in which at least `min` cells match a known alias. */
export function findHeaderRow(rows, fields, min = 3) {
  const all = new Set(Object.values(fields).flatMap((f) => f.aliases));
  for (let i = 0; i < Math.min(rows.length, 30); i++) if (rows[i].filter((c) => all.has(key(c))).length >= min) return i;
  return 0;
}
/** CSV text -> array of raw rows (arrays). RFC-4180 quoting, like csv.js parseCsv, but keeps every line positional so a header row below a title line can be found. */
export function csvRows(text) {
  const rows = []; let row = [], field = '', q = false; const s = String(text).replace(/^\uFEFF/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === '"') { if (s[i + 1] === '"') { field += '"'; i++; } else q = false; } else field += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(field.trim()); field = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && s[i + 1] === '\n') i++; row.push(field.trim()); field = ''; if (row.some((f) => f !== '')) rows.push(row); row = []; }
    else field += c;
  }
  row.push(field.trim()); if (row.some((f) => f !== '')) rows.push(row);
  return rows;
}
/** Split a CSV into { headers, rows:[{}], headerRow } using the detected header row. */
export function readTable(text, fields, min = 3) {
  const raw = csvRows(text);
  const h = findHeaderRow(raw, fields, min);
  const headers = (raw[h] || []).map((x) => x.trim());
  const rows = raw.slice(h + 1).map((r) => Object.fromEntries(headers.map((k, i) => [k, r[i] ?? ''])));
  return { headers, rows, headerRow: h, skipped: h };
}
/** Suggest a {field: header} map from aliases, honouring a preset's preferred headers first. */
export function autoMap(headers, fields, preset = {}) {
  const out = {}, used = new Set();
  for (const [f, def] of Object.entries(fields)) {
    let h = preset[f] && headers.find((x) => key(x) === key(preset[f]));
    if (!h) for (const a of def.aliases) { h = headers.find((x) => !used.has(x) && key(x) === a); if (h) break; }
    if (h) { out[f] = h; used.add(h); }
  }
  return out;
}
export function missingRequired(map, fields) { return Object.entries(fields).filter(([f, d]) => d.req && !map[f]).map(([, d]) => d.label); }

/** Map statement CSV rows (Form 168 / Excel) to statement records. Sr. No. counts per deductor if absent. */
export function mapStatementRows(rows, map, fileName = 'statement.csv') {
  const counters = new Map();
  return rows.map((r) => {
    const tan = normalizeTan(r[map.tan]);
    const n = (counters.get(tan) || 0) + 1; counters.set(tan, n);
    const sr = map.srNo && r[map.srNo] ? Number(r[map.srNo]) || n : n;
    const date = parseDate(r[map.date]);
    const section = (map.section && r[map.section]) || (map.paymentCode && r[map.paymentCode]) || '';
    return {
      id: `${fyOf(date) || '?'}/${tan}#${sr}`, src: fileName, tan, deductor: map.deductor ? r[map.deductor] : '', srNo: sr, section: String(section).trim(),
      paymentCode: map.paymentCode ? r[map.paymentCode] : '', date, rawDate: r[map.date] ?? '', quarter: quarterOf(date), fy: fyOf(date),
      status: String((map.status && r[map.status]) || 'F').trim().toUpperCase(), bookingDate: map.bookingDate ? parseDate(r[map.bookingDate]) : '',
      remarks: '', gross: map.gross ? num(r[map.gross]) : 0, tds: num(r[map.tds]), deposited: map.deposited ? num(r[map.deposited]) : num(r[map.tds]),
    };
  }).filter((x) => x.tan || x.tds);
}
/** Build deductor summaries from statement records (CSV statements have no summary rows). */
export function deductorsFromRecords(records) {
  const m = new Map();
  for (const r of records) {
    const d = m.get(r.tan) || { sr: m.size + 1, name: r.deductor, tan: r.tan, totalPaid: 0, totalTds: 0, totalDeposited: 0, txCount: 0 };
    d.totalPaid = round2(d.totalPaid + r.gross); d.totalTds = round2(d.totalTds + r.tds); d.totalDeposited = round2(d.totalDeposited + r.deposited); d.txCount++;
    if (!d.name && r.deductor) d.name = r.deductor;
    m.set(r.tan, d);
  }
  return [...m.values()];
}
/** Map books rows to books records. `tds` may be derived as invoice minus received if the caller asks for it. */
export function mapBooksRows(rows, map) {
  return rows.map((r, i) => {
    const date = parseDate(r[map.date]);
    return {
      id: `R${i + 1}`, row: i + 1, date, rawDate: r[map.date] ?? '', party: String(r[map.party] ?? '').trim(),
      tan: map.tan ? normalizeTan(r[map.tan]) : '', tanSource: map.tan && r[map.tan] ? 'books' : '',
      ref: map.ref ? String(r[map.ref] ?? '').trim() : '', gross: map.gross ? num(r[map.gross]) : 0, tds: num(r[map.tds]),
      section: map.section ? String(r[map.section] ?? '').trim() : '', quarter: quarterOf(date), fy: fyOf(date),
    };
  }).filter((b) => b.party || b.tds);
}

/** Read any statement file: ^ text -> parse26asText, otherwise CSV with header-driven mapping. */
export function readStatement(text, fileName, mapOverride) {
  if (looksLike26asText(text)) return parse26asText(text, fileName);
  const t = readTable(text, STMT_FIELDS);
  const map = mapOverride || autoMap(t.headers, STMT_FIELDS);
  const miss = missingRequired(map, STMT_FIELDS);
  const records = miss.length ? [] : mapStatementRows(t.rows, map, fileName);
  return {
    kind: 'CSV (header-mapped)', header: { pan: '', name: '', fy: '', ay: '', taxYear: '' }, deductors: deductorsFromRecords(records), records, parts: [],
    warnings: miss.length ? [`Map these statement columns: ${miss.join(', ')}.`] : [], table: t, map,
  };
}

/** Optional AIS TDS CSV (exported from the AIS Utility). Header names are not published: alias-mapped. */
export const AIS_FIELDS = {
  source: { label: 'Information source', req: true, aliases: ['information source', 'source', 'reported by'] },
  date: { label: 'Transaction date', req: true, aliases: ['transaction date', 'date'] },
  amount: { label: 'Amount', req: true, aliases: ['amount', 'amount paid/credited', 'reported value'] },
  code: { label: 'Information code', req: false, aliases: ['information code', 'info code'] },
};
export function readAis(text) {
  const t = readTable(text, AIS_FIELDS, 2);
  const map = autoMap(t.headers, AIS_FIELDS);
  if (missingRequired(map, AIS_FIELDS).length) return [];
  return t.rows.map((r) => {
    const m = String(r[map.source] ?? '').toUpperCase().match(/[A-Z]{4}[0-9]{5}[A-Z]/);
    return { tan: m ? m[0] : '', source: r[map.source], date: parseDate(r[map.date]), amount: num(r[map.amount]), code: map.code ? r[map.code] : '' };
  });
}
/** Optional party <-> TAN map CSV: Party,TAN */
export function readPartyMap(text) {
  const t = readTable(text, { party: { aliases: ['party', 'party name', 'books party'] }, tan: { aliases: ['tan', 'tan of deductor'] } }, 2);
  const ph = t.headers.find((h) => /party/i.test(h)) || t.headers[0], th = t.headers.find((h) => /tan/i.test(h)) || t.headers[1];
  return Object.fromEntries(t.rows.filter((r) => r[ph] && isTan(r[th])).map((r) => [r[ph].trim(), normalizeTan(r[th])]));
}
