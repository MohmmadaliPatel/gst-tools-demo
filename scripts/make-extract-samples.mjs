// Generates the synthetic supplier invoices (text PDFs), purchase orders and golden expected results
// for extract.html. Every company, tax ID and amount is invented. No dependencies: a tiny PDF writer
// using the built-in Helvetica fonts. Run: node scripts/make-extract-samples.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { makeGstin } from '../js/gst.js';

const OUT = new URL('../samples/extract/', import.meta.url);
mkdirSync(OUT, { recursive: true });

// ---------- minimal PDF writer ----------
// Helvetica advance widths (1/1000 em) for ASCII 32..126, from the standard 14-font metrics.
const HW = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
const textWidth = (s, size, bold) => [...s].reduce((w, ch) => { const c = ch.charCodeAt(0); return w + (c >= 32 && c <= 126 ? HW[c - 32] : 556) * (bold ? 1.04 : 1); }, 0) * size / 1000;
const esc = (s) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
const f2 = (n) => (Math.round(n * 100) / 100).toString();

class Page {
  constructor() { this.ops = []; }
  text(x, y, s, { size = 9, bold = false, align = 'left', gray = 0 } = {}) {
    s = String(s);
    const w = textWidth(s, size, bold);
    const x0 = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
    this.ops.push(`BT ${gray} g /${bold ? 'F2' : 'F1'} ${size} Tf 1 0 0 1 ${f2(x0)} ${f2(y)} Tm (${esc(s)}) Tj ET`);
    return this;
  }
  line(x1, y1, x2, y2, w = 0.6, gray = 0) { this.ops.push(`${gray} G ${w} w ${f2(x1)} ${f2(y1)} m ${f2(x2)} ${f2(y2)} l S`); return this; }
  box(x, y, w, h, fill = 0.92) { this.ops.push(`${fill} g ${f2(x)} ${f2(y)} ${f2(w)} ${f2(h)} re f 0 g`); return this; }
  frame(x, y, w, h, lw = 0.6) { this.ops.push(`0 G ${lw} w ${f2(x)} ${f2(y)} ${f2(w)} ${f2(h)} re S`); return this; }
}

function buildPdf(pages, title) {
  const objs = [];
  const add = (s) => { objs.push(s); return objs.length; };
  const catalog = add(null), pagesId = add(null);
  const f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const f2b = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  const kids = [];
  for (const p of pages) {
    const body = Buffer.from(p.ops.join('\n'), 'latin1');
    const c = add(`<< /Length ${body.length} >>\nstream\n${body.toString('latin1')}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2b} 0 R >> >> /Contents ${c} 0 R >>`));
  }
  objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objs[pagesId - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;
  const info = add(`<< /Title (${esc(title)}) /Producer (synthetic sample generator) /CreationDate (D:20261026000000Z) >>`);
  let out = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
  const offs = [];
  objs.forEach((o, i) => { offs.push(Buffer.byteLength(out, 'latin1')); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

// ---------- money helpers ----------
const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const inGroup = (n) => { const [i, d] = Math.abs(n).toFixed(2).split('.'); const last3 = i.slice(-3), rest = i.slice(0, -3); return (n < 0 ? '-' : '') + (rest ? rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' : '') + last3 + '.' + d; };
const wGroup = (n) => (n < 0 ? '-' : '') + Math.abs(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const LMON = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const parts = (iso) => iso.split('-').map(Number);
const dmy = (iso, sep = '/') => { const [y, m, d] = parts(iso); return `${String(d).padStart(2, '0')}${sep}${String(m).padStart(2, '0')}${sep}${y}`; };
const mdy = (iso) => { const [y, m, d] = parts(iso); return `${String(m).padStart(2, '0')}/${String(d).padStart(2, '0')}/${y}`; };
const dMonY = (iso) => { const [y, m, d] = parts(iso); return `${String(d).padStart(2, '0')}-${MON[m - 1]}-${y}`; };
const longD = (iso) => { const [y, m, d] = parts(iso); return `${d} ${LMON[m - 1]} ${y}`; };

// ---------- synthetic parties (fictional; GSTINs are checksum-valid but made up) ----------
const BUYER_IN = { name: 'Demo Traders Pvt Ltd', gstin: makeGstin('27', 'AAECD0001K'), addr: 'Unit 4, Sample Industrial Estate, Pune, Maharashtra 411019' };
const V = {
  sahyadri: { name: 'Sahyadri Packaging Pvt Ltd', gstin: makeGstin('27', 'AAKCS7310R'), addr: ['Plot 18, MIDC Phase 2, Chakan', 'Pune, Maharashtra 410501'] },
  kaveri: { name: 'Kaveri Electricals', gstin: makeGstin('29', 'AAPFK2468M'), addr: ['No. 42, 3rd Cross, Peenya 2nd Stage', 'Bengaluru, Karnataka 560058'] },
  bayline: { name: 'Bayline Packaging Supply Inc.', addr: ['2200 Harbor Ave, Suite 4', 'Oakport, CA 94000'], ein: '00-0000417' },
  hartwell: { name: 'Hartwell Fixings Ltd', addr: ['Unit 7 Canal Side Works', 'Northby NB1 2ZZ'], vat: 'GB 000 4417 21' },
  southern: { name: 'Southern Cross Office Co Pty Ltd', addr: ['Level 2, 15 Example Street', 'Gosford NSW 2250'], abn: '00 417 226 318' },
};

// ---------- invoice definitions (ground truth) ----------
const invoices = [
  {
    file: 'in_sahyadri_gst_cgst_sgst.pdf', layout: 'in-classic', country: 'IN', vendor: V.sahyadri.name, vendorTaxId: V.sahyadri.gstin, buyerTaxId: BUYER_IN.gstin,
    invoiceNo: 'SPP/26-27/0412', invoiceDate: '2026-10-03', dueDate: '2026-11-02', poNo: 'PO-IN-2041', currency: 'INR',
    lines: [
      { code: '', desc: 'Corrugated box 5-ply 18x12x10 in', hsn: '4819', qty: 500, unit: 'Nos', rate: 38.5, taxRate: 18 },
      { code: '', desc: 'BOPP tape 48mm x 65m brown', hsn: '3919', qty: 240, unit: 'Rol', rate: 42, taxRate: 18 },
      { code: '', desc: 'Stretch film 18 in 23 micron', hsn: '3920', qty: 60, unit: 'Rol', rate: 315, taxRate: 18 },
    ],
    tax: 'cgst_sgst', freight: 0,
  },
  {
    file: 'in_kaveri_gst_igst.pdf', layout: 'in-modern', country: 'IN', vendor: V.kaveri.name, vendorTaxId: V.kaveri.gstin, buyerTaxId: BUYER_IN.gstin,
    invoiceNo: 'KE-2026-1187', invoiceDate: '2026-10-12', dueDate: '2026-11-11', poNo: 'PO-IN-2047', currency: 'INR',
    lines: [
      { code: '', desc: 'Modular switch 6A white', hsn: '85365090', qty: 120, unit: 'Nos', rate: 64, taxRate: 18 },
      { code: '', desc: 'FR PVC wire 1.5 sq mm 90 m coil', hsn: '85444999', qty: 25, unit: 'Coil', rate: 1460, taxRate: 18 },
      { code: '', desc: 'MCB 32A double pole', hsn: '85362030', qty: 40, unit: 'Nos', rate: 389, taxRate: 18 },
    ],
    tax: 'igst', freight: 0,
  },
  {
    file: 'us_bayline_sales_tax.pdf', layout: 'us', country: 'US', vendor: V.bayline.name, vendorTaxId: '',
    invoiceNo: '104377', invoiceDate: '2026-10-05', dueDate: '2026-11-04', poNo: 'PO-US-7781', currency: 'USD', terms: 'Net 30',
    lines: [
      { code: 'CLM-1612', desc: 'Clamshell container 6 x 6 in, case of 250', qty: 40, unit: 'CS', rate: 31.8, taxRate: 0 },
      { code: 'LID-0408', desc: 'Deli lid 8 oz clear, case of 500', qty: 25, unit: 'CS', rate: 4.35, taxRate: 0 },
      { code: 'BAG-1420', desc: 'Kraft carry bag 14 x 20, bundle of 100', qty: 60, unit: 'BD', rate: 12.9, taxRate: 0 },
    ],
    tax: 'us_sales', salesTaxRate: 0, freight: 85, // resale purchase: no sales tax, freight billed
  },
  {
    file: 'uk_hartwell_vat.pdf', layout: 'uk', country: 'GB', vendor: V.hartwell.name, vendorTaxId: V.hartwell.vat,
    invoiceNo: 'HF-30918', invoiceDate: '2026-10-07', dueDate: '2026-11-06', poNo: 'PO-UK-3310', currency: 'GBP',
    lines: [
      { code: 'M8-50-ZP', desc: 'Hex bolt M8 x 50 zinc, box of 100', qty: 12, unit: 'Box', rate: 14.6, taxRate: 20 },
      { code: 'WA-M8', desc: 'Flat washer M8, box of 500', qty: 6, unit: 'Box', rate: 9.25, taxRate: 20 },
      { code: 'AN-M10-120', desc: 'Through-bolt anchor M10 x 120, box of 50', qty: 4, unit: 'Box', rate: 38.4, taxRate: 20 },
    ],
    tax: 'vat', freight: 0,
  },
  {
    file: 'au_southern_cross_gst.pdf', layout: 'au', country: 'AU', vendor: V.southern.name, vendorTaxId: V.southern.abn,
    invoiceNo: 'SC-58213', invoiceDate: '2026-10-14', dueDate: '2026-10-28', poNo: '', currency: 'AUD', terms: '14 days',
    lines: [
      { code: '', desc: 'A4 copy paper 80gsm, carton of 5 reams', qty: 10, unit: 'CTN', rate: 34.5, taxRate: 10 },
      { code: '', desc: 'Toner cartridge TN-2450 compatible', qty: 4, unit: 'EA', rate: 72, taxRate: 10 },
      { code: '', desc: 'Archive box with lid', qty: 30, unit: 'EA', rate: 3.9, taxRate: 10 },
    ],
    tax: 'au_gst', freight: 0,
  },
];
// A re-sent copy of the Bayline invoice (same number): should be flagged as a duplicate.
invoices.push({ ...invoices[2], file: 'us_bayline_resent_copy.pdf', stamp: 'COPY - RESENT' });

function compute(inv) {
  for (const l of inv.lines) l.amount = r2(l.qty * l.rate);
  inv.subtotal = r2(inv.lines.reduce((s, l) => s + l.amount, 0));
  const taxBase = inv.subtotal;
  inv.taxes = {};
  if (inv.tax === 'cgst_sgst') { inv.taxes.cgst = r2(taxBase * 0.09); inv.taxes.sgst = r2(taxBase * 0.09); }
  else if (inv.tax === 'igst') inv.taxes.igst = r2(taxBase * 0.18);
  else if (inv.tax === 'vat') inv.taxes.vat = r2(taxBase * 0.2);
  else if (inv.tax === 'au_gst') inv.taxes.gst = r2(taxBase * 0.1);
  else if (inv.tax === 'us_sales') inv.taxes.salesTax = r2(taxBase * (inv.salesTaxRate || 0) / 100);
  inv.taxTotal = r2(Object.values(inv.taxes).reduce((s, v) => s + v, 0));
  const raw = r2(inv.subtotal + inv.taxTotal + (inv.freight || 0));
  inv.roundOff = inv.country === 'IN' ? r2(Math.round(raw) - raw) : 0;
  inv.total = r2(raw + inv.roundOff);
}
invoices.forEach(compute);

// ---------- layouts ----------
function inClassic(inv) {
  const p = new Page(), v = V.sahyadri;
  p.text(297, 800, 'TAX INVOICE', { size: 13, bold: true, align: 'center' });
  p.text(40, 772, v.name, { size: 15, bold: true });
  p.text(40, 757, v.addr[0]); p.text(40, 745, v.addr[1]);
  p.text(40, 731, `GSTIN: ${v.gstin}`, { bold: true }); p.text(40, 719, 'State: Maharashtra (27)');
  p.text(360, 772, `Invoice No: ${inv.invoiceNo}`, { bold: true });
  p.text(360, 758, `Invoice Date: ${dMonY(inv.invoiceDate)}`);
  p.text(360, 744, `Due Date: ${dMonY(inv.dueDate)}`);
  p.text(360, 730, `Buyer's Order No: ${inv.poNo}`);
  p.text(360, 716, 'Place of Supply: Maharashtra (27)');
  p.line(40, 706, 555, 706);
  p.text(40, 692, 'Bill To:', { bold: true }); p.text(40, 679, BUYER_IN.name); p.text(40, 667, BUYER_IN.addr);
  p.text(40, 655, `GSTIN: ${BUYER_IN.gstin}`);
  const cols = [[44, 'Sr', 'l'], [70, 'Description of Goods', 'l'], [300, 'HSN/SAC', 'l'], [385, 'Qty', 'r'], [402, 'Unit', 'l'], [470, 'Rate', 'r'], [551, 'Taxable Value', 'r']];
  let y = 630; p.box(40, y - 4, 515, 16);
  for (const [x, h, a] of cols) p.text(x, y, h, { bold: true, align: a === 'r' ? 'right' : 'left' });
  y -= 20;
  inv.lines.forEach((l, i) => {
    const vals = [String(i + 1), l.desc, l.hsn, String(l.qty), l.unit, inGroup(l.rate), inGroup(l.amount)];
    cols.forEach(([x, , a], k) => p.text(x, y, vals[k], { align: a === 'r' ? 'right' : 'left' }));
    y -= 16;
  });
  p.line(40, y + 6, 555, y + 6); y -= 12;
  const tot = [['Total Taxable Value', inv.subtotal], ['CGST @ 9%', inv.taxes.cgst], ['SGST @ 9%', inv.taxes.sgst], ['Round Off', inv.roundOff]];
  for (const [k, n] of tot) { p.text(380, y, k); p.text(551, y, inGroup(n), { align: 'right' }); y -= 15; }
  p.line(370, y + 10, 555, y + 10);
  p.text(380, y - 4, 'Grand Total (Rs.)', { bold: true }); p.text(551, y - 4, inGroup(inv.total), { bold: true, align: 'right' });
  y -= 34;
  p.text(40, y, 'Amount in words: INR ' + words(inv.total) + ' only'); y -= 14;
  p.text(40, y, 'Terms: payment within 30 days of invoice date. Interest @ 18% p.a. on overdue bills.', { size: 8 });
  p.text(40, 90, 'This is a computer generated invoice. Synthetic sample data for a demo.', { size: 7, gray: 0.4 });
  p.text(555, 120, `For ${v.name}`, { align: 'right' }); p.text(555, 92, 'Authorised Signatory', { align: 'right', size: 8 });
  return [p];
}

function inModern(inv) {
  // Labels on the right with values below them; IGST shown per line; two pages (totals on page 2).
  const p = new Page(), p2 = new Page(), v = V.kaveri;
  p.box(0, 780, 595, 62, 0.18);
  p.text(40, 805, v.name.toUpperCase(), { size: 16, bold: true, gray: 1 });
  p.text(40, 789, `${v.addr[0]}, ${v.addr[1]}`, { size: 8, gray: 1 });
  p.text(555, 805, 'Tax Invoice', { size: 14, bold: true, gray: 1, align: 'right' });
  const lab = [[330, 'Invoice #'], [430, 'Date'], [500, 'PO Ref']];
  for (const [x, t] of lab) p.text(x, 755, t, { size: 8, gray: 0.35 });
  p.text(330, 742, inv.invoiceNo, { bold: true }); p.text(430, 742, dmy(inv.invoiceDate)); p.text(500, 742, inv.poNo);
  p.text(330, 722, 'Payment Due', { size: 8, gray: 0.35 }); p.text(330, 709, dmy(inv.dueDate));
  p.text(40, 755, 'Supplier GSTIN', { size: 8, gray: 0.35 }); p.text(40, 742, v.gstin, { bold: true });
  p.text(40, 722, 'Billed to', { size: 8, gray: 0.35 }); p.text(40, 709, BUYER_IN.name); p.text(40, 697, `GSTIN ${BUYER_IN.gstin}`);
  p.text(40, 685, 'Place of supply: 27-Maharashtra (inter-state supply)');
  const cols = [[40, 'Item & Description', 'l'], [262, 'HSN', 'l'], [355, 'Qty', 'r'], [420, 'Rate', 'r'], [470, 'IGST %', 'r'], [555, 'Amount', 'r']];
  let y = 655; p.line(40, y + 12, 555, y + 12, 1.2);
  for (const [x, h, a] of cols) p.text(x, y, h, { bold: true, size: 8.5, align: a === 'r' ? 'right' : 'left' });
  p.line(40, y - 6, 555, y - 6, 0.4); y -= 22;
  for (const l of inv.lines) {
    const vals = [l.desc, l.hsn, `${l.qty} ${l.unit}`, inGroup(l.rate), '18', inGroup(l.amount)];
    cols.forEach(([x, , a], k) => p.text(x, y, vals[k], { align: a === 'r' ? 'right' : 'left' }));
    y -= 18;
  }
  p.text(297, 60, 'Continued on page 2', { size: 8, align: 'center', gray: 0.4 });
  p.text(40, 40, 'Synthetic sample data for a demo. Page 1 of 2', { size: 7, gray: 0.4 });
  let y2 = 780;
  p2.text(40, 800, `${v.name} - Invoice ${inv.invoiceNo} (continued)`, { size: 9, bold: true });
  const rows = [['Sub Total', inv.subtotal], ['IGST 18%', inv.taxes.igst], ['Rounding', inv.roundOff]];
  for (const [k, n] of rows) { p2.text(360, y2, k); p2.text(555, y2, inGroup(n), { align: 'right' }); y2 -= 16; }
  p2.box(350, y2 - 6, 205, 20, 0.9);
  p2.text(360, y2, 'Balance Due  INR', { bold: true }); p2.text(555, y2, inGroup(inv.total), { bold: true, align: 'right' });
  p2.text(40, y2 - 40, 'Bank: Sample Bank Ltd, A/c 000000000000, IFSC SMPL0000001 (dummy)', { size: 8 });
  p2.text(40, 40, 'Synthetic sample data for a demo. Page 2 of 2', { size: 7, gray: 0.4 });
  return [p, p2];
}

function us(inv) {
  const p = new Page(), v = V.bayline;
  p.text(40, 790, v.name, { size: 17, bold: true });
  p.text(40, 774, v.addr[0]); p.text(40, 762, v.addr[1]);
  p.text(555, 790, 'INVOICE', { size: 20, bold: true, align: 'right' });
  if (inv.stamp) p.text(555, 768, inv.stamp, { size: 11, bold: true, align: 'right', gray: 0.45 });
  // label row then value row (values sit under their labels)
  const hdr = [[40, 'Invoice Number'], [150, 'Invoice Date'], [250, 'Due Date'], [345, 'Terms'], [430, 'P.O. Number']];
  p.box(36, 722, 523, 16);
  for (const [x, t] of hdr) p.text(x, 727, t, { bold: true, size: 8.5 });
  const vals = [inv.invoiceNo, mdy(inv.invoiceDate), mdy(inv.dueDate), inv.terms, inv.poNo];
  hdr.forEach(([x], i) => p.text(x, 708, vals[i]));
  p.text(40, 680, 'Bill To', { bold: true }); p.text(40, 667, 'Demo Foodservice Distributors LLC'); p.text(40, 655, '500 Sample Blvd, Testville, CA 90000');
  p.text(320, 680, 'Ship To', { bold: true }); p.text(320, 667, 'Warehouse 2, 510 Sample Blvd'); p.text(320, 655, 'Testville, CA 90000');
  const cols = [[40, 'Item #', 'l'], [110, 'Description', 'l'], [390, 'Qty', 'r'], [400, 'U/M', 'l'], [480, 'Unit Price', 'r'], [555, 'Amount', 'r']];
  let y = 620; p.line(36, y + 13, 559, y + 13); p.line(36, y - 5, 559, y - 5);
  for (const [x, h, a] of cols) p.text(x, y, h, { bold: true, align: a === 'r' ? 'right' : 'left' });
  y -= 20;
  for (const l of inv.lines) {
    const vv = [l.code, l.desc, String(l.qty), l.unit, wGroup(l.rate), wGroup(l.amount)];
    cols.forEach(([x, , a], k) => p.text(x, y, vv[k], { align: a === 'r' ? 'right' : 'left' }));
    y -= 16;
  }
  y -= 10;
  const rows = [['Subtotal', inv.subtotal], ['Freight', inv.freight], ['Sales Tax (resale - exempt)', inv.taxes.salesTax]];
  for (const [k, n] of rows) { p.text(470, y, k, { align: 'right' }); p.text(555, y, '$' + wGroup(n), { align: 'right' }); y -= 15; }
  p.text(470, y - 3, 'Total Due (USD)', { bold: true, align: 'right' }); p.text(555, y - 3, '$' + wGroup(inv.total), { bold: true, align: 'right' });
  p.text(40, 150, 'Resale certificate on file. Please reference the invoice number with your remittance.', { size: 8 });
  p.text(40, 60, 'Synthetic sample data for a demo.', { size: 7, gray: 0.4 });
  return [p];
}

function uk(inv) {
  const p = new Page(), v = V.hartwell;
  p.text(40, 795, 'Invoice', { size: 22, bold: true });
  p.text(555, 800, v.name, { size: 12, bold: true, align: 'right' });
  p.text(555, 786, v.addr[0], { align: 'right' }); p.text(555, 774, v.addr[1], { align: 'right' });
  p.text(555, 760, `VAT Reg No: ${v.vat}`, { align: 'right' }); p.text(555, 748, 'Company No: 00004417 (fictional)', { align: 'right', size: 8 });
  p.text(40, 750, 'Invoice to', { bold: true }); p.text(40, 737, 'Demo Facilities Ltd'); p.text(40, 725, '1 Sample Road, Testford TF1 1AA');
  const meta = [['Invoice number', inv.invoiceNo], ['Tax point / Invoice date', longD(inv.invoiceDate)], ['Your order ref', inv.poNo], ['Payment due', longD(inv.dueDate)]];
  let y = 700;
  for (const [k, val] of meta) { p.text(40, y, k, { gray: 0.35 }); p.text(175, y, val, { bold: true }); y -= 14; }
  const cols = [[40, 'Code', 'l'], [110, 'Description', 'l'], [360, 'Qty', 'r'], [425, 'Price', 'r'], [475, 'VAT %', 'r'], [555, 'Net', 'r']];
  y = 625; p.frame(36, 300, 523, 340);
  for (const [x, h, a] of cols) p.text(x, y, h, { bold: true, align: a === 'r' ? 'right' : 'left' });
  p.line(36, y - 6, 559, y - 6); y -= 22;
  for (const l of inv.lines) {
    const vv = [l.code, l.desc, String(l.qty), wGroup(l.rate), '20', wGroup(l.amount)];
    cols.forEach(([x, , a], k) => p.text(x, y, vv[k], { align: a === 'r' ? 'right' : 'left' }));
    y -= 16;
  }
  const rows = [['Net total', inv.subtotal], ['VAT @ 20%', inv.taxes.vat]];
  y = 270;
  for (const [k, n] of rows) { p.text(400, y, k); p.text(555, y, '\xA3' + wGroup(n), { align: 'right' }); y -= 15; }
  p.text(400, y - 2, 'Invoice total', { bold: true }); p.text(555, y - 2, '\xA3' + wGroup(inv.total), { bold: true, align: 'right' });
  p.text(40, 200, 'Bank transfer: Sample Bank, sort code 00-00-00, account 00000000 (dummy).', { size: 8 });
  p.text(40, 60, 'Synthetic sample data for a demo.', { size: 7, gray: 0.4 });
  return [p];
}

function au(inv) {
  const p = new Page(), v = V.southern;
  p.text(40, 800, 'TAX INVOICE', { size: 18, bold: true });
  p.text(40, 778, v.name, { size: 12, bold: true });
  p.text(40, 765, `ABN ${v.abn}`); p.text(40, 753, `${v.addr[0]}, ${v.addr[1]}`);
  p.text(380, 800, 'Invoice No.', { gray: 0.35 }); p.text(470, 800, inv.invoiceNo, { bold: true });
  p.text(380, 786, 'Date', { gray: 0.35 }); p.text(470, 786, dmy(inv.invoiceDate));
  p.text(380, 772, 'Terms', { gray: 0.35 }); p.text(470, 772, inv.terms);
  p.text(380, 758, 'Customer ref', { gray: 0.35 }); p.text(470, 758, 'Office supplies Oct');
  p.text(40, 725, 'Bill to: Demo Logistics Pty Ltd, 9 Sample Parade, Testvale NSW 2000');
  const cols = [[40, 'Description', 'l'], [330, 'Qty', 'r'], [400, 'Unit Price', 'r'], [470, 'GST', 'r'], [555, 'Amount', 'r']];
  let y = 690; p.box(36, y - 5, 523, 17, 0.88);
  for (const [x, h, a] of cols) p.text(x, y, h, { bold: true, align: a === 'r' ? 'right' : 'left' });
  y -= 22;
  for (const l of inv.lines) {
    const vv = [l.desc, String(l.qty), wGroup(l.rate), wGroup(r2(l.amount * 0.1)), wGroup(l.amount)];
    cols.forEach(([x, , a], k) => p.text(x, y, vv[k], { align: a === 'r' ? 'right' : 'left' }));
    y -= 16;
  }
  y -= 14;
  const rows = [['Subtotal (ex GST)', inv.subtotal], ['GST 10%', inv.taxes.gst]];
  for (const [k, n] of rows) { p.text(380, y, k); p.text(555, y, wGroup(n), { align: 'right' }); y -= 15; }
  p.text(380, y - 2, 'TOTAL AUD (inc GST)', { bold: true }); p.text(555, y - 2, wGroup(inv.total), { bold: true, align: 'right' });
  p.text(40, 150, 'Payment by EFT within 14 days. BSB 000-000, Account 00000000 (dummy).', { size: 8 });
  p.text(40, 60, 'Synthetic sample data for a demo.', { size: 7, gray: 0.4 });
  return [p];
}

function words(n) {
  const a = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const b = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const two = (x) => (x < 20 ? a[x] : `${b[Math.floor(x / 10)]}${x % 10 ? ' ' + a[x % 10] : ''}`);
  const three = (x) => (x >= 100 ? `${a[Math.floor(x / 100)]} Hundred${x % 100 ? ' ' + two(x % 100) : ''}` : two(x));
  let x = Math.round(n); const out = [];
  const cr = Math.floor(x / 1e7); x %= 1e7; const lk = Math.floor(x / 1e5); x %= 1e5; const th = Math.floor(x / 1e3); x %= 1e3;
  if (cr) out.push(`${two(cr)} Crore`); if (lk) out.push(`${two(lk)} Lakh`); if (th) out.push(`${two(th)} Thousand`); if (x) out.push(three(x));
  return out.join(' ');
}

const LAYOUTS = { 'in-classic': inClassic, 'in-modern': inModern, us, uk, au };
for (const inv of invoices) writeFileSync(new URL(inv.file, OUT), buildPdf(LAYOUTS[inv.layout](inv), `Invoice ${inv.invoiceNo}`));

// ---------- purchase orders (with received qty for a 3-way check) ----------
const po = [
  ['PO Number', 'Vendor', 'PO Date', 'Currency', 'Line', 'Item Code', 'Description', 'Qty Ordered', 'Qty Received', 'Unit Price'],
  // exact match
  ['PO-IN-2041', 'Sahyadri Packaging Pvt Ltd', '2026-09-24', 'INR', 1, '', 'Corrugated box 5-ply 18x12x10 in', 500, 500, 38.5],
  ['PO-IN-2041', 'Sahyadri Packaging Pvt Ltd', '2026-09-24', 'INR', 2, '', 'BOPP tape 48mm x 65m brown', 240, 240, 42],
  ['PO-IN-2041', 'Sahyadri Packaging Pvt Ltd', '2026-09-24', 'INR', 3, '', 'Stretch film 18 in 23 micron', 60, 60, 315],
  // quantity: 100 ordered and received, 120 billed
  ['PO-IN-2047', 'Kaveri Electricals', '2026-10-01', 'INR', 1, '', 'Modular switch 6A white', 100, 100, 64],
  ['PO-IN-2047', 'Kaveri Electricals', '2026-10-01', 'INR', 2, '', 'FR PVC wire 1.5 sq mm 90 m coil', 25, 25, 1460],
  ['PO-IN-2047', 'Kaveri Electricals', '2026-10-01', 'INR', 3, '', 'MCB 32A double pole', 40, 40, 389],
  // price: lid agreed at 4.10, billed at 4.35; bags only 50 received
  ['PO-US-7781', 'Bayline Packaging Supply Inc.', '2026-09-28', 'USD', 1, 'CLM-1612', 'Clamshell container 6x6', 40, 40, 31.8],
  ['PO-US-7781', 'Bayline Packaging Supply Inc.', '2026-09-28', 'USD', 2, 'LID-0408', 'Deli lid 8oz clear', 25, 25, 4.1],
  ['PO-US-7781', 'Bayline Packaging Supply Inc.', '2026-09-28', 'USD', 3, 'BAG-1420', 'Kraft carry bag 14x20', 60, 50, 12.9],
  // exact match
  ['PO-UK-3310', 'Hartwell Fixings Ltd', '2026-09-30', 'GBP', 1, 'M8-50-ZP', 'Hex bolt M8 x 50 zinc', 12, 12, 14.6],
  ['PO-UK-3310', 'Hartwell Fixings Ltd', '2026-09-30', 'GBP', 2, 'WA-M8', 'Flat washer M8', 6, 6, 9.25],
  ['PO-UK-3310', 'Hartwell Fixings Ltd', '2026-09-30', 'GBP', 3, 'AN-M10-120', 'Through-bolt anchor M10 x 120', 4, 4, 38.4],
  // open PO the AU invoice should have quoted (invoice has no PO number)
  ['PO-AU-5520', 'Southern Cross Office Co', '2026-10-06', 'AUD', 1, '', 'A4 copy paper 80gsm carton', 10, 10, 34.5],
  ['PO-AU-5520', 'Southern Cross Office Co', '2026-10-06', 'AUD', 2, '', 'Toner cartridge TN-2450', 4, 4, 72],
  ['PO-AU-5520', 'Southern Cross Office Co', '2026-10-06', 'AUD', 3, '', 'Archive box with lid', 30, 30, 3.9],
];
const csvCell = (v) => { const s = String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
writeFileSync(new URL('purchase_orders.csv', OUT), po.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n');

// ---------- golden expected results ----------
const expected = {
  note: 'Ground truth for the synthetic sample invoices (written by scripts/make-extract-samples.mjs). Dates ISO, amounts in invoice currency.',
  invoices: invoices.map((inv) => ({
    file: inv.file, country: inv.country, vendor: inv.vendor, vendorTaxId: inv.vendorTaxId, buyerTaxId: inv.buyerTaxId || '',
    invoiceNo: inv.invoiceNo, invoiceDate: inv.invoiceDate, dueDate: inv.dueDate, poNo: inv.poNo, currency: inv.currency,
    subtotal: inv.subtotal, taxes: inv.taxes, taxTotal: inv.taxTotal, freight: inv.freight || 0, roundOff: inv.roundOff, total: inv.total,
    lines: inv.lines.map((l) => ({ code: l.code || '', description: l.desc, hsn: l.hsn || '', qty: l.qty, rate: l.rate, amount: l.amount })),
  })),
  poMatch: {
    'in_sahyadri_gst_cgst_sgst.pdf': { status: 'matched', flags: [] },
    'in_kaveri_gst_igst.pdf': { status: 'mismatch', flags: ['qty_over_po'] },
    'us_bayline_sales_tax.pdf': { status: 'mismatch', flags: ['price_diff', 'qty_over_received'] },
    'uk_hartwell_vat.pdf': { status: 'matched', flags: [] },
    'au_southern_cross_gst.pdf': { status: 'missing_po', flags: ['missing_po'], suggestedPo: 'PO-AU-5520' },
    'us_bayline_resent_copy.pdf': { status: 'mismatch', flags: ['price_diff', 'qty_over_received'] },
  },
  duplicates: [['us_bayline_sales_tax.pdf', 'us_bayline_resent_copy.pdf']],
};
writeFileSync(new URL('expected_results.json', OUT), JSON.stringify(expected, null, 2) + '\n');
console.log(`wrote ${invoices.length} PDFs, purchase_orders.csv and expected_results.json to samples/extract/`);
