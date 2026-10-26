// GSTR-2B vs purchase-register reconciliation engine (pure, testable).
import { normalizeGstin, round2, toNum } from './gst.js';

export const DEFAULT_OPTIONS = {
  valueTolerance: 1,      // ₹ allowed difference on taxable value / invoice value
  taxTolerance: 1,        // ₹ allowed difference on each tax head
  dateToleranceDays: 0,   // days allowed between invoice dates before flagging
  fuzzyInvoice: true,     // allow fuzzy invoice-number matching within the same GSTIN
  minInvoiceSimilarity: 0.75,
  crossGstin: true,       // detect a supplier GSTIN typo (same PAN or 1-2 char diff)
};

/** "INV/2026-27/0045" -> "INV20262745": uppercase, drop separators, strip leading zeros of digit runs. */
export function normalizeInvoiceNo(s) {
  return String(s ?? '').toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/\d+/g, (d) => String(Number(d)));
}

const MONTHS = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 };
/** Parse dd-mm-yyyy, dd/mm/yyyy, yyyy-mm-dd, dd-Mon-yyyy -> 'YYYY-MM-DD' or '' */
export function parseDate(s) {
  const t = String(s ?? '').trim();
  let m;
  let y, mo, d;
  if ((m = t.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/))) [, y, mo, d] = m;
  else if ((m = t.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/))) [, d, mo, y] = m;
  else if ((m = t.match(/^(\d{1,2})[-/ ]([A-Za-z]{3})[A-Za-z]*[-/ ](\d{2,4})$/))) { [, d, , y] = m; mo = MONTHS[m[2].toUpperCase()]; }
  else return '';
  y = Number(y); if (y < 100) y += 2000;
  mo = Number(mo); d = Number(d);
  if (!mo || mo > 12 || !d || d > 31) return '';
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
const dayDiff = (a, b) => (a && b ? Math.round(Math.abs(Date.parse(a) - Date.parse(b)) / 86400000) : Infinity);

export function levenshtein(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}
/** Last numeric group of the raw invoice number as a number: "TL/26-27/0118" -> "118". */
export function invoiceTail(raw) {
  const m = String(raw ?? '').match(/(\d+)(?!.*\d)/);
  return m ? String(Number(m[1])) : '';
}
/** 0..1 similarity of two invoice numbers (raw strings). */
export function similarity(rawA, rawB) {
  const a = normalizeInvoiceNo(rawA), b = normalizeInvoiceNo(rawB);
  if (a === b) return 1;
  const lev = 1 - levenshtein(a, b) / Math.max(a.length, b.length);
  // Suppliers often add/drop a prefix or FY ("118" vs "TL/26-27/118"): reward an identical numeric tail.
  const ta = invoiceTail(rawA), tb = invoiceTail(rawB);
  const tailScore = ta && ta === tb && ta.length >= 2 ? 0.8 : 0;
  return Math.max(lev, tailScore);
}

/** Flatten GSTR-2B JSON (public GSTN shape: data.docdata.b2b[].inv[], cdnr[].nt[]) into records. */
export function flattenGstr2b(json) {
  const root = json?.data ?? json;
  const dd = root?.docdata ?? root;
  const out = [];
  const sumItems = (doc, k) => (Array.isArray(doc.items) && doc.items.length ? doc.items.reduce((s, it) => s + toNum(it[k]), 0) : toNum(doc[k]));
  const push = (sup, doc, kind, sign) => out.push({
    source: '2B', kind,
    gstin: normalizeGstin(sup.ctin), name: sup.trdnm || '',
    invoiceNo: String(doc.inum ?? doc.ntnum ?? ''), date: parseDate(doc.dt), rawDate: doc.dt,
    invoiceValue: sign * toNum(doc.val),
    taxable: sign * round2(sumItems(doc, 'txval')), igst: sign * round2(sumItems(doc, 'igst')),
    cgst: sign * round2(sumItems(doc, 'cgst')), sgst: sign * round2(sumItems(doc, 'sgst')), cess: sign * round2(sumItems(doc, 'cess')),
    itcAvailable: (doc.itcavl ?? 'Y') !== 'N', reverseCharge: doc.rev === 'Y', reason: doc.rsn || '',
    period: sup.supprd || '',
  });
  for (const sup of dd?.b2b ?? []) for (const inv of sup.inv ?? []) push(sup, inv, 'Invoice', 1);
  for (const sup of dd?.cdnr ?? []) for (const nt of sup.nt ?? []) push(sup, nt, nt.typ === 'D' ? 'Debit note' : 'Credit note', nt.typ === 'D' ? 1 : -1);
  return out;
}

const ALIASES = {
  gstin: ['supplier gstin', 'gstin', 'gstin of supplier', 'ctin', 'party gstin', 'vendor gstin'],
  name: ['supplier name', 'party name', 'vendor name', 'trade name', 'name'],
  invoiceNo: ['invoice no', 'invoice number', 'inv no', 'bill no', 'document no', 'voucher ref', 'inum'],
  date: ['invoice date', 'inv date', 'bill date', 'date', 'document date'],
  invoiceValue: ['invoice value', 'total value', 'gross amount', 'val'],
  taxable: ['taxable value', 'taxable amount', 'assessable value', 'txval'],
  igst: ['igst', 'igst amount', 'integrated tax'],
  cgst: ['cgst', 'cgst amount', 'central tax'],
  sgst: ['sgst', 'sgst amount', 'sgst/utgst', 'state tax', 'utgst'],
  cess: ['cess', 'cess amount'],
  docType: ['type', 'doc type', 'document type'],
};
/** Map purchase-register CSV rows (flexible headers) to records. */
export function normalizeBooks(rows) {
  if (!rows.length) return [];
  const keys = Object.keys(rows[0]);
  const find = (field) => keys.find((k) => ALIASES[field].includes(k.toLowerCase().replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim()));
  const col = Object.fromEntries(Object.keys(ALIASES).map((f) => [f, find(f)]));
  for (const req of ['gstin', 'invoiceNo', 'taxable']) if (!col[req]) throw new Error(`Purchase register is missing a "${req}" column (accepted headers: ${ALIASES[req].join(', ')}).`);
  return rows.map((r, i) => {
    const isCn = /credit/i.test(r[col.docType] ?? '');
    const sign = isCn ? -1 : 1;
    const n = (f) => (col[f] ? sign * Math.abs(toNum(r[col[f]])) : 0);
    return {
      source: 'Books', kind: isCn ? 'Credit note' : 'Invoice', row: i + 2,
      gstin: normalizeGstin(r[col.gstin]), name: r[col.name] ?? '',
      invoiceNo: r[col.invoiceNo] ?? '', date: parseDate(r[col.date]), rawDate: r[col.date] ?? '',
      invoiceValue: n('invoiceValue'), taxable: n('taxable'), igst: n('igst'), cgst: n('cgst'), sgst: n('sgst'), cess: n('cess'),
    };
  });
}

const totalTax = (r) => round2(r.igst + r.cgst + r.sgst + r.cess);

/** Compare two matched records -> list of {field, books, gstr2b, diff} */
export function fieldDiffs(b, g, o) {
  const d = [];
  if (b.gstin !== g.gstin) d.push({ field: 'Supplier GSTIN', books: b.gstin, gstr2b: g.gstin, diff: '' });
  if (normalizeInvoiceNo(b.invoiceNo) !== normalizeInvoiceNo(g.invoiceNo)) d.push({ field: 'Invoice no.', books: b.invoiceNo, gstr2b: g.invoiceNo, diff: '' });
  const dd = dayDiff(b.date, g.date);
  if (dd > o.dateToleranceDays) d.push({ field: 'Invoice date', books: b.date || b.rawDate, gstr2b: g.date || g.rawDate, diff: Number.isFinite(dd) ? `${dd} day(s)` : 'unreadable' });
  const num = (field, k, tol) => {
    const diff = round2(b[k] - g[k]);
    if (Math.abs(diff) > tol + 1e-9) d.push({ field, books: b[k], gstr2b: g[k], diff });
  };
  num('Taxable value', 'taxable', o.valueTolerance);
  num('IGST', 'igst', o.taxTolerance); num('CGST', 'cgst', o.taxTolerance); num('SGST', 'sgst', o.taxTolerance); num('Cess', 'cess', o.taxTolerance);
  return d;
}

function candidateScore(b, g, o) {
  const sim = similarity(b.invoiceNo, g.invoiceNo);
  if (sim < o.minInvoiceSimilarity) return 0;
  const dd = dayDiff(b.date, g.date);
  const dateScore = dd <= o.dateToleranceDays ? 1 : dd <= 31 ? 0.5 : 0;
  const tv = Math.abs(b.taxable - g.taxable);
  const amtScore = tv <= o.valueTolerance ? 1 : tv <= Math.max(o.valueTolerance * 10, Math.abs(g.taxable) * 0.02) ? 0.5 : 0;
  if (dateScore === 0 && amtScore === 0) return 0;
  return 0.5 * sim + 0.25 * dateScore + 0.25 * amtScore;
}
const sameSign = (a, b) => (a.kind === 'Credit note') === (b.kind === 'Credit note');

/**
 * Reconcile. Returns { results[], summary, vendors[] }.
 * Status: Matched | Mismatch | Only in 2B | Only in books
 */
export function reconcile(gstr2bRecords, bookRecords, options = {}) {
  const o = { ...DEFAULT_OPTIONS, ...options };
  const usedG = new Set(), usedB = new Set();
  const pairs = [];
  const byGstin = new Map();
  gstr2bRecords.forEach((g, i) => { if (!byGstin.has(g.gstin)) byGstin.set(g.gstin, []); byGstin.get(g.gstin).push(i); });

  // Pass 1: exact GSTIN + normalised invoice number.
  const exact = new Map();
  gstr2bRecords.forEach((g, i) => { const k = `${g.gstin}|${normalizeInvoiceNo(g.invoiceNo)}|${g.kind === 'Credit note'}`; if (!exact.has(k)) exact.set(k, []); exact.get(k).push(i); });
  bookRecords.forEach((b, j) => {
    const list = exact.get(`${b.gstin}|${normalizeInvoiceNo(b.invoiceNo)}|${b.kind === 'Credit note'}`) || [];
    const i = list.find((x) => !usedG.has(x));
    if (i !== undefined) { usedG.add(i); usedB.add(j); pairs.push([j, i, 'exact']); }
  });

  // Pass 2: fuzzy invoice number within the same GSTIN (greedy by best score).
  if (o.fuzzyInvoice) {
    const cands = [];
    bookRecords.forEach((b, j) => {
      if (usedB.has(j)) return;
      for (const i of byGstin.get(b.gstin) || []) {
        if (usedG.has(i) || !sameSign(b, gstr2bRecords[i])) continue;
        const s = candidateScore(b, gstr2bRecords[i], o);
        if (s > 0) cands.push([s, j, i]);
      }
    });
    cands.sort((a, b) => b[0] - a[0]);
    for (const [, j, i] of cands) if (!usedB.has(j) && !usedG.has(i)) { usedB.add(j); usedG.add(i); pairs.push([j, i, 'fuzzy']); }
  }

  // Pass 3: same invoice no. + amounts, but GSTIN typo (same PAN, or <=2 chars different).
  if (o.crossGstin) {
    bookRecords.forEach((b, j) => {
      if (usedB.has(j)) return;
      const i = gstr2bRecords.findIndex((g, gi) => !usedG.has(gi) && sameSign(b, g)
        && normalizeInvoiceNo(g.invoiceNo) === normalizeInvoiceNo(b.invoiceNo)
        && Math.abs(g.taxable - b.taxable) <= o.valueTolerance
        && (g.gstin.slice(2, 12) === b.gstin.slice(2, 12) || levenshtein(g.gstin, b.gstin) <= 2));
      if (i >= 0) { usedB.add(j); usedG.add(i); pairs.push([j, i, 'gstin']); }
    });
  }

  const results = [];
  for (const [j, i, how] of pairs) {
    const b = bookRecords[j], g = gstr2bRecords[i];
    const diffs = fieldDiffs(b, g, o);
    results.push({ status: diffs.length ? 'Mismatch' : 'Matched', matchType: how, books: b, gstr2b: g, diffs });
  }
  gstr2bRecords.forEach((g, i) => { if (!usedG.has(i)) results.push({ status: 'Only in 2B', matchType: '', books: null, gstr2b: g, diffs: [] }); });
  bookRecords.forEach((b, j) => { if (!usedB.has(j)) results.push({ status: 'Only in books', matchType: '', books: b, gstr2b: null, diffs: [] }); });

  const order = { Mismatch: 0, 'Only in books': 1, 'Only in 2B': 2, Matched: 3 };
  results.sort((a, b) => order[a.status] - order[b.status] || (a.books || a.gstr2b).gstin.localeCompare((b.books || b.gstr2b).gstin));
  return { results, summary: summarize(results, gstr2bRecords, bookRecords), vendors: vendorFollowUp(results), options: o };
}

export function summarize(results, g2b, books) {
  const sumTax = (arr) => round2(arr.reduce((s, r) => s + totalTax(r), 0));
  const counts = { Matched: 0, Mismatch: 0, 'Only in 2B': 0, 'Only in books': 0 };
  results.forEach((r) => counts[r.status]++);
  const pick = (st, side) => results.filter((r) => r.status === st).map((r) => r[side]);
  const matched = pick('Matched', 'books');
  const mism = results.filter((r) => r.status === 'Mismatch');
  // For mismatches, ITC you can safely claim is the lower of books vs 2B per pair.
  const mismSafe = round2(mism.reduce((s, r) => s + Math.min(totalTax(r.books), totalTax(r.gstr2b)), 0));
  const mismGap = round2(mism.reduce((s, r) => s + Math.max(0, totalTax(r.books) - totalTax(r.gstr2b)), 0));
  return {
    counts,
    itcAsPer2B: sumTax(g2b.filter((g) => g.itcAvailable)),
    itcNotAvailableIn2B: sumTax(g2b.filter((g) => !g.itcAvailable)),
    itcAsPerBooks: sumTax(books),
    itcMatched: sumTax(matched),
    itcMismatchClaimable: mismSafe,
    itcMismatchGap: mismGap,
    itcAtRisk: sumTax(pick('Only in books', 'books')),
    itcUnrecorded: sumTax(pick('Only in 2B', 'gstr2b')),
  };
}

export function vendorFollowUp(results) {
  const map = new Map();
  for (const r of results) {
    if (r.status !== 'Only in books' && r.status !== 'Mismatch') continue;
    const b = r.books;
    const v = map.get(b.gstin) || { gstin: b.gstin, name: b.name || r.gstr2b?.name || '', missing: [], mismatched: [], itcAtRisk: 0 };
    if (r.status === 'Only in books') { v.missing.push(b.invoiceNo); v.itcAtRisk += totalTax(b); }
    else { v.mismatched.push(`${b.invoiceNo} (${r.diffs.map((d) => d.field).join(', ')})`); v.itcAtRisk += Math.max(0, totalTax(b) - totalTax(r.gstr2b)); }
    map.set(b.gstin, v);
  }
  return [...map.values()].map((v) => ({
    ...v,
    itcAtRisk: round2(v.itcAtRisk),
    action: [
      v.missing.length ? `Please upload ${v.missing.length} invoice(s) in your GSTR-1/IFF: ${v.missing.join(', ')}` : '',
      v.mismatched.length ? `Please amend/confirm details for: ${v.mismatched.join('; ')}` : '',
    ].filter(Boolean).join('. '),
  })).sort((a, b) => b.itcAtRisk - a.itcAtRisk);
}

/** Flat rows for CSV/Excel export. */
export function resultsToRows(results) {
  return results.map((r) => {
    const b = r.books || {}, g = r.gstr2b || {};
    return {
      Status: r.status, 'Match type': r.matchType,
      'Supplier GSTIN': b.gstin || g.gstin, 'Supplier name': b.name || g.name,
      'Books invoice no': b.invoiceNo ?? '', '2B invoice no': g.invoiceNo ?? '',
      'Books date': b.date ?? '', '2B date': g.date ?? '',
      'Books taxable': b.taxable ?? '', '2B taxable': g.taxable ?? '',
      'Books total tax': r.books ? totalTax(b) : '', '2B total tax': r.gstr2b ? totalTax(g) : '',
      'ITC available in 2B': r.gstr2b ? (g.itcAvailable ? 'Y' : 'N') : '',
      Differences: r.diffs.map((d) => `${d.field}: books ${d.books} vs 2B ${d.gstr2b}${d.diff !== '' ? ` (${d.diff})` : ''}`).join(' | '),
    };
  });
}
export { totalTax };
