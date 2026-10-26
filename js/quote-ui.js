import { computeQuote, nextQuoteNo, followUpQueue, winRate } from './quote.js';
import { PRESETS } from './quote-presets.js';
import { toCsv } from './csv.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
const inr = (n) => Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const STATES = ['Chandigarh', 'Delhi', 'Gujarat', 'Haryana', 'Karnataka', 'Maharashtra', 'Punjab', 'Rajasthan', 'Tamil Nadu', 'Telangana', 'Uttar Pradesh', 'West Bengal'];
const KEY = 'demo-quote-register-v1';
const TODAY = '2026-10-26';
const SAMPLE_REG = [
  { no: 'Q/2026-27/0041', client: 'Fictional Fabricators', date: '2026-10-14', amount: 182400, status: 'Sent', followUp: '2026-10-21' },
  { no: 'Q/2026-27/0042', client: 'Demo Builders LLP', date: '2026-10-17', amount: 64250, status: 'Won', followUp: '' },
  { no: 'Q/2026-27/0043', client: 'Example Interiors', date: '2026-10-20', amount: 23900, status: 'Sent', followUp: '2026-10-26' },
  { no: 'Q/2026-27/0044', client: 'Test Engineering Works', date: '2026-10-21', amount: 412000, status: 'Lost', followUp: '' },
  { no: 'Q/2026-27/0045', client: 'Placeholder Projects', date: '2026-10-23', amount: 97500, status: 'Sent', followUp: '2026-10-30' },
];
let preset = 'steel', lines = [], register = load();

function load() { try { return JSON.parse(localStorage.getItem(KEY)) || SAMPLE_REG.slice(); } catch { return SAMPLE_REG.slice(); } }
function persist() { try { localStorage.setItem(KEY, JSON.stringify(register)); } catch { /* private mode */ } }

$('preset').innerHTML = Object.entries(PRESETS).map(([k, v]) => `<option value="${k}">${esc(v.label)}</option>`).join('');
$('bstate').innerHTML = STATES.map((s) => `<option>${s}</option>`).join('');
$('qdate').value = TODAY;

function applyPreset(k) {
  preset = k; const p = PRESETS[k];
  lines = p.lines.map(([i, qty, disc]) => ({ item: { ...p.items[i] }, qty, disc }));
  $('exp').checked = !!p.export;
  $('bstate').value = p.seller.state === 'Tamil Nadu' ? 'Tamil Nadu' : 'Maharashtra';
  $('valid').value = p.export ? 15 : 7;
  $('additem').innerHTML = p.items.map((it, i) => `<option value="${i}">${esc(it.name)}</option>`).join('');
  render();
}

function renderLines() {
  $('lines').innerHTML = `<tr><th>Item</th><th class="num">Qty</th><th>Unit</th><th class="num">Rate (₹)</th><th>Per</th><th class="num">Disc %</th><th class="num">GST %</th><th></th></tr>` +
    lines.map((l, i) => `<tr><td class="wrap" style="min-width:200px">${esc(l.item.name)}${l.item.basis === 'kg' ? `<div class="note">${l.item.kgPerUnit} kg/${esc(l.item.unit)}</div>` : ''}</td>
    <td><input data-i="${i}" data-f="qty" type="number" min="0" value="${l.qty}"></td><td>${esc(l.item.unit)}</td>
    <td><input data-i="${i}" data-f="rate" type="number" min="0" step="0.01" value="${l.item.rate}"></td><td>${l.item.basis === 'kg' ? 'kg' : esc(l.item.unit)}</td>
    <td><input data-i="${i}" data-f="disc" type="number" min="0" max="100" value="${l.disc}" style="min-width:60px"></td><td class="num">${l.item.gst}</td>
    <td><button class="btn sm" data-del="${i}" title="Remove">✕</button></td></tr>`).join('');
}

function quote() {
  const p = PRESETS[preset];
  return computeQuote(lines, { sellerState: p.seller.state, buyerState: $('bstate').value, export: $('exp').checked, freight: $('freight').value });
}

function renderDoc() {
  const p = PRESETS[preset], q = quote(), exp = $('exp').checked;
  const no = nextQuoteNo(register, $('qdate').value);
  const vd = new Date(`${$('qdate').value}T00:00:00Z`); vd.setUTCDate(vd.getUTCDate() + Number($('valid').value || 0));
  const taxRows = exp ? `<div><span>GST</span><span>Zero-rated (LUT)</span></div>` : q.intra
    ? `<div><span>CGST</span><span>${inr(q.cgst)}</span></div><div><span>SGST</span><span>${inr(q.sgst)}</span></div>`
    : `<div><span>IGST</span><span>${inr(q.igst)}</span></div>`;
  $('doc').innerHTML = `<div class="row" style="justify-content:space-between"><h3>${esc(p.seller.name)}</h3><span class="badge" style="background:var(--info-bg);color:var(--info)">${exp ? 'PROFORMA / EXPORT QUOTE' : 'QUOTATION'}</span></div>
  <div class="note">${esc(p.seller.state)} · GSTIN ${esc(p.seller.gstin)} (sample)</div>
  <div class="meta"><div><b>To:</b> ${esc($('client').value)}<br>${esc($('bstate').value)}</div><div><b>No:</b> ${esc(no)}<br><b>Date:</b> ${esc($('qdate').value)}<br><b>Valid till:</b> ${vd.toISOString().slice(0, 10)}</div></div>
  <table><tr><th>#</th><th>Item</th><th>HSN/SAC</th><th class="num">Qty</th>${q.weight ? '<th class="num">Wt (kg)</th>' : ''}<th class="num">Rate</th><th class="num">Disc</th><th class="num">Taxable</th>${exp ? '<th class="num">CBM</th>' : '<th class="num">GST</th>'}</tr>
  ${q.lines.map((l, i) => `<tr><td data-l="#">${i + 1}</td><td data-l="Item">${esc(l.name)}</td><td data-l="HSN/SAC">${esc(l.hsn)}</td><td class="num" data-l="Qty">${l.qty} ${esc(l.unit)}</td>${q.weight ? `<td class="num" data-l="Wt (kg)">${l.weight ?? ''}</td>` : ''}<td class="num" data-l="Rate">${inr(l.rate)}${l.basis === 'kg' ? '/kg' : ''}</td><td class="num" data-l="Disc">${l.discPct ? l.discPct + '%' : ''}</td><td class="num" data-l="Taxable">${inr(l.taxable)}</td>${exp ? `<td class="num" data-l="CBM">${l.cbm || ''}</td>` : `<td class="num" data-l="GST">${l.gst}%</td>`}</tr>`).join('')}</table>
  <div class="tot" style="margin-top:10px">${q.freight ? `<div><span>Freight / packing</span><span>${inr(q.freight)}</span></div>` : ''}
  <div><span>Taxable value</span><span>${inr(q.taxable)}</span></div>${taxRows}<div><span>Round off</span><span>${inr(q.roundOff)}</span></div>
  <div class="g"><span>Total</span><span>₹ ${inr(q.grand)}</span></div></div>
  <p style="margin:8px 0"><b>${esc(q.words)}</b></p>
  ${q.weight ? `<p class="note">Total theoretical weight: <b>${q.weight} kg</b></p>` : ''}
  ${exp ? `<p class="note">Volume: <b>${q.cbm} CBM</b> · approx. ${q.fill20}% of a 20' container, ${q.fill40}% of a 40' (planning figures of 28 / 58 CBM usable).</p>` : ''}
  <p class="note"><b>Terms:</b> ${esc(p.terms)}</p>`;
  return { q, no };
}

function renderRegister() {
  const today = $('qdate').value || TODAY;
  const due = followUpQueue(register, today);
  const open = register.filter((r) => r.status === 'Sent');
  const wr = winRate(register);
  $('kpis').innerHTML = `<div class="kpi info"><div class="v">${open.length}</div><div class="l">Open quotes</div></div>
  <div class="kpi"><div class="v">₹${Math.round(open.reduce((s, r) => s + r.amount, 0)).toLocaleString('en-IN')}</div><div class="l">Open value</div></div>
  <div class="kpi warn"><div class="v">${due.length}</div><div class="l">Follow-ups due</div></div>
  <div class="kpi ok"><div class="v">${wr === null ? '–' : wr + '%'}</div><div class="l">Win rate (closed)</div></div>`;
  $('due').innerHTML = due.length ? `<tr><th>Quote</th><th>Client</th><th class="num">Amount</th><th class="num">Days open</th><th>Follow-up</th></tr>` + due.map((r) => `<tr><td>${esc(r.no)}</td><td>${esc(r.client)}</td><td class="num">${inr(r.amount)}</td><td class="num">${r.daysOpen}</td><td>${r.overdueBy ? `<span class="pill p-Lost">${r.overdueBy} day(s) overdue</span>` : '<span class="pill p-Sent">Today</span>'}</td></tr>`).join('') : '<tr><td>Nothing due today.</td></tr>';
  $('reg').innerHTML = `<tr><th>Quote</th><th>Client</th><th>Date</th><th class="num">Amount</th><th>Status</th><th>Next follow-up</th></tr>` + register.slice().reverse().map((r) => {
    const i = register.indexOf(r);
    return `<tr><td>${esc(r.no)}</td><td>${esc(r.client)}</td><td>${esc(r.date)}</td><td class="num">${inr(r.amount)}</td>
    <td><select data-st="${i}" style="min-width:90px;padding:4px 6px">${['Sent', 'Won', 'Lost'].map((s) => `<option ${s === r.status ? 'selected' : ''}>${s}</option>`).join('')}</select></td>
    <td><input data-fu="${i}" type="date" value="${esc(r.followUp)}" style="padding:4px 6px"></td></tr>`;
  }).join('');
}

function render() { renderLines(); renderDoc(); renderRegister(); }

$('preset').onchange = (e) => applyPreset(e.target.value);
['client', 'bstate', 'qdate', 'valid', 'freight', 'exp'].forEach((id) => { $(id).oninput = () => { renderDoc(); renderRegister(); }; $(id).onchange = $(id).oninput; });
$('lines').oninput = (e) => {
  const i = e.target.dataset.i, f = e.target.dataset.f; if (i === undefined) return;
  if (f === 'rate') lines[i].item.rate = Number(e.target.value); else lines[i][f] = Number(e.target.value);
  renderDoc();
};
$('lines').onclick = (e) => { const d = e.target.dataset.del; if (d !== undefined) { lines.splice(Number(d), 1); render(); } };
$('add').onclick = () => { lines.push({ item: { ...PRESETS[preset].items[$('additem').value] }, qty: 1, disc: 0 }); render(); };
$('save').onclick = () => {
  const { q, no } = renderDoc();
  const f = new Date(`${$('qdate').value}T00:00:00Z`); f.setUTCDate(f.getUTCDate() + 3);
  register.push({ no, client: $('client').value, date: $('qdate').value, amount: q.grand, status: 'Sent', followUp: f.toISOString().slice(0, 10) });
  persist(); render();
};
$('reg').onchange = (e) => {
  if (e.target.dataset.st !== undefined) register[e.target.dataset.st].status = e.target.value;
  if (e.target.dataset.fu !== undefined) register[e.target.dataset.fu].followUp = e.target.value;
  persist(); renderRegister();
};
$('reset').onclick = () => { register = SAMPLE_REG.slice(); persist(); render(); };
$('print').onclick = () => window.print();
$('csv').onclick = () => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([toCsv(register, ['no', 'client', 'date', 'amount', 'status', 'followUp'])], { type: 'text/csv' }));
  a.download = 'quote_register.csv'; a.click();
};
applyPreset(new URLSearchParams(location.search).get('type') in PRESETS ? new URLSearchParams(location.search).get('type') : 'steel');
$('preset').value = preset;
