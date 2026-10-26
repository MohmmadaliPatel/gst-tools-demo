// Invoice / PO extraction engine: positioned PDF text -> header fields, line items, confidence,
// totals and tax checks, duplicate detection and PO (2/3-way) matching. Pure functions, no DOM, no network.
import { validateGstin, round2 } from './gst.js';
import { normalizeInvoiceNo } from './recon.js';
import { csvRows } from './form26as.js';

// ---------- text layout ----------
/** pdf.js text items -> {str,x,y,w,size,page}. Whitespace-only items are dropped. */
export function normalizeItems(items, page = 1) {
  const out = [];
  for (const it of items) {
    const str = String(it.str ?? '');
    if (!str.trim()) continue;
    const size = Math.abs(it.size ?? it.height ?? (it.transform ? Math.hypot(it.transform[2], it.transform[3]) : 10)) || 10;
    const x = it.x ?? it.transform[4], y = it.y ?? it.transform[5];
    out.push({ str, x, y, w: it.w ?? it.width ?? str.length * size * 0.5, size, page: it.page ?? page });
  }
  return out;
}

/** Group items into lines (top to bottom per page) and segments (cells separated by a visible gap). */
export function toLines(items) {
  const byPage = new Map();
  for (const it of items) { if (!byPage.has(it.page)) byPage.set(it.page, []); byPage.get(it.page).push(it); }
  const lines = [];
  for (const page of [...byPage.keys()].sort((a, b) => a - b)) {
    const its = byPage.get(page).slice().sort((a, b) => b.y - a.y || a.x - b.x);
    const rows = [];
    for (const it of its) {
      const row = rows.find((r) => Math.abs(r.y - it.y) <= Math.max(2, it.size * 0.3));
      if (row) row.items.push(it); else rows.push({ y: it.y, items: [it] });
    }
    rows.sort((a, b) => b.y - a.y);
    for (const r of rows) {
      r.items.sort((a, b) => a.x - b.x);
      const segs = [];
      for (const it of r.items) {
        const last = segs[segs.length - 1];
        const gap = last ? it.x - last.x1 : Infinity;
        if (last && gap < Math.max(1.5, it.size * 0.4)) {
          last.text += (gap > it.size * 0.15 && !/\s$/.test(last.text) ? ' ' : '') + it.str;
          last.x1 = Math.max(last.x1, it.x + it.w); last.size = Math.max(last.size, it.size);
        } else segs.push({ text: it.str, x0: it.x, x1: it.x + it.w, size: it.size, y: r.y, page });
      }
      segs.forEach((s) => { s.text = s.text.replace(/\s+/g, ' ').trim(); });
      lines.push({ page, y: r.y, size: Math.max(...segs.map((s) => s.size)), segs, text: segs.map((s) => s.text).join('  ') });
    }
  }
  lines.forEach((l, i) => { l.idx = i; });
  return lines;
}

// ---------- values ----------
const CUR_RE = /(?:₹|Rs\.?|INR|US\$|USD|A\$|AUD|GBP|£|\$|€|EUR)/gi;
/** "1,23,456.50" / "$1,234.50" / "£(12.00)" / "1234.5-" -> number, or NaN. */
export function parseAmount(raw) {
  let s = String(raw ?? '').replace(CUR_RE, '').replace(/\s+/g, '').trim();
  if (!s) return NaN;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (/-$/.test(s)) { neg = true; s = s.slice(0, -1); }
  if (/^-/.test(s)) { neg = !neg; s = s.slice(1); }
  if (!/^\d{1,3}(,\d{2,3})*(\.\d{1,4})?$|^\d+(\.\d{1,4})?$/.test(s)) return NaN;
  const n = Number(s.replace(/,/g, ''));
  return neg ? -n : n;
}

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const iso = (y, m, d) => {
  y = Number(y); m = Number(m); d = Number(d); if (y < 100) y += 2000;
  if (!m || m > 12 || !d || d > 31 || y < 1990 || y > 2100) return '';
  const dt = new Date(Date.UTC(y, m - 1, d)); if (dt.getUTCDate() !== d) return '';
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
};
/** Parse a date written any common way. US documents read nn/nn as month/day; others as day/month. */
export function parseAnyDate(raw, country = '') {
  const t = String(raw ?? '').trim().replace(/(\d)(st|nd|rd|th)\b/gi, '$1').replace(/,/g, ' ').replace(/\s+/g, ' ');
  let m;
  if ((m = t.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/))) return { iso: iso(m[1], m[2], m[3]), ambiguous: false };
  if ((m = t.match(/^(\d{1,2})[-/. ]([A-Za-z]{3,9})\.?[-/. ](\d{2,4})$/)) && MONTHS[m[2].toLowerCase().slice(0, m[2].length >= 4 && m[2].toLowerCase().startsWith('sept') ? 4 : 3)]) return { iso: iso(m[3], MONTHS[m[2].toLowerCase().slice(0, 3)], m[1]), ambiguous: false };
  if ((m = t.match(/^([A-Za-z]{3,9})\.? (\d{1,2}) (\d{4})$/)) && MONTHS[m[1].toLowerCase().slice(0, 3)]) return { iso: iso(m[3], MONTHS[m[1].toLowerCase().slice(0, 3)], m[2]), ambiguous: false };
  if ((m = t.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/))) {
    const a = Number(m[1]), b = Number(m[2]);
    const us = country === 'US';
    if (a > 12 && b <= 12) return { iso: iso(m[3], b, a), ambiguous: false };
    if (b > 12 && a <= 12) return { iso: iso(m[3], a, b), ambiguous: false };
    return { iso: us ? iso(m[3], a, b) : iso(m[3], b, a), ambiguous: a !== b && !country };
  }
  return { iso: '', ambiguous: false };
}
const DATE_IN_TEXT = /(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}|\d{1,2}(?:st|nd|rd|th)?[-/. ][A-Za-z]{3,9}\.?[-/. ]\d{2,4}|[A-Za-z]{3,9}\.? \d{1,2},? \d{4})/;

// ---------- header labels ----------
const LABELS = {
  invoiceNo: /^(?:tax\s+)?(?:invoice|inv|bill)\.?\s*(?:no\.?|number|num\.?|#)(?=\s|:|$|[A-Z0-9])/i,
  invoiceDate: /^(?:tax\s+point\s*\/\s*)?(?:invoice\s+date|inv\.?\s*date|date\s+of\s+invoice|bill\s+date|date\s+of\s+issue|issue\s+date|date)(?=\s|:|$)/i,
  dueDate: /^(?:due\s+date|payment\s+due(?:\s+date)?|date\s+due|due\s+by|pay\s+by)(?=\s|:|$)/i,
  poNo: /^(?:p\.?\s?o\.?\s*(?:no\.?|number|#|ref\.?)|purchase\s+order(?:\s+(?:no\.?|number|#))?|buyer[’']?s?\s+order\s+(?:no\.?|number)|(?:your\s+)?order\s+(?:ref\.?|reference|no\.?|number))(?=\s|:|$)/i,
  terms: /^(?:payment\s+)?terms(?=\s|:|$)/i,
};
const VALID = {
  invoiceNo: (v) => /\d/.test(v) && v.length <= 32 && !parseAnyDate(v).iso && !/\s{2,}/.test(v) && v.split(' ').length <= 2,
  invoiceDate: (v) => !!parseAnyDate(v.match(DATE_IN_TEXT)?.[0] || '').iso,
  dueDate: (v) => !!parseAnyDate(v.match(DATE_IN_TEXT)?.[0] || '').iso,
  poNo: (v) => /\d/.test(v) && v.length <= 32 && v.split(' ').length <= 2,
  terms: (v) => /\d|receipt/i.test(v) && v.length <= 30,
};
const TOTALS = [
  ['subtotal', /^(?:sub\s*-?\s*total|net\s+total|net\s+amount|total\s+taxable\s+value|taxable\s+value|total\s+before\s+tax|total\s+ex(?:cl)?\.?\s+(?:gst|vat|tax))/i],
  ['cgst', /^cgst\b/i], ['sgst', /^(?:sgst|utgst)\b/i], ['igst', /^igst\b/i],
  ['vat', /^vat\b(?!\s*(?:reg|no|number))/i], ['gst', /^gst\b(?!in)/i], ['salesTax', /^(?:sales\s+tax|tax)\b/i],
  ['freight', /^(?:freight|shipping|delivery|carriage|postage)\b/i],
  ['roundOff', /^(?:round(?:ing|ed)?\s*off|rounding)\b/i],
  ['total', /^(?:grand\s+total|invoice\s+total|total\s+due|balance\s+due|amount\s+due|total\s+amount|total\s+payable|amount\s+payable|total)\b/i],
];
const TOTAL_STRONG = /^(?:grand\s+total|invoice\s+total|total\s+due|balance\s+due|amount\s+due|total\s+payable|amount\s+payable)/i;
const BUYER_LABEL = /^(?:bill(?:ed)?\s+to|invoice\s+to|buyer(?=\s*(?::|details|name|$))|ship\s+to|deliver\s+to|customer(?!\s+ref)|consignee|sold\s+to)\b/i;
const TITLE = /^(?:tax\s+invoice|invoice|bill\s+of\s+supply|commercial\s+invoice|original(?:\s+for\s+recipient)?|duplicate|copy\b.*|page\s+\d.*|tax\s+invoice\s*\/.*)$/i;
const COMPANY = /\b(?:ltd|limited|pvt|private|inc|llc|llp|pty|plc|gmbh|corp|corporation|co|company|& sons|enterprises|traders|industries|electricals|supplies|supply|services)\b\.?/i;

const box = (seg) => ({ page: seg.page, x0: seg.x0, x1: seg.x1, y0: seg.y - seg.size * 0.25, y1: seg.y + seg.size * 0.85 });

function buyerBlock(lines) {
  const inBuyer = new Set();
  for (const l of lines) {
    const s = l.segs.find((g) => BUYER_LABEL.test(g.text));
    if (!s) continue;
    inBuyer.add(`${l.idx}:${s.x0}`);
    // the label's own line (text after the label) and up to 4 following lines in the same column
    let prevY = l.y;
    for (const n of lines.filter((x) => x.page === l.page && x.y < l.y && x.y > l.y - 70)) {
      if (prevY - n.y > 22) break;
      const g = n.segs.find((q) => Math.abs(q.x0 - s.x0) < 25);
      if (!g || Object.values(LABELS).some((re) => re.test(g.text)) || BUYER_LABEL.test(g.text)) break;
      inBuyer.add(`${n.idx}:${g.x0}`); prevY = n.y;
    }
  }
  return (line, seg) => inBuyer.has(`${line.idx}:${seg.x0}`);
}

function findLabelled(lines, key, isBuyer) {
  const re = LABELS[key], ok = VALID[key], cands = [];
  for (const l of lines) {
    l.segs.forEach((s, si) => {
      const m = s.text.match(re);
      if (!m || isBuyer(l, s)) return;
      const rest = s.text.slice(m[0].length).replace(/^\s*[:#.\-]?\s*/, '').trim();
      if (rest && ok(rest)) { cands.push({ value: rest, conf: 0.95, how: 'label + value', box: box(s) }); return; }
      if (rest) return;
      const right = l.segs[si + 1];
      if (right && right.x0 - s.x1 < 260 && ok(right.text) && !Object.values(LABELS).some((r) => r.test(right.text))) { cands.push({ value: right.text, conf: 0.9, how: 'label, value to the right', box: box(right) }); return; }
      const below = lines.find((n) => n.page === l.page && n.y < l.y && l.y - n.y < s.size * 3);
      const g = below?.segs.find((q) => q.x0 < s.x1 + 4 && q.x1 > s.x0 - 4 && Math.abs(q.x0 - s.x0) < 40);
      if (g && ok(g.text)) cands.push({ value: g.text, conf: 0.85, how: 'label, value below', box: box(g) });
    });
  }
  if (!cands.length) return null;
  const best = cands[0];
  const distinct = new Set(cands.map((c) => c.value.toUpperCase()));
  if (distinct.size > 1) { best.conf -= 0.2; best.how += ` (${distinct.size} different candidates)`; }
  return best;
}

function detectCountry(text) {
  if (/\b\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]\b/.test(text) || /\bGSTIN\b|\bCGST\b|\bIGST\b|\bHSN\b/.test(text)) return 'IN';
  if (/\bABN\b/.test(text) || /\bGST\s+10\s*%/i.test(text)) return 'AU';
  if (/\bVAT\b|£|\bGBP\b/.test(text)) return 'GB';
  if (/\$|\bUSD\b|sales\s+tax|\b[A-Z][a-z]+,\s[A-Z]{2}\s\d{5}\b/.test(text)) return 'US';
  return '';
}
function detectCurrency(text, country) {
  const codes = (text.match(/\b(INR|USD|GBP|AUD|EUR|CAD|NZD|SGD|AED)\b/g) || []);
  if (codes.length) {
    const top = Object.entries(codes.reduce((a, c) => ((a[c] = (a[c] || 0) + 1), a), {})).sort((a, b) => b[1] - a[1])[0][0];
    return { value: top, conf: 0.95, how: 'currency code printed on the invoice' };
  }
  if (/£/.test(text)) return { value: 'GBP', conf: 0.9, how: '£ symbol' };
  if (/₹|\bRs\.?\s?\d|\(Rs\.?\)/.test(text)) return { value: 'INR', conf: 0.9, how: 'Rs./₹ symbol' };
  const byCountry = { IN: 'INR', GB: 'GBP', AU: 'AUD', US: 'USD' }[country];
  if (byCountry) return { value: byCountry, conf: 0.7, how: `inferred from ${country} tax IDs/labels` };
  return null;
}

function findTaxIds(lines, country, isBuyer) {
  const out = { vendor: null, buyer: null };
  const gst = /\b(\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z])\b/;
  for (const l of lines) for (const s of l.segs) {
    let m;
    if ((m = s.text.match(gst))) {
      const v = validateGstin(m[1]);
      const c = { value: m[1], conf: v.valid ? 0.97 : 0.6, how: v.valid ? 'GSTIN, checksum valid' : 'GSTIN pattern, checksum FAILED', box: box(s) };
      if (isBuyer(l, s) && !out.buyer) out.buyer = c; else if (!isBuyer(l, s) && !out.vendor) out.vendor = c;
    } else if ((m = s.text.match(/\bABN[:\s]*(\d{2}\s?\d{3}\s?\d{3}\s?\d{3})\b/))) { if (!out.vendor) out.vendor = { value: m[1], conf: 0.9, how: 'ABN label', box: box(s) }; }
    else if ((m = s.text.match(/\bVAT\s*(?:Reg(?:istration)?\.?\s*(?:No\.?|Number)?)?[:\s]*((?:GB)?\s?\d{3}\s?\d{4}\s?\d{2})\b/i))) { if (!out.vendor) out.vendor = { value: m[1].trim(), conf: 0.9, how: 'VAT registration label', box: box(s) }; }
  }
  return out;
}

function findVendor(lines, isBuyer, knownVendors = []) {
  const top = lines.filter((l) => l.page === 1).slice(0, 14);
  const cands = [];
  for (const l of top) for (const s of l.segs) {
    const t = s.text.replace(/^(?:from|supplier|vendor|seller)\s*:\s*/i, '');
    if (t.length < 3 || t.length > 60 || TITLE.test(t) || isBuyer(l, s) || BUYER_LABEL.test(t)) continue;
    if (Object.values(LABELS).some((re) => re.test(t)) || /^(?:gstin|abn|vat|state|pan|cin|phone|tel|fax|web)/i.test(t) || DATE_IN_TEXT.test(t)) continue;
    if (/\d{3,}/.test(t) && !COMPANY.test(t)) continue; // addresses
    let score = s.size * 2 + (COMPANY.test(t) ? 8 : 0) - l.idx * 0.4;
    cands.push({ t, s, score });
  }
  cands.sort((a, b) => b.score - a.score);
  const best = cands[0];
  if (!best) return null;
  let value = best.t.replace(/\s*-\s*invoice.*$/i, '');
  let conf = COMPANY.test(value) ? 0.88 : 0.7, how = 'largest company-like heading on page 1';
  if (value === value.toUpperCase() && /[A-Z]{3}/.test(value)) { value = value.toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase()).replace(/\b(Ltd|Llc|Llp|Pty|Inc)\b/g, (w) => w); conf -= 0.05; how += ', re-cased from capitals'; }
  const known = bestVendorMatch(value, knownVendors);
  if (known && known.score >= 0.6) { conf = Math.max(conf, 0.93); how += `; matches PO vendor "${known.name}"`; }
  return { value, conf, how, box: box(best.s) };
}

// ---------- line items ----------
const COLS = [
  ['sr', /^(?:sr\.?|s\.?\s*no\.?|sl\.?\s*no\.?|#|no\.?)$/i],
  ['code', /^(?:item\s*#|item\s+code|code|sku|part\s*(?:no\.?|#)?|product\s+code)$/i],
  ['hsn', /\b(?:hsn|sac)\b/i],
  ['taxRate', /(?:vat|gst|igst|tax)\s*%|^%$|^rate\s*%$/i],
  ['rate', /^(?:rate|unit\s*price|price|unit\s*cost|unit\s+rate|price\s+each)$/i],
  ['qty', /^(?:qty|quantity|qnty|units)$/i],
  ['uom', /^(?:unit|uom|u\/m|per)$/i],
  ['taxAmt', /^(?:gst|vat|tax|tax\s+amount|gst\s+amount|vat\s+amount)$/i],
  ['amount', /^(?:amount|taxable\s+value|net|total|value|line\s+total|net\s+amount|ext\.?\s*price|extension)$/i],
  ['desc', /desc|particular|goods|service|item|product/i],
];
const colType = (t) => (COLS.find(([, re]) => re.test(t.trim())) || [null])[0];

function findItemHeader(lines, from = 0) {
  for (let i = from; i < lines.length; i++) {
    const types = lines[i].segs.map((s) => colType(s.text));
    const set = new Set(types.filter(Boolean));
    if (set.size >= 3 && set.has('desc') && (set.has('amount') || set.has('rate')) && (set.has('qty') || set.has('amount'))) {
      return { line: lines[i], cols: lines[i].segs.map((s, k) => ({ type: types[k] || 'other', x0: s.x0, x1: s.x1, label: s.text })) };
    }
  }
  return null;
}
function assign(seg, cols) {
  let best = null, bestOv = 0;
  for (const c of cols) { const ov = Math.min(seg.x1, c.x1 + 2) - Math.max(seg.x0, c.x0 - 2); if (ov > bestOv) { bestOv = ov; best = c; } }
  if (best) return best;
  let d = Infinity;
  for (const c of cols) { const dd = Math.min(Math.abs(seg.x0 - c.x0), Math.abs(seg.x1 - c.x1)); if (dd < d) { d = dd; best = c; } }
  return best;
}
const isTotalsLine = (l) => TOTALS.some(([, re]) => re.test(l.segs[0]?.text || '')) || /^(?:amount\s+in\s+words|continued)/i.test(l.segs[0]?.text || '');

export function extractLines(lines) {
  const items = [], used = new Set();
  let hdr = findItemHeader(lines);
  if (!hdr) return { items, used, header: null };
  const header = hdr;
  let i = hdr.line.idx + 1;
  while (i < lines.length) {
    const l = lines[i];
    if (l.page !== hdr.line.page) { const again = findItemHeader(lines, i); if (again && again.line.page === l.page) { hdr = again; i = again.line.idx + 1; continue; } break; }
    if (isTotalsLine(l)) break;
    const cells = {};
    for (const s of l.segs) { const c = assign(s, hdr.cols); (cells[c.type] ||= []).push(s); }
    const txt = (t) => (cells[t] || []).map((s) => s.text).join(' ').trim();
    const qtyRaw = txt('qty'), amountRaw = txt('amount'), rateRaw = txt('rate');
    const qm = qtyRaw.match(/^(-?[\d,]*\.?\d+)\s*([A-Za-z]{1,6})?$/);
    const qty = qm ? parseAmount(qm[1]) : NaN, amount = parseAmount(amountRaw), rate = parseAmount(rateRaw);
    const numeric = Number.isFinite(qty) || Number.isFinite(amount);
    if (!numeric) {
      const d = txt('desc');
      if (d && items.length && Object.keys(cells).every((k) => k === 'desc') && items[items.length - 1]._y - l.y < 20) { const prev = items[items.length - 1]; prev.description += ' ' + d; used.add(l.idx); i++; continue; }
      if (items.length) break; // first non-item line after the table
      i++; continue;
    }
    const row = {
      code: txt('code'), description: txt('desc'), hsn: txt('hsn').replace(/\s/g, ''), qty: Number.isFinite(qty) ? qty : null,
      uom: txt('uom') || qm?.[2] || '', rate: Number.isFinite(rate) ? rate : null, amount: Number.isFinite(amount) ? amount : null,
      taxRate: Number.isFinite(parseAmount(txt('taxRate').replace('%', ''))) ? parseAmount(txt('taxRate').replace('%', '')) : null,
      taxAmount: Number.isFinite(parseAmount(txt('taxAmt'))) ? parseAmount(txt('taxAmt')) : null,
      page: l.page, _y: l.y, box: { page: l.page, x0: Math.min(...l.segs.map((s) => s.x0)), x1: Math.max(...l.segs.map((s) => s.x1)), y0: l.y - l.size * 0.3, y1: l.y + l.size * 0.9 },
    };
    if (row.amount === null && row.qty !== null && row.rate !== null) { row.amount = round2(row.qty * row.rate); row.derived = 'amount'; }
    if (row.rate === null && row.qty && row.amount !== null) { row.rate = round2(row.amount / row.qty); row.derived = 'rate'; }
    items.push(row); used.add(l.idx); i++;
  }
  for (const r of items) {
    const mathOk = r.qty !== null && r.rate !== null && r.amount !== null && Math.abs(round2(r.qty * r.rate) - r.amount) <= 0.011;
    r.conf = !r.description ? 0.5 : r.derived ? 0.65 : mathOk ? 0.96 : 0.55;
    delete r._y;
  }
  return { items, used, header };
}

function extractTotals(lines, used) {
  const out = {};
  for (const l of lines) {
    if (used.has(l.idx) || l.segs.length < 2) continue;
    const last = l.segs[l.segs.length - 1];
    const amt = parseAmount(last.text);
    if (!Number.isFinite(amt)) continue;
    const label = l.segs.slice(0, -1).map((s) => s.text).join(' ');
    for (const [key, re] of TOTALS) {
      if (!re.test(label)) continue;
      if (key === 'total' && out.total && !TOTAL_STRONG.test(label) && TOTAL_STRONG.test(out.total.label)) break;
      const rate = label.match(/(\d+(?:\.\d+)?)\s*%/);
      if (key === 'total' && out.total && TOTAL_STRONG.test(out.total.label) && !TOTAL_STRONG.test(label)) break;
      out[key] = { value: amt, conf: 0.95, how: `"${label}"`, label, rate: rate ? Number(rate[1]) : null, box: box(last) };
      break;
    }
  }
  return out;
}

function termsToDue(terms, invIso) {
  const m = String(terms || '').match(/(\d{1,3})\s*days?|net\s*(\d{1,3})/i);
  if (!m || !invIso) return '';
  const d = new Date(invIso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + Number(m[1] || m[2]));
  return d.toISOString().slice(0, 10);
}

export const HEADER_FIELDS = ['vendor', 'vendorTaxId', 'buyerTaxId', 'invoiceNo', 'invoiceDate', 'dueDate', 'poNo', 'currency', 'subtotal', 'cgst', 'sgst', 'igst', 'vat', 'gst', 'salesTax', 'freight', 'roundOff', 'total'];
export const TAX_KEYS = ['cgst', 'sgst', 'igst', 'vat', 'gst', 'salesTax'];

/** Extract one invoice from pdf.js-style items. Returns { country, fields: {key:{value,conf,how,box}}, lines, checks }. */
export function extractInvoice(rawItems, opts = {}) {
  const items = rawItems[0]?.page !== undefined && rawItems[0]?.x !== undefined ? rawItems : normalizeItems(rawItems);
  const lines = toLines(items);
  const all = lines.map((l) => l.text).join('\n');
  const country = detectCountry(all);
  const isBuyer = buyerBlock(lines);
  const f = {};
  f.vendor = findVendor(lines, isBuyer, opts.knownVendors || []);
  const ids = findTaxIds(lines, country, isBuyer);
  f.vendorTaxId = ids.vendor; f.buyerTaxId = ids.buyer;
  for (const k of ['invoiceNo', 'invoiceDate', 'dueDate', 'poNo', 'terms']) f[k] = findLabelled(lines, k, isBuyer);
  for (const k of ['invoiceDate', 'dueDate']) {
    if (!f[k]) continue;
    const d = parseAnyDate(f[k].value.match(DATE_IN_TEXT)[0], country);
    f[k] = { ...f[k], raw: f[k].value, value: d.iso, conf: f[k].conf - (d.ambiguous ? 0.25 : 0), how: f[k].how + (d.ambiguous ? '; day/month order ambiguous' : '') };
  }
  if (!f.dueDate && f.terms && f.invoiceDate) { const due = termsToDue(f.terms.value, f.invoiceDate.value); if (due) f.dueDate = { value: due, conf: 0.7, how: `calculated from terms "${f.terms.value}"`, box: f.terms.box }; }
  f.currency = detectCurrency(all, country);
  const { items: rows, used, header } = extractLines(lines);
  const t = extractTotals(lines, used);
  for (const k of ['subtotal', ...TAX_KEYS, 'freight', 'roundOff', 'total']) f[k] = t[k] || null;
  if (country === 'US' && f.gst) { f.salesTax = f.salesTax || f.gst; f.gst = null; }
  const fields = {};
  for (const k of [...HEADER_FIELDS, 'terms']) fields[k] = f[k] ? { value: f[k].value, conf: round2(Math.max(0, Math.min(1, f[k].conf))), how: f[k].how, box: f[k].box || null, ...(f[k].rate != null ? { rate: f[k].rate } : {}) } : { value: k === 'vendor' || k.endsWith('No') || k.endsWith('Id') || k.endsWith('Date') || k === 'currency' || k === 'terms' ? '' : null, conf: 0, how: 'not found', box: null };
  const doc = { file: opts.file || '', country, fields, lines: rows, itemHeader: header ? header.cols.map((c) => c.type) : [] };
  calibrate(doc);
  return doc;
}

/** Raise confidence where the arithmetic agrees; lower it where it does not. */
function calibrate(doc) {
  const F = doc.fields, v = (k) => (typeof F[k].value === 'number' ? F[k].value : 0);
  const sumLines = round2(doc.lines.reduce((s, l) => s + (l.amount || 0), 0));
  const taxTotal = round2(TAX_KEYS.reduce((s, k) => s + v(k), 0));
  if (F.subtotal.value === null && doc.lines.length) F.subtotal = { value: sumLines, conf: 0.6, how: 'not printed; sum of line items', box: null };
  if (F.subtotal.value !== null) F.subtotal.conf = Math.abs(sumLines - F.subtotal.value) <= 0.011 ? 0.99 : Math.min(F.subtotal.conf, 0.55);
  if (F.total.value !== null) {
    const ok = Math.abs(round2(v('subtotal') + taxTotal + v('freight') + v('roundOff')) - F.total.value) <= 0.011;
    F.total.conf = ok ? 0.99 : Math.min(F.total.conf, 0.55);
    if (ok) for (const k of [...TAX_KEYS, 'freight', 'roundOff']) if (F[k].value !== null) F[k].conf = Math.max(F[k].conf, 0.97);
  }
}

// ---------- checks ----------
const near = (a, b, tol = 0.011) => Math.abs(a - b) <= tol;
export function docTotals(doc) {
  const F = doc.fields, v = (k) => (typeof F[k]?.value === 'number' && Number.isFinite(F[k].value) ? F[k].value : 0);
  const sumLines = round2(doc.lines.reduce((s, l) => s + (Number(l.amount) || 0), 0));
  const taxTotal = round2(TAX_KEYS.reduce((s, k) => s + v(k), 0));
  return { sumLines, subtotal: v('subtotal'), taxTotal, freight: v('freight'), roundOff: v('roundOff'), total: v('total'), computed: round2(v('subtotal') + taxTotal + v('freight') + v('roundOff')) };
}

/** Re-validate a (possibly user-edited) document. Returns [{id, level: 'ok'|'warn'|'error', msg, field?, line?}] */
export function checkDoc(doc) {
  const F = doc.fields, out = [];
  const add = (level, id, msg, extra = {}) => out.push({ level, id, msg, ...extra });
  for (const [k, label] of [['vendor', 'Vendor'], ['invoiceNo', 'Invoice number'], ['invoiceDate', 'Invoice date'], ['total', 'Total']]) {
    const val = F[k]?.value; if (val === '' || val === null || val === undefined || (typeof val === 'number' && !Number.isFinite(val))) add('error', 'required', `${label} is missing.`, { field: k });
  }
  if (!doc.lines.length) add('error', 'no_lines', 'No line items found. Add them, or a single line with the net amount.');
  const t = docTotals(doc);
  if (doc.lines.length) {
    if (near(t.sumLines, t.subtotal)) add('ok', 'lines_sum', `Line items add up to the subtotal (${fmt(t.subtotal)}).`);
    else add('error', 'lines_sum', `Line items add up to ${fmt(t.sumLines)}, but the subtotal is ${fmt(t.subtotal)} (difference ${fmt(round2(t.sumLines - t.subtotal))}).`, { field: 'subtotal' });
  }
  doc.lines.forEach((l, i) => {
    if (l.qty !== null && l.rate !== null && l.amount !== null && !near(round2(l.qty * l.rate), l.amount)) add('warn', 'line_math', `Line ${i + 1}: ${l.qty} × ${fmt(l.rate)} = ${fmt(round2(l.qty * l.rate))}, but the line shows ${fmt(l.amount)}.`, { line: i });
    if (doc.country === 'IN' && !/^\d{4}(\d{2}){0,2}$/.test(String(l.hsn || ''))) add('warn', 'hsn', `Line ${i + 1}: HSN/SAC ${l.hsn ? `"${l.hsn}" is not 4, 6 or 8 digits` : 'is missing'}.`, { line: i });
  });
  if (F.total.value !== null) {
    if (near(t.computed, t.total)) add('ok', 'total_math', `Subtotal + tax${t.freight ? ' + freight' : ''}${t.roundOff ? ' + round-off' : ''} = total (${fmt(t.total)}).`);
    else add('error', 'total_math', `Subtotal ${fmt(t.subtotal)} + tax ${fmt(t.taxTotal)}${t.freight ? ` + freight ${fmt(t.freight)}` : ''}${t.roundOff ? ` + round-off ${fmt(t.roundOff)}` : ''} = ${fmt(t.computed)}, but the total is ${fmt(t.total)}.`, { field: 'total' });
  }
  if (Math.abs(t.roundOff) > 1) add('warn', 'round_off', `Round-off of ${fmt(t.roundOff)} is more than 1.00.`, { field: 'roundOff' });
  // tax rules per country
  const rate = (k) => (t.subtotal ? round2((F[k].value / t.subtotal) * 100) : 0);
  if (doc.country === 'IN') {
    for (const k of ['vendorTaxId', 'buyerTaxId']) {
      if (!F[k].value) { add(k === 'vendorTaxId' ? 'error' : 'warn', 'gstin', `${k === 'vendorTaxId' ? 'Supplier' : 'Buyer'} GSTIN not found.`, { field: k }); continue; }
      const g = validateGstin(F[k].value);
      if (g.valid) add('ok', 'gstin', `${k === 'vendorTaxId' ? 'Supplier' : 'Buyer'} GSTIN ${g.gstin} is valid (checksum OK, state ${g.stateCode}).`);
      else add('error', 'gstin', `${k === 'vendorTaxId' ? 'Supplier' : 'Buyer'} GSTIN: ${g.errors[0]}`, { field: k });
    }
    const vs = String(F.vendorTaxId.value || '').slice(0, 2), bs = String(F.buyerTaxId.value || '').slice(0, 2);
    const hasIgst = (F.igst.value || 0) !== 0, hasCs = (F.cgst.value || 0) !== 0 || (F.sgst.value || 0) !== 0;
    if (vs && bs) {
      if (vs === bs && hasIgst) add('error', 'tax_type', `Supplier and buyer are both in state ${vs} (intra-state), but IGST is charged. Expect CGST + SGST.`, { field: 'igst' });
      else if (vs !== bs && hasCs) add('error', 'tax_type', `Supplier state ${vs} and buyer state ${bs} differ (inter-state), but CGST/SGST is charged. Expect IGST.`, { field: 'cgst' });
      else if (hasIgst || hasCs) add('ok', 'tax_type', `${vs === bs ? 'Intra-state: CGST + SGST' : 'Inter-state: IGST'} is the right tax type.`);
    }
    if (hasCs && !near(F.cgst.value || 0, F.sgst.value || 0)) add('error', 'cgst_sgst', `CGST (${fmt(F.cgst.value)}) and SGST (${fmt(F.sgst.value)}) should be equal.`, { field: 'sgst' });
    const gstRate = hasIgst ? rate('igst') : round2(rate('cgst') + rate('sgst'));
    if ((hasIgst || hasCs) && ![0.1, 0.25, 1, 1.5, 3, 5, 6, 12, 18, 28, 40].some((r) => Math.abs(r - gstRate) < 0.05)) add('warn', 'tax_rate', `Effective GST rate is ${gstRate}% of the taxable value, which is not a standard GST slab (mixed rates or a wrong figure).`, { field: hasIgst ? 'igst' : 'cgst' });
    else if (hasIgst || hasCs) add('ok', 'tax_rate', `GST works out to ${gstRate}% of the taxable value.`);
  } else if (doc.country === 'GB' && F.vat.value !== null) {
    const r = rate('vat');
    if ([20, 5, 0].some((x) => Math.abs(x - r) < 0.05)) add('ok', 'tax_rate', `VAT is ${r}% of the net total.`);
    else add('warn', 'tax_rate', `VAT is ${r}% of the net total: check for mixed 20%/5%/0% lines.`, { field: 'vat' });
  } else if (doc.country === 'AU' && F.gst.value !== null) {
    const r = rate('gst');
    if (Math.abs(r - 10) < 0.06 || r === 0) add('ok', 'tax_rate', `GST is ${r}% of the subtotal.`);
    else add('warn', 'tax_rate', `GST is ${r}% of the subtotal, not 10%: check for GST-free lines.`, { field: 'gst' });
  }
  if (F.invoiceDate.value && F.dueDate.value && F.dueDate.value < F.invoiceDate.value) add('error', 'due_before', 'Due date is before the invoice date.', { field: 'dueDate' });
  if (!F.currency.value) add('warn', 'currency', 'Currency not detected: pick one before export.', { field: 'currency' });
  for (const [k, fld] of Object.entries(F)) if (fld && fld.conf > 0 && fld.conf < 0.75 && !fld.edited && !out.some((c) => c.field === k && c.level !== 'ok')) add('warn', 'low_conf', `${FIELD_LABELS[k] || k}: low confidence (${fld.how}). Please confirm.`, { field: k });
  return out;
}
export const FIELD_LABELS = { vendor: 'Vendor', vendorTaxId: 'Vendor tax ID', buyerTaxId: 'Buyer tax ID', invoiceNo: 'Invoice no.', invoiceDate: 'Invoice date', dueDate: 'Due date', poNo: 'PO no.', currency: 'Currency', subtotal: 'Subtotal', cgst: 'CGST', sgst: 'SGST', igst: 'IGST', vat: 'VAT', gst: 'GST', salesTax: 'Sales tax', freight: 'Freight', roundOff: 'Round-off', total: 'Total', terms: 'Terms' };
const fmt = (n) => (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ---------- duplicates ----------
const STOP = /\b(?:pvt|private|ltd|limited|inc|llc|llp|pty|plc|co|company|corp|corporation|the)\b\.?/gi;
export const normVendor = (s) => String(s || '').toLowerCase().replace(STOP, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
/** Pairs of documents that are the same bill (same vendor + invoice no.) or likely the same (same vendor, date and total). */
export function findDuplicates(docs) {
  const out = [];
  for (let i = 0; i < docs.length; i++) for (let j = i + 1; j < docs.length; j++) {
    const a = docs[i].fields, b = docs[j].fields;
    if (normVendor(a.vendor.value) !== normVendor(b.vendor.value) || !normVendor(a.vendor.value)) continue;
    if (a.invoiceNo.value && normalizeInvoiceNo(a.invoiceNo.value) === normalizeInvoiceNo(b.invoiceNo.value)) out.push({ a: i, b: j, reason: 'same vendor and invoice number' });
    else if (a.invoiceDate.value && a.invoiceDate.value === b.invoiceDate.value && a.total.value !== null && a.total.value === b.total.value) out.push({ a: i, b: j, reason: 'same vendor, date and total (different number)', level: 'warn' });
  }
  return out;
}

// ---------- purchase orders ----------
const tokens = (s) => new Set(String(s || '').toLowerCase().replace(/(\d)\s*x\s*(\d)/g, '$1x$2').split(/[^a-z0-9.]+/).filter((w) => w.length > 1 || /\d/.test(w)));
export function textSim(a, b) {
  const A = tokens(a), B = tokens(b); if (!A.size || !B.size) return 0;
  let n = 0; for (const t of A) if (B.has(t)) n++;
  return n / Math.min(A.size, B.size);
}
function bestVendorMatch(name, vendors) {
  let best = null;
  for (const v of vendors) { const s = normVendor(v) === normVendor(name) ? 1 : textSim(normVendor(v), normVendor(name)); if (!best || s > best.score) best = { name: v, score: s }; }
  return best;
}
const PO_ALIASES = {
  poNo: /^(po|p\.o\.|purchase order)\s*(no\.?|number|#)?$|^po_?number$/i, vendor: /^(vendor|supplier|party)(\s*name)?$/i, currency: /^(currency|cur)$/i,
  line: /^(line|line\s*no\.?|sr\.?)$/i, code: /^(item\s*code|code|sku|item\s*#|part\s*no\.?)$/i, description: /^(description|item|item\s*name|particulars)$/i,
  qtyOrdered: /^(qty\s*ordered|ordered|quantity|qty)$/i, qtyReceived: /^(qty\s*received|received|grn\s*qty|received\s*qty)$/i, unitPrice: /^(unit\s*price|rate|price|unit\s*cost)$/i,
};
/** Parse a PO lines CSV (one row per PO line). Unknown columns are ignored. */
export function parsePoCsv(text) {
  const rows = csvRows(text);
  const hi = rows.findIndex((r) => r.filter((c) => Object.values(PO_ALIASES).some((re) => re.test(String(c).trim()))).length >= 3);
  if (hi < 0) return { lines: [], errors: ['No PO header row found (need at least PO number, description/code, quantity, unit price).'] };
  const head = rows[hi].map((c) => String(c).trim()), map = {};
  for (const [k, re] of Object.entries(PO_ALIASES)) { const idx = head.findIndex((h) => re.test(h)); if (idx >= 0 && !Object.values(map).includes(idx)) map[k] = idx; }
  const errors = ['poNo', 'qtyOrdered', 'unitPrice'].filter((k) => map[k] === undefined).map((k) => `PO file: column for "${k}" not found.`);
  const lines = rows.slice(hi + 1).filter((r) => r.some((c) => String(c).trim())).map((r) => {
    const g = (k) => (map[k] === undefined ? '' : String(r[map[k]] ?? '').trim());
    const num = (k) => { const n = parseAmount(g(k)); return Number.isFinite(n) ? n : null; };
    return { poNo: g('poNo'), vendor: g('vendor'), currency: g('currency').toUpperCase(), line: g('line'), code: g('code'), description: g('description'), qtyOrdered: num('qtyOrdered'), qtyReceived: map.qtyReceived === undefined ? null : num('qtyReceived'), unitPrice: num('unitPrice') };
  }).filter((l) => l.poNo);
  return { lines, errors, hasReceived: map.qtyReceived !== undefined };
}

/**
 * Match an invoice to its PO. opts: { priceTolPct (default 0), qtyTol (default 0) }.
 * Returns { status: 'matched'|'mismatch'|'missing_po'|'unknown_po'|'no_po_file', flags: [...ids], issues: [{id, level, msg, line?}], pairs, suggestedPo }
 */
export function matchPo(doc, poLines, opts = {}) {
  const tolPct = opts.priceTolPct ?? 0, qtyTol = opts.qtyTol ?? 0;
  const F = doc.fields, issues = [], flags = new Set();
  const flag = (id, level, msg, extra = {}) => { if (level !== 'info') flags.add(id); issues.push({ id, level, msg, ...extra }); };
  if (!poLines?.length) return { status: 'no_po_file', flags: [], issues: [{ id: 'no_po_file', level: 'info', msg: 'Load a PO file to run the PO match.' }], pairs: [] };
  const byPo = new Map(); for (const l of poLines) { const k = normalizeInvoiceNo(l.poNo); if (!byPo.has(k)) byPo.set(k, []); byPo.get(k).push(l); }
  const total = F.total.value || 0;
  const suggest = () => {
    let best = null;
    for (const [, ls] of byPo) {
      const vs = textSim(normVendor(ls[0].vendor), normVendor(F.vendor.value));
      if (vs < 0.6 || (ls[0].currency && F.currency.value && ls[0].currency !== F.currency.value)) continue;
      const lineScore = doc.lines.length ? doc.lines.filter((il) => ls.some((pl) => (il.code && pl.code && il.code === pl.code) || textSim(il.description, pl.description) >= 0.6)).length / doc.lines.length : 0;
      const s = vs + lineScore; if (!best || s > best.s) best = { s, po: ls[0].poNo };
    }
    return best?.po || '';
  };
  if (!F.poNo.value) {
    const sug = suggest();
    flag('missing_po', 'error', `No PO number on the invoice.${sug ? ` Open PO ${sug} from the same vendor matches its lines: confirm and enter it.` : ' No open PO from this vendor matches.'}`, { field: 'poNo' });
    return { status: 'missing_po', flags: [...flags], issues, pairs: [], suggestedPo: sug };
  }
  const po = byPo.get(normalizeInvoiceNo(F.poNo.value));
  if (!po) { const sug = suggest(); flag('unknown_po', 'error', `PO ${F.poNo.value} is not in the PO file.${sug ? ` Closest open PO from this vendor: ${sug}.` : ''}`, { field: 'poNo' }); return { status: 'unknown_po', flags: [...flags], issues, pairs: [], suggestedPo: sug }; }
  if (po[0].vendor && textSim(normVendor(po[0].vendor), normVendor(F.vendor.value)) < 0.6) flag('vendor_mismatch', 'error', `PO ${F.poNo.value} is for "${po[0].vendor}", not "${F.vendor.value}".`, { field: 'vendor' });
  if (po[0].currency && F.currency.value && po[0].currency !== F.currency.value) flag('currency_mismatch', 'error', `PO currency ${po[0].currency} differs from invoice currency ${F.currency.value}.`, { field: 'currency' });
  const free = new Set(po.map((_, i) => i)), pairs = [];
  doc.lines.forEach((il, i) => {
    let bi = -1, bs = 0;
    for (const j of free) { const pl = po[j]; const s = il.code && pl.code ? (il.code.toUpperCase() === pl.code.toUpperCase() ? 2 : 0) : textSim(il.description, pl.description); if (s > bs) { bs = s; bi = j; } }
    if (bi < 0 || bs < 0.5) { flag('line_not_on_po', 'error', `Line ${i + 1} "${il.description}" is not on PO ${F.poNo.value}.`, { line: i }); pairs.push({ inv: i, po: null }); return; }
    free.delete(bi); const pl = po[bi]; const p = { inv: i, po: bi, poLine: pl, issues: [] };
    if (pl.unitPrice !== null && il.rate !== null && Math.abs(il.rate - pl.unitPrice) > Math.max(0.005, (pl.unitPrice * tolPct) / 100)) {
      const impact = round2((il.rate - pl.unitPrice) * (il.qty || 0));
      flag('price_diff', 'error', `Line ${i + 1}: billed at ${fmt(il.rate)}, PO price ${fmt(pl.unitPrice)} (${impact > 0 ? 'over' : 'under'} by ${fmt(Math.abs(impact))} on ${il.qty}).`, { line: i, impact }); p.issues.push('price_diff');
    }
    if (pl.qtyOrdered !== null && il.qty !== null && il.qty > pl.qtyOrdered + qtyTol) { flag('qty_over_po', 'error', `Line ${i + 1}: billed ${il.qty}, PO ordered ${pl.qtyOrdered} (${il.qty - pl.qtyOrdered} extra).`, { line: i, impact: round2((il.qty - pl.qtyOrdered) * (il.rate || 0)) }); p.issues.push('qty_over_po'); }
    else if (pl.qtyReceived !== null && il.qty !== null && il.qty > pl.qtyReceived + qtyTol) { flag('qty_over_received', 'error', `Line ${i + 1}: billed ${il.qty}, only ${pl.qtyReceived} received so far (3-way check).`, { line: i, impact: round2((il.qty - pl.qtyReceived) * (il.rate || 0)) }); p.issues.push('qty_over_received'); }
    else if (pl.qtyOrdered !== null && il.qty !== null && il.qty < pl.qtyOrdered) issues.push({ id: 'partial', level: 'info', msg: `Line ${i + 1}: part-billed (${il.qty} of ${pl.qtyOrdered}).`, line: i });
    pairs.push(p);
  });
  for (const j of free) issues.push({ id: 'po_line_not_billed', level: 'info', msg: `PO line ${po[j].line || j + 1} "${po[j].description}" (${po[j].qtyOrdered}) is not on this invoice.` });
  const variance = round2(issues.reduce((s, x) => s + (x.impact > 0 ? x.impact : 0), 0));
  if (!flags.size) issues.unshift({ id: 'matched', level: 'ok', msg: `All ${doc.lines.length} lines agree with PO ${F.poNo.value} on item, quantity and price.` });
  return { status: flags.size ? 'mismatch' : 'matched', flags: [...flags], issues, pairs, variance, poNo: F.poNo.value, total };
}

/** Serialisable summary of a document (used for golden tests and the review table). */
export function summary(doc) {
  const F = doc.fields, val = (k) => F[k]?.value ?? null;
  const taxes = {}; for (const k of TAX_KEYS) if (val(k) !== null) taxes[k] = val(k);
  return {
    file: doc.file, country: doc.country, vendor: val('vendor'), vendorTaxId: val('vendorTaxId') || '', buyerTaxId: val('buyerTaxId') || '', invoiceNo: val('invoiceNo'), invoiceDate: val('invoiceDate'), dueDate: val('dueDate'), poNo: val('poNo') || '', currency: val('currency'),
    subtotal: val('subtotal'), taxes, freight: val('freight') ?? 0, roundOff: val('roundOff') ?? 0, total: val('total'),
    lines: doc.lines.map((l) => ({ code: l.code || '', description: l.description, hsn: l.hsn || '', qty: l.qty, rate: l.rate, amount: l.amount })),
  };
}
export const confBand = (c) => (c >= 0.85 ? 'hi' : c >= 0.6 ? 'med' : c > 0 ? 'lo' : 'miss');
