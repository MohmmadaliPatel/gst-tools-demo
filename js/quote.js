// Quotation / proforma engine: line maths, GST split, totals, amount in words, quote register follow-ups. No dependencies.
export const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/** item: {name, hsn, unit, rate, gst, basis:'unit'|'kg', kgPerUnit, cbmPerUnit}; line: {qty, disc} */
export function computeLine(item, qty, disc = 0) {
  const q = Number(qty) || 0;
  if (q < 0) throw new Error(`Quantity can't be negative for ${item.name}`);
  const d = Math.min(Math.max(Number(disc) || 0, 0), 100);
  const weight = item.basis === 'kg' ? r2(q * (Number(item.kgPerUnit) || 0)) : null;
  const gross = r2((item.basis === 'kg' ? weight : q) * (Number(item.rate) || 0));
  const discount = r2(gross * d / 100);
  const taxable = r2(gross - discount);
  const gst = Number(item.gst) || 0;
  const tax = r2(taxable * gst / 100);
  const cbm = item.cbmPerUnit ? r2(q * Number(item.cbmPerUnit)) : 0;
  return { name: item.name, hsn: item.hsn || '', unit: item.unit || 'Nos', qty: q, rate: Number(item.rate) || 0, basis: item.basis || 'unit', weight, gross, discPct: d, discount, taxable, gst, tax, cbm, total: r2(taxable + tax) };
}

/** opts: {sellerState, buyerState, export:boolean, freight, freightGst} */
export function computeQuote(lines, opts = {}) {
  const ls = lines.map((l) => computeLine(l.item, l.qty, l.disc));
  const freight = r2(Number(opts.freight) || 0);
  const freightTax = opts.export ? 0 : r2(freight * (Number(opts.freightGst ?? 18)) / 100);
  const taxable = r2(ls.reduce((s, l) => s + l.taxable, 0) + freight);
  const taxRaw = opts.export ? 0 : r2(ls.reduce((s, l) => s + l.tax, 0) + freightTax);
  const intra = !opts.export && String(opts.sellerState || '').trim() !== '' && String(opts.sellerState).trim() === String(opts.buyerState || '').trim();
  const cgst = intra ? r2(taxRaw / 2) : 0;
  const sgst = intra ? r2(taxRaw - cgst) : 0;
  const igst = intra ? 0 : taxRaw;
  const exact = r2(taxable + taxRaw);
  const grand = Math.round(exact);
  const weight = r2(ls.reduce((s, l) => s + (l.weight || 0), 0));
  const cbm = r2(ls.reduce((s, l) => s + (l.cbm || 0), 0));
  // Usable load volume: ~28 CBM for a 20' container, ~58 CBM for 40' (common planning figures; real loadability depends on cartons).
  const fill20 = cbm ? Math.round(cbm / 28 * 100) : 0;
  const fill40 = cbm ? Math.round(cbm / 58 * 100) : 0;
  return { lines: ls, freight, freightTax, taxable, tax: taxRaw, cgst, sgst, igst, intra, roundOff: r2(grand - exact), grand, weight, cbm, fill20, fill40, words: amountInWords(grand) };
}

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
function two(n) { return n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? ' ' + ONES[n % 10] : ''}`; }
function three(n) { const h = Math.floor(n / 100), r = n % 100; return [h ? `${ONES[h]} Hundred` : '', r ? two(r) : ''].filter(Boolean).join(' '); }
/** Indian numbering (lakh/crore), whole rupees. */
export function amountInWords(n, currency = 'Rupees') {
  let x = Math.round(Math.abs(Number(n) || 0));
  if (x === 0) return `${currency} Zero Only`;
  const parts = [];
  const crore = Math.floor(x / 1e7); x %= 1e7;
  const lakh = Math.floor(x / 1e5); x %= 1e5;
  const th = Math.floor(x / 1e3); x %= 1e3;
  if (crore) parts.push(`${crore >= 100 ? amountInWords(crore, '').replace(/ Only$/, '').trim() : two(crore)} Crore`);
  if (lakh) parts.push(`${two(lakh)} Lakh`);
  if (th) parts.push(`${two(th)} Thousand`);
  if (x) parts.push(three(x));
  return `${currency} ${parts.join(' ')} Only`.replace(/\s+/g, ' ').trim();
}

/** Financial-year quote numbers: Q/2026-27/0001. fy starts 1 April. */
export function fyLabel(date) {
  const d = new Date(date); const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
  return `${y}-${String((y + 1) % 100).padStart(2, '0')}`;
}
export function nextQuoteNo(register, date, prefix = 'Q') {
  const fy = fyLabel(date);
  const nums = register.filter((r) => r.no.startsWith(`${prefix}/${fy}/`)).map((r) => Number(r.no.split('/').pop()) || 0);
  return `${prefix}/${fy}/${String((nums.length ? Math.max(...nums) : 0) + 1).padStart(4, '0')}`;
}

const day = (s) => Math.floor(new Date(`${s}T00:00:00Z`).getTime() / 864e5);
/** register rows: {no, client, date, amount, status:'Sent'|'Won'|'Lost', followUp:'YYYY-MM-DD'} */
export function followUpQueue(register, today) {
  return register
    .filter((r) => r.status === 'Sent')
    .map((r) => ({ ...r, daysOpen: day(today) - day(r.date), overdueBy: r.followUp ? day(today) - day(r.followUp) : null }))
    .filter((r) => r.overdueBy !== null && r.overdueBy >= 0)
    .sort((a, b) => b.overdueBy - a.overdueBy || b.amount - a.amount);
}
export function winRate(register) {
  const closed = register.filter((r) => r.status === 'Won' || r.status === 'Lost');
  return closed.length ? Math.round(closed.filter((r) => r.status === 'Won').length / closed.length * 100) : null;
}
