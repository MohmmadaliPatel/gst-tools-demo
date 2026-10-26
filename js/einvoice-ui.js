import { buildEinvoice, validateEinvoice, rowsToInputs } from './einvoice.js';
import { POS_CODES, makeGstin } from './gst.js';
import { parseCsv } from './csv.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
const inr = (n) => Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
let current = null; // object or array currently shown

$('pos').innerHTML = Object.entries(POS_CODES).map(([k, v]) => `<option value="${k}">${k} – ${esc(v)}</option>`).join('');

const SELLER = makeGstin('27', 'AAECD0001K'), BUYER = makeGstin('29', 'AAHCD4444R');
const GOOD = {
  supTyp: 'B2B', docTyp: 'INV', docNo: 'DEMO/26-27/101', docDt: '2026-10-20',
  s: { gstin: SELLER, name: 'Demo Software Solutions Pvt Ltd', addr: '101 Sample Tech Park', loc: 'Pune', pin: '411001' },
  b: { gstin: BUYER, name: 'Demo Cloud Services Pvt Ltd', addr: '22 Example Road', loc: 'Bengaluru', pin: '560001', stcd: '29', pos: '29' },
  items: [
    { desc: 'GST reconciliation tool, fixed-price build', isServc: 'Y', hsn: '998314', qty: 1, unit: 'OTH', unitPrice: 30000, discount: 0, gstRt: 18 },
    { desc: 'Thermal label printer', isServc: 'N', hsn: '84433250', qty: 3, unit: 'NOS', unitPrice: 8499.99, discount: 500, gstRt: 18 },
  ],
};
const BAD = structuredClone(GOOD);
BAD.docNo = '0DEMO/101'; BAD.s.gstin = SELLER.slice(0, 14) + (SELLER[14] === 'A' ? 'B' : 'A');
BAD.b.pin = '5600'; BAD.items[0].hsn = '99831'; BAD.items[1].gstRt = 17; BAD.items[1].isServc = 'Y';

function fill(d) {
  $('supTyp').value = d.supTyp; $('docTyp').value = d.docTyp; $('docNo').value = d.docNo; $('docDt').value = d.docDt;
  $('sGstin').value = d.s.gstin; $('sName').value = d.s.name; $('sAddr').value = d.s.addr; $('sLoc').value = d.s.loc; $('sPin').value = d.s.pin;
  $('bGstin').value = d.b.gstin; $('bName').value = d.b.name; $('bAddr').value = d.b.addr; $('bLoc').value = d.b.loc; $('bPin').value = d.b.pin; $('bStcd').value = d.b.stcd; $('pos').value = d.b.pos;
  renderItems(d.items); update();
}
const COLS = [['desc', 'Description', 'text'], ['isServc', 'Service?', 'yn'], ['hsn', 'HSN/SAC', 'text'], ['qty', 'Qty', 'number'], ['unit', 'Unit', 'text'], ['unitPrice', 'Unit price', 'number'], ['discount', 'Discount', 'number'], ['gstRt', 'GST %', 'number']];
function renderItems(items) {
  $('items').innerHTML = `<thead><tr>${COLS.map((c) => `<th>${c[1]}</th>`).join('')}<th></th></tr></thead><tbody>${items.map((it) => `<tr>${COLS.map(([k, , t]) => `<td>${t === 'yn'
    ? `<select data-k="${k}"><option value="N"${it[k] === 'N' ? ' selected' : ''}>Goods</option><option value="Y"${it[k] === 'Y' ? ' selected' : ''}>Service</option></select>`
    : `<input data-k="${k}" type="${t}" step="any" value="${esc(it[k])}" style="${k === 'desc' ? 'min-width:200px' : ''}">`}</td>`).join('')}<td><button class="btn sm" data-del>✕</button></td></tr>`).join('')}</tbody>`;
  $('items').querySelectorAll('[data-del]').forEach((b) => (b.onclick = () => { b.closest('tr').remove(); update(); }));
}
const readItems = () => [...$('items').querySelectorAll('tbody tr')].map((tr) => Object.fromEntries([...tr.querySelectorAll('[data-k]')].map((el) => [el.dataset.k, el.value])));
$('addItem').onclick = () => { renderItems([...readItems(), { desc: '', isServc: 'N', hsn: '', qty: 1, unit: 'NOS', unitPrice: 0, discount: 0, gstRt: 18 }]); update(); };
$('loadGood').onclick = () => fill(GOOD);
$('loadBad').onclick = () => fill(BAD);
$('bGstin').addEventListener('input', () => { const st = $('bGstin').value.trim().slice(0, 2); if (POS_CODES[st]) { $('bStcd').value = st; $('pos').value = st; } });
document.getElementById('m-form').addEventListener('input', () => update());
document.getElementById('m-form').addEventListener('change', () => update());

function formInput() {
  return {
    supTyp: $('supTyp').value, docTyp: $('docTyp').value, docNo: $('docNo').value.trim(), docDt: $('docDt').value,
    seller: { gstin: $('sGstin').value.trim().toUpperCase(), lglNm: $('sName').value.trim(), addr1: $('sAddr').value.trim(), loc: $('sLoc').value.trim(), pin: $('sPin').value.trim() },
    buyer: { gstin: $('bGstin').value.trim().toUpperCase(), lglNm: $('bName').value.trim(), addr1: $('bAddr').value.trim(), loc: $('bLoc').value.trim(), pin: $('bPin').value.trim() || '0', stcd: $('bStcd').value.trim(), pos: $('pos').value },
    items: readItems(),
  };
}
function show(docs, label) {
  const arr = Array.isArray(docs) ? docs : [docs];
  current = docs;
  const res = arr.map((d) => validateEinvoice(d));
  const li = [];
  res.forEach((r, i) => {
    const pre = arr.length > 1 ? `<b>${esc(arr[i]?.DocDtls?.No ?? `#${i + 1}`)}</b>: ` : '';
    if (r.valid) li.push(`<li class="ok">✓ ${pre}Passes all offline checks${r.warnings.length ? ` (${r.warnings.length} warning${r.warnings.length > 1 ? 's' : ''})` : ''}.</li>`);
    r.errors.forEach((e) => li.push(`<li class="e">${pre}<code>${esc(e.path)}</code>${esc(e.message)}</li>`));
    r.warnings.forEach((e) => li.push(`<li class="w">${pre}<code>${esc(e.path)}</code>${esc(e.message)}</li>`));
  });
  $('msgs').innerHTML = li.join('') || '<li>Nothing to validate yet.</li>';
  const v = arr.reduce((a, d) => { const x = d?.ValDtls || {}; ['AssVal', 'CgstVal', 'SgstVal', 'IgstVal', 'TotInvVal'].forEach((k) => (a[k] = (a[k] || 0) + (Number(x[k]) || 0))); return a; }, {});
  const k = (l, val) => `<div class="kpi"><div class="v">₹${inr(val)}</div><div class="l">${l}</div></div>`;
  $('totals').innerHTML = (arr.length > 1 ? `<div class="kpi"><div class="v">${arr.length}</div><div class="l">${label || 'documents'}</div></div>` : '') + k('Taxable value', v.AssVal) + k('CGST + SGST', (v.CgstVal || 0) + (v.SgstVal || 0)) + k('IGST', v.IgstVal) + k('Invoice total', v.TotInvVal);
  $('json').textContent = JSON.stringify(docs, null, 2);
  $('dl').disabled = !res.every((r) => r.valid);
  $('dl').title = $('dl').disabled ? 'Fix the errors before downloading' : '';
}
function update() { try { show(buildEinvoice(formInput())); } catch (e) { $('msgs').innerHTML = `<li class="e">${esc(e.message)}</li>`; } }

$('dl').onclick = () => {
  const name = Array.isArray(current) ? 'einvoices_bulk.json' : `einvoice_${String(current?.DocDtls?.No || 'doc').replace(/[^A-Za-z0-9-]/g, '_')}.json`;
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([JSON.stringify(current, null, 2)], { type: 'application/json' })), download: name });
  document.body.appendChild(a); a.click(); a.remove();
};

function loadCsv(text) {
  try {
    const docs = rowsToInputs(parseCsv(text)).map(buildEinvoice);
    $('csvList').innerHTML = `<p class="note">Built ${docs.length} e-invoice(s) from CSV.</p>`;
    show(docs, 'documents from CSV');
  } catch (e) { $('csvList').innerHTML = `<p class="note" style="color:var(--bad)">${esc(e.message)}</p>`; }
}
$('csvFile').onchange = async (e) => { const f = e.target.files[0]; if (f) loadCsv(await f.text()); };
$('csvSample').onclick = async () => loadCsv(await (await fetch('samples/einvoice_rows.csv')).text());

$('validateBtn').onclick = () => { try { show(JSON.parse($('jsonIn').value)); } catch (e) { $('msgs').innerHTML = `<li class="e">Invalid JSON: ${esc(e.message)}</li>`; $('dl').disabled = true; } };
$('brokenJson').onclick = () => {
  const j = buildEinvoice({ ...formInputFrom(GOOD), buyer: { gstin: makeGstin('27', 'AAJFM5555L'), lglNm: 'Mock Packaging Co', addr1: '9 Mock Industrial Estate', loc: 'Mumbai', pin: '400001', pos: '27' } });
  // Introduce realistic mistakes: IGST charged on an intra-state sale, and a stale total.
  j.ItemList[0].IgstAmt = 5400; j.ItemList[0].CgstAmt = 0; j.ItemList[0].SgstAmt = 0; j.ValDtls.TotInvVal += 250;
  $('jsonIn').value = JSON.stringify(j, null, 2); $('validateBtn').onclick();
};
function formInputFrom(d) {
  return { supTyp: d.supTyp, docTyp: d.docTyp, docNo: d.docNo, docDt: d.docDt, seller: { gstin: d.s.gstin, lglNm: d.s.name, addr1: d.s.addr, loc: d.s.loc, pin: d.s.pin }, buyer: { gstin: d.b.gstin, lglNm: d.b.name, addr1: d.b.addr, loc: d.b.loc, pin: d.b.pin, pos: d.b.pos }, items: d.items };
}

$('modes').querySelectorAll('button').forEach((b) => (b.onclick = () => {
  $('modes').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
  ['form', 'csv', 'json'].forEach((m) => ($(`m-${m}`).hidden = m !== b.dataset.m));
  if (b.dataset.m === 'form') update();
}));
fill(GOOD);
