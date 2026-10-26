import { flattenGstr2b, normalizeBooks, reconcile, resultsToRows, totalTax } from './recon.js';
import { parseCsv, toCsv, toExcelXml } from './csv.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
const inr = (n) => (n === '' || n === null || n === undefined ? '' : Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
let g2b = null, books = null, out = null, filter = 'All';

function ready() { $('run').disabled = !(g2b && books); }
function setDrop(id, ok, msg) { const d = $(id); d.textContent = msg; d.classList.toggle('ok', ok); }

function load2b(text, name) {
  try { g2b = flattenGstr2b(JSON.parse(text)); setDrop('d2b', true, `✓ ${name}: ${g2b.length} documents`); }
  catch (e) { g2b = null; setDrop('d2b', false, `✗ ${e.message}`); }
  ready();
}
function loadBooks(text, name) {
  try { books = normalizeBooks(parseCsv(text)); setDrop('dbk', true, `✓ ${name}: ${books.length} rows`); }
  catch (e) { books = null; setDrop('dbk', false, `✗ ${e.message}`); }
  ready();
}
$('f2b').onchange = async (e) => { const f = e.target.files[0]; if (f) load2b(await f.text(), f.name); };
$('fbk').onchange = async (e) => { const f = e.target.files[0]; if (f) loadBooks(await f.text(), f.name); };
$('sample').onclick = async () => {
  load2b(await (await fetch('samples/gstr2b_sample.json')).text(), 'gstr2b_sample.json');
  loadBooks(await (await fetch('samples/purchase_register.csv')).text(), 'purchase_register.csv');
  run();
};

function run() {
  const opt = { valueTolerance: +$('tv').value || 0, taxTolerance: +$('tt').value || 0, dateToleranceDays: +$('td').value || 0, minInvoiceSimilarity: +$('sim').value || 0.75, fuzzyInvoice: $('fz').checked, crossGstin: $('xg').checked };
  const t0 = performance.now();
  out = reconcile(g2b, books, opt);
  $('status').textContent = `Reconciled ${g2b.length} × ${books.length} records in ${Math.max(1, Math.round(performance.now() - t0))} ms, locally.`;
  $('out').hidden = false;
  render();
}
$('run').onclick = run;
['tv', 'tt', 'td', 'sim', 'fz', 'xg'].forEach((id) => $(id).addEventListener('change', () => { if (out) run(); }));

function render() {
  const s = out.summary, c = s.counts;
  const k = (cls, v, l) => `<div class="kpi ${cls}"><div class="v">${v}</div><div class="l">${l}</div></div>`;
  $('kpis').innerHTML = [
    k('', `₹${inr(s.itcAsPerBooks)}`, 'ITC as per books'),
    k('info', `₹${inr(s.itcAsPer2B)}`, 'ITC available as per 2B'),
    k('ok', `₹${inr(s.itcMatched)}`, `Matched ITC (${c.Matched} docs)`),
    k('warn', `₹${inr(s.itcMismatchClaimable)}`, `Mismatched: claim the lower value (${c.Mismatch} docs)`),
    k('bad', `₹${inr(s.itcAtRisk + s.itcMismatchGap)}`, `ITC at risk: only in books ${c['Only in books']} + excess on mismatches`),
    k('info', `₹${inr(s.itcUnrecorded)}`, `In 2B but not in books (${c['Only in 2B']} docs)`),
    k('', `₹${inr(s.itcNotAvailableIn2B)}`, 'Marked ITC not available in 2B'),
  ].join('');
  const tabs = ['All', 'Mismatch', 'Only in books', 'Only in 2B', 'Matched'];
  $('tabs').innerHTML = tabs.map((t) => `<button class="${t === filter ? 'on' : ''}" data-t="${t}">${t} (${t === 'All' ? out.results.length : c[t]})</button>`).join('');
  $('tabs').querySelectorAll('button').forEach((b) => (b.onclick = () => { filter = b.dataset.t; render(); }));
  const rows = out.results.filter((r) => filter === 'All' || r.status === filter);
  $('tbl').innerHTML = `<thead><tr><th>Status</th><th>Supplier</th><th>Invoice no. (books / 2B)</th><th>Differences</th><th>Date</th><th class="num">Taxable (books)</th><th class="num">Taxable (2B)</th><th class="num">Tax (books)</th><th class="num">Tax (2B)</th></tr></thead><tbody>${rows.map((r) => {
    const b = r.books, g = r.gstr2b, a = b || g;
    const diffs = r.diffs.map((d) => `<span class="diff"><b>${esc(d.field)}:</b> ${esc(typeof d.books === 'number' ? inr(d.books) : d.books)} vs ${esc(typeof d.gstr2b === 'number' ? inr(d.gstr2b) : d.gstr2b)}${d.diff !== '' ? ` <span class="d">(${esc(typeof d.diff === 'number' ? (d.diff > 0 ? '+' : '') + inr(d.diff) : d.diff)})</span>` : ''}</span>`).join('');
    const extra = r.status === 'Only in books' ? '<span class="diff">Not in the supplier\'s GSTR-1. Follow up before claiming.</span>'
      : r.status === 'Only in 2B' ? `<span class="diff">Not recorded in books${g.itcAvailable ? '' : ' · ITC not available per 2B'}</span>`
      : r.matchType === 'fuzzy' ? '<span class="diff note">Paired by fuzzy invoice-number match</span>' : '';
    return `<tr><td><span class="pill p-${r.status.replace(/ /g, '-')}">${r.status}</span></td>
      <td>${esc(a.name)}<div class="note">${esc(a.gstin)}</div></td>
      <td>${esc(b?.invoiceNo ?? '–')}<div class="note">${esc(g?.invoiceNo ?? '–')}</div></td>
      <td class="wrap">${diffs}${extra}</td>
      <td>${esc(b?.date || g?.date)}</td>
      <td class="num">${b ? inr(b.taxable) : '–'}</td><td class="num">${g ? inr(g.taxable) : '–'}</td>
      <td class="num">${b ? inr(totalTax(b)) : '–'}</td><td class="num">${g ? inr(totalTax(g)) : '–'}</td></tr>`;
  }).join('')}</tbody>`;
  $('vtbl').innerHTML = out.vendors.length ? `<thead><tr><th>Supplier</th><th>GSTIN</th><th class="num">ITC at risk (₹)</th><th>Action requested</th></tr></thead><tbody>${out.vendors.map((v) => `<tr><td>${esc(v.name)}</td><td>${esc(v.gstin)}</td><td class="num">${inr(v.itcAtRisk)}</td><td class="wrap">${esc(v.action)}</td></tr>`).join('')}</tbody>` : '<tbody><tr><td>No follow-ups needed 🎉</td></tr></tbody>';
}

function download(name, content, type) {
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([content], { type })), download: name });
  document.body.appendChild(a); a.click(); a.remove();
}
const vendorRows = () => out.vendors.map((v) => ({ 'Supplier name': v.name, 'Supplier GSTIN': v.gstin, 'ITC at risk (₹)': v.itcAtRisk, 'Missing in GSTR-1': v.missing.join(', '), 'Mismatched invoices': v.mismatched.join('; '), 'Action requested': v.action, 'Follow-up status': '', 'Date contacted': '' }));
const summaryRows = () => Object.entries({
  'ITC as per books': out.summary.itcAsPerBooks, 'ITC available as per 2B': out.summary.itcAsPer2B, 'Matched ITC': out.summary.itcMatched,
  'Mismatched ITC (lower of books/2B)': out.summary.itcMismatchClaimable, 'Excess ITC in books on mismatches': out.summary.itcMismatchGap,
  'ITC at risk (only in books)': out.summary.itcAtRisk, 'In 2B, not in books': out.summary.itcUnrecorded, 'ITC not available per 2B': out.summary.itcNotAvailableIn2B,
  ...Object.fromEntries(Object.entries(out.summary.counts).map(([k, v]) => [`Count: ${k}`, v])),
}).map(([Metric, Value]) => ({ Metric, Value }));
$('csv').onclick = () => download('gstr2b_reconciliation.csv', toCsv(resultsToRows(out.results)), 'text/csv');
$('vcsv').onclick = () => download('vendor_follow_up.csv', toCsv(vendorRows()), 'text/csv');
$('xls').onclick = () => download('gstr2b_reconciliation.xls', toExcelXml([
  { name: 'Summary', rows: summaryRows() }, { name: 'Results', rows: resultsToRows(out.results) }, { name: 'Vendor follow-up', rows: vendorRows() },
]), 'application/vnd.ms-excel');
