// Accounting import files built from reviewed invoices: QuickBooks Online bills CSV, Xero bills CSV,
// QuickBooks Desktop IIF, a Tally-friendly purchase CSV and a Zoho Books bills CSV.
// Column names marked verified:false are NOT confirmed against the vendor's own template; see the README.
import { round2 } from './gst.js';
import { TAX_KEYS, docTotals } from './extract.js';

const esc = (v) => { const s = v === null || v === undefined ? '' : String(v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const csv = (cols, rows) => '\uFEFF' + [cols.map(esc).join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\r\n') + '\r\n';
const ymd = (iso) => (iso || '').split('-');
export const fmtDate = (iso, style) => {
  if (!iso) return '';
  const [y, m, d] = ymd(iso);
  if (style === 'MDY') return `${m}/${d}/${y}`;
  if (style === 'DMY-') return `${d}-${m}-${y}`;
  if (style === 'ISO') return iso;
  return `${d}/${m}/${y}`;
};
const n2 = (x) => (x === null || x === undefined || x === '' ? '' : round2(Number(x)).toFixed(2));

export const TARGETS = {
  qbo: { label: 'QuickBooks Online: bills CSV', ext: 'csv', file: 'quickbooks_online_bills.csv' },
  xero: { label: 'Xero: bills CSV (26-column template)', ext: 'csv', file: 'xero_bills.csv' },
  qbd: { label: 'QuickBooks Desktop: bills IIF', ext: 'iif', file: 'quickbooks_desktop_bills.iif' },
  tally: { label: 'TallyPrime: purchase vouchers CSV (map once)', ext: 'csv', file: 'tally_purchase_vouchers.csv' },
  zoho: { label: 'Zoho Books: bills CSV', ext: 'csv', file: 'zoho_books_bills.csv' },
};

export const DEFAULT_SETTINGS = {
  expenseAccount: 'Purchases', freightAccount: 'Freight and Delivery', roundingAccount: 'Rounding Off', apAccount: 'Accounts Payable',
  xeroAccountCode: '300', xeroFreightCode: '425', xeroDate: 'DMY', qboDate: 'DMY',
  tallyPurchaseLedger: 'Purchase GST', tallyVoucherType: 'Purchase',
  // tax code / tax type names must match the target file's own list exactly; these are editable starting points
  taxNames: {
    qbo: { IN: 'GST {r}%', GB: '20.0% S', AU: 'GST', US: '' },
    xero: { IN: 'GST on Expenses', GB: '{r}% (VAT on Expenses)', AU: 'GST on Expenses', US: 'Tax Exempt' },
    zoho: { IN: 'GST{r}', GB: 'VAT {r}%', AU: 'GST', US: '' },
  },
};

/** Tax rate (%) for a document: from the printed rate on the tax line, else tax / subtotal. */
export function docTaxRate(doc) {
  const F = doc.fields, t = docTotals(doc);
  const lab = TAX_KEYS.map((k) => F[k]?.rate).filter((r) => r != null);
  if (F.cgst?.value && F.sgst?.value) { const r = (F.cgst.rate || 0) + (F.sgst.rate || 0); if (r) return r; }
  if (lab.length === 1) return lab[0];
  return t.subtotal ? round2((t.taxTotal / t.subtotal) * 100) : 0;
}
const taxName = (settings, target, doc) => {
  const tpl = settings.taxNames?.[target]?.[doc.country] ?? '';
  return tpl.replace('{r}', String(docTaxRate(doc)));
};

/** Spread a header amount across lines in proportion to line amounts; the last line absorbs the rounding. */
export function allocate(total, lines) {
  const base = lines.reduce((s, l) => s + (Number(l.amount) || 0), 0);
  let left = round2(total);
  return lines.map((l, i) => {
    if (i === lines.length - 1) return round2(left);
    const part = base ? round2((total * (Number(l.amount) || 0)) / base) : 0; left = round2(left - part); return part;
  });
}

/** Lines to export for one document: item lines with allocated tax, plus freight and round-off lines when present. */
export function exportLines(doc, settings = DEFAULT_SETTINGS) {
  const t = docTotals(doc);
  const taxes = allocate(t.taxTotal, doc.lines);
  const split = {}; for (const k of TAX_KEYS) split[k] = allocate(doc.fields[k]?.value || 0, doc.lines);
  const out = doc.lines.map((l, i) => ({ kind: 'item', description: l.description, code: l.code || '', hsn: l.hsn || '', qty: l.qty ?? 1, rate: l.rate ?? l.amount, amount: round2(l.amount || 0), uom: l.uom || '', tax: taxes[i], split: Object.fromEntries(TAX_KEYS.map((k) => [k, split[k][i]])), account: settings.expenseAccount }));
  if (t.freight) out.push({ kind: 'freight', description: 'Freight', code: '', hsn: '', qty: 1, rate: t.freight, amount: t.freight, tax: 0, split: {}, account: settings.freightAccount });
  if (t.roundOff) out.push({ kind: 'round', description: 'Round off', code: '', hsn: '', qty: 1, rate: t.roundOff, amount: t.roundOff, tax: 0, split: {}, account: settings.roundingAccount });
  return out;
}

const memo = (doc) => [doc.fields.poNo?.value ? `PO ${doc.fields.poNo.value}` : '', doc.file ? `[${doc.file}]` : ''].filter(Boolean).join(' ');

// true = column name taken from the vendor's own help article; 'third-party' = from a published copy of the vendor's
// template (official page needs a login); false = not confirmed (check against the template / map it at import).
export const COLUMNS = {
  qbo: [
    ['Bill No.', true], ['Supplier', true], ['Bill Date', true], ['Due Date', true], ['Account', true], ['Line Amount', true], ['Line Tax Code', true],
    ['Line Description', false], ['Line Tax Amount', false], ['Memo', false], ['Currency Code', false],
  ],
  xero: [
    ['*ContactName', 'third-party'], ['EmailAddress', 'third-party'], ['POAddressLine1', 'third-party'], ['POAddressLine2', 'third-party'], ['POAddressLine3', 'third-party'], ['POAddressLine4', 'third-party'], ['POCity', 'third-party'], ['PORegion', 'third-party'], ['POPostalCode', 'third-party'], ['POCountry', 'third-party'],
    ['*InvoiceNumber', 'third-party'], ['*InvoiceDate', 'third-party'], ['*DueDate', 'third-party'], ['Total', 'third-party'], ['InventoryItemCode', 'third-party'], ['Description', 'third-party'], ['*Quantity', 'third-party'], ['*UnitAmount', 'third-party'], ['*AccountCode', 'third-party'], ['*TaxType', 'third-party'], ['TaxAmount', 'third-party'],
    ['TrackingName1', 'third-party'], ['TrackingOption1', 'third-party'], ['TrackingName2', 'third-party'], ['TrackingOption2', 'third-party'], ['Currency', 'third-party'],
  ],
  qbd: [['!TRNS / !SPL / !ENDTRNS header lines', true], ['TRNSTYPE', true], ['DATE', true], ['ACCNT', true], ['NAME', true], ['AMOUNT', true], ['DOCNUM', false], ['MEMO', false], ['DUEDATE', false], ['TERMS', false]],
  tally: [
    ['Voucher Type', false], ['Voucher Date', false], ['Supplier Invoice No', false], ['Supplier Invoice Date', false], ['Party Name', false], ['Party GSTIN', false], ['Purchase Ledger', false],
    ['Item Name', false], ['HSN/SAC', false], ['Quantity', false], ['Unit', false], ['Rate', false], ['Item Value', false], ['CGST', false], ['SGST', false], ['IGST', false], ['Round Off', false], ['Invoice Value', false], ['Narration', false],
  ],
  zoho: [
    ['Bill Date', false], ['Bill Number', false], ['Vendor Name', false], ['Due Date', false], ['Currency Code', false], ['Order Number', false], ['Item Name', false], ['Description', false], ['Account', false],
    ['Quantity', false], ['Rate', false], ['Tax Name', false], ['Tax Percentage', false], ['HSN/SAC', false], ['GSTIN', false], ['Adjustment', false],
  ],
};
export const colNames = (target) => COLUMNS[target].map(([c]) => c);

/** Build one export. docs: reviewed documents. Returns { file, mime, content, rows, columns, warnings }. */
export function buildExport(target, docs, settings = DEFAULT_SETTINGS) {
  const s = { ...DEFAULT_SETTINGS, ...settings, taxNames: { ...DEFAULT_SETTINGS.taxNames, ...(settings.taxNames || {}) } };
  const warnings = [], rows = [];
  const currencies = new Set(docs.map((d) => d.fields.currency.value).filter(Boolean));
  if (currencies.size > 1 && target !== 'qbd') warnings.push(`This file mixes ${[...currencies].join(', ')}. Most companies import one currency per file; the currency column is filled per bill.`);
  if (target === 'qbd') {
    const L = [];
    L.push(['!TRNS', 'TRNSTYPE', 'DATE', 'ACCNT', 'NAME', 'AMOUNT', 'DOCNUM', 'MEMO', 'DUEDATE', 'TERMS'].join('\t'));
    L.push(['!SPL', 'TRNSTYPE', 'DATE', 'ACCNT', 'NAME', 'AMOUNT', 'DOCNUM', 'MEMO'].join('\t'));
    L.push('!ENDTRNS');
    const clean = (v) => String(v ?? '').replace(/[\t\r\n"]/g, ' ');
    for (const d of docs) {
      const F = d.fields, date = fmtDate(F.invoiceDate.value, 'MDY');
      const lines = exportLines(d, s);
      const spl = lines.map((l) => ({ acc: l.account, amt: round2(l.amount + l.tax), memo: l.description }));
      const total = round2(spl.reduce((a, x) => a + x.amt, 0));
      if (Math.abs(total - (F.total.value || 0)) > 0.011) warnings.push(`${F.invoiceNo.value}: lines total ${total.toFixed(2)} but the bill total is ${n2(F.total.value)}.`);
      if (d.country !== 'US') warnings.push(`${F.invoiceNo.value}: QuickBooks Desktop US files carry no VAT/GST split; tax is included in each line. Use the non-US edition's own import for ${d.country}.`);
      L.push(['TRNS', 'BILL', date, s.apAccount, F.vendor.value, (-total).toFixed(2), F.invoiceNo.value, memo(d), fmtDate(F.dueDate.value, 'MDY'), F.terms?.value || ''].map(clean).join('\t'));
      for (const x of spl) { L.push(['SPL', 'BILL', date, x.acc, F.vendor.value, x.amt.toFixed(2), F.invoiceNo.value, x.memo].map(clean).join('\t')); rows.push({ Bill: F.invoiceNo.value, Vendor: F.vendor.value, Account: x.acc, Amount: x.amt.toFixed(2), Memo: x.memo }); }
      L.push('ENDTRNS');
    }
    return { file: TARGETS.qbd.file, mime: 'text/plain', content: L.join('\r\n') + '\r\n', rows, columns: ['Bill', 'Vendor', 'Account', 'Amount', 'Memo'], warnings };
  }
  for (const d of docs) {
    const F = d.fields, lines = exportLines(d, s), rate = docTaxRate(d);
    for (const l of lines) {
      const tn = l.kind === 'item' ? taxName(s, target, d) : '';
      if (target === 'qbo') rows.push({ 'Bill No.': F.invoiceNo.value, Supplier: F.vendor.value, 'Bill Date': fmtDate(F.invoiceDate.value, s.qboDate), 'Due Date': fmtDate(F.dueDate.value || F.invoiceDate.value, s.qboDate), Account: l.account, 'Line Amount': n2(l.amount), 'Line Tax Code': tn, 'Line Description': l.description, 'Line Tax Amount': n2(l.tax), Memo: memo(d), 'Currency Code': F.currency.value });
      else if (target === 'xero') rows.push({ '*ContactName': F.vendor.value, '*InvoiceNumber': F.invoiceNo.value, '*InvoiceDate': fmtDate(F.invoiceDate.value, s.xeroDate), '*DueDate': fmtDate(F.dueDate.value || F.invoiceDate.value, s.xeroDate), InventoryItemCode: '', Description: `${l.code ? l.code + ' ' : ''}${l.description}${l.kind === 'item' && F.poNo.value ? ` (PO ${F.poNo.value})` : ''}`, '*Quantity': l.qty, '*UnitAmount': n2(l.rate), '*AccountCode': l.kind === 'freight' ? s.xeroFreightCode : s.xeroAccountCode, '*TaxType': tn || (d.country === 'GB' ? 'No VAT' : 'BAS Excluded'), TaxAmount: n2(l.tax), Currency: F.currency.value });
      else if (target === 'tally') rows.push({ 'Voucher Type': s.tallyVoucherType, 'Voucher Date': fmtDate(F.invoiceDate.value, 'DMY-'), 'Supplier Invoice No': F.invoiceNo.value, 'Supplier Invoice Date': fmtDate(F.invoiceDate.value, 'DMY-'), 'Party Name': F.vendor.value, 'Party GSTIN': F.vendorTaxId.value || '', 'Purchase Ledger': l.kind === 'item' ? s.tallyPurchaseLedger : l.account, 'Item Name': l.description, 'HSN/SAC': l.hsn, Quantity: l.kind === 'item' ? l.qty : '', Unit: l.uom || '', Rate: l.kind === 'item' ? n2(l.rate) : '', 'Item Value': n2(l.amount), CGST: n2(l.split.cgst || 0), SGST: n2(l.split.sgst || 0), IGST: n2(l.split.igst || 0), 'Round Off': l.kind === 'round' ? n2(l.amount) : '', 'Invoice Value': n2(F.total.value), Narration: memo(d) });
      else if (target === 'zoho') rows.push({ 'Bill Date': fmtDate(F.invoiceDate.value, 'ISO'), 'Bill Number': F.invoiceNo.value, 'Vendor Name': F.vendor.value, 'Due Date': fmtDate(F.dueDate.value, 'ISO'), 'Currency Code': F.currency.value, 'Order Number': F.poNo.value || '', 'Item Name': l.code || l.description, Description: l.description, Account: l.account, Quantity: l.qty, Rate: n2(l.rate), 'Tax Name': tn, 'Tax Percentage': l.kind === 'item' && tn ? rate : '', 'HSN/SAC': l.hsn, GSTIN: F.vendorTaxId.value && d.country === 'IN' ? F.vendorTaxId.value : '', Adjustment: '' });
    }
    if (target === 'zoho' && lines.some((l) => l.kind === 'round')) { const r = rows.filter((x) => x['Bill Number'] === F.invoiceNo.value); const ro = r.pop(); rows.splice(rows.indexOf(ro), 1); r[0].Adjustment = ro.Rate; }
    if (target === 'qbo' && d.country === 'US' && !taxName(s, 'qbo', d)) { /* US QBO without sales tax on bills: tax code may be left blank */ }
    if (target === 'tally' && d.country !== 'IN') warnings.push(`${F.invoiceNo.value}: not an Indian GST invoice; the Tally file is meant for Indian purchases.`);
  }
  const cols = colNames(target);
  if (target === 'xero') for (const r of rows) for (const c of cols) if (!(c in r)) r[c] = '';
  return { file: TARGETS[target].file, mime: 'text/csv', content: csv(cols, rows), rows, columns: cols, warnings };
}
