import { normalizeMaster, normalizeMoves, computeStock, reconcileChannels, sizeColourMatrix, daySummary } from './stock.js';
import { parseCsv, toCsv, toExcelXml } from './csv.js';
import { localToday, sampleOffset, shiftSampleText } from './sample-dates.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
let master = null, moves = null, channel = [], stock = [], rec = [], filter = 'All';

const setDrop = (id, ok, msg) => { $(id).textContent = msg; $(id).classList.toggle('ok', ok); };
function loadM(t, n) { try { master = normalizeMaster(parseCsv(t)); setDrop('dm', true, `✓ ${n}: ${master.length} SKUs`); } catch (e) { master = null; setDrop('dm', false, `✗ ${e.message}`); } }
function loadV(t, n) { try { moves = normalizeMoves(parseCsv(t)); setDrop('dv', true, `✓ ${n}: ${moves.length} movements`); } catch (e) { moves = null; setDrop('dv', false, `✗ ${e.message}`); } }
function loadC(t, n) { try { channel = parseCsv(t); setDrop('dc', true, `✓ ${n}: ${channel.length} listings`); } catch (e) { channel = []; setDrop('dc', false, `✗ ${e.message}`); } }
let userData = false; // set once the visitor loads their own file; auto-load never overwrites it
const file = (id, fn) => { $(id).onchange = async (e) => { const f = e.target.files[0]; if (f) { userData = true; fn(await f.text(), f.name); run(); } }; };
file('fm', loadM); file('fv', loadV); file('fc', loadC);
async function loadSample(auto = false) {
  const get = async (p) => (await fetch(p)).text();
  const [m, v, c] = await Promise.all([get('samples/stock_master.csv'), get('samples/stock_movements.csv'), get('samples/shopify_inventory.csv')]);
  if (auto && userData) return;
  // Sample movements are dated relative to the "As of" date, so today's dispatches show up as today on any day.
  const shift = sampleOffset($('asof').value || localToday());
  loadM(m, 'stock_master.csv (sample)');
  loadV(shiftSampleText(v, shift), 'stock_movements.csv (sample)');
  loadC(c, 'shopify_inventory.csv (sample)');
  run();
}
$('sample').onclick = () => loadSample();
$('asof').value = localToday(); // the visitor's own date (the HTML value is only a no-JS fallback)
$('asof').onchange = run;

function run() {
  if (!master || !moves) return;
  const asOf = $('asof').value;
  stock = computeStock(master, moves, asOf);
  rec = channel.length ? reconcileChannels(stock, channel) : [];
  const neg = stock.filter((s) => s.available < 0), unk = stock.filter((s) => s.unknown);
  $('msgs').innerHTML = [
    ...neg.map((s) => `<li class="e"><code>${esc(s.sku)}</code>Negative stock (${s.available}): more dispatched than received. Missing inward entry or wrong SKU?</li>`),
    ...unk.map((s) => `<li class="w"><code>${esc(s.sku)}</code>Movement for a SKU that isn't in the master (typo or new variant?)</li>`),
  ].join('') || '<li class="ok">No data problems found.</li>';
  const d = daySummary(moves, asOf);
  const low = stock.filter((s) => s.status === 'Low').length, out = stock.filter((s) => s.status === 'Out').length;
  $('kpis').innerHTML = `<div class="kpi"><div class="v">${stock.reduce((s, x) => s + Math.max(x.available, 0), 0)}</div><div class="l">Units in stock (${stock.length} SKUs)</div></div>
  <div class="kpi warn"><div class="v">${low}</div><div class="l">Low stock (≤ reorder level)</div></div>
  <div class="kpi bad"><div class="v">${out}</div><div class="l">Out / negative</div></div>
  <div class="kpi bad"><div class="v">${rec.filter((r) => r.status === 'Oversell-risk').length}</div><div class="l">Oversell risk on channel</div></div>
  <div class="kpi info"><div class="v">${d.outward} / ${d.returns}</div><div class="l">Dispatched / returned on ${esc(asOf)}</div></div>`;
  const names = [...new Set(stock.filter((s) => !s.unknown).map((s) => s.name))];
  $('prod').innerHTML = names.map((n) => `<option>${esc(n)}</option>`).join('');
  $('out').hidden = false;
  table(); recTable(); matrix();
}
function table() {
  const counts = { All: stock.length, Low: 0, Out: 0, OK: 0 }; stock.forEach((s) => counts[s.status]++);
  $('tabs').innerHTML = Object.entries(counts).map(([k, v]) => `<button data-f="${k}" class="${k === filter ? 'on' : ''}">${k} (${v})</button>`).join('');
  const rows = stock.filter((s) => filter === 'All' || s.status === filter);
  $('tbl').innerHTML = `<tr><th>SKU</th><th>Product</th><th>Size</th><th>Colour</th><th class="num">Open</th><th class="num">In</th><th class="num">Out</th><th class="num">Ret</th><th class="num">Dmg</th><th class="num">Avail</th><th>Status</th></tr>` +
    rows.map((s) => `<tr><td>${esc(s.sku)}</td><td>${esc(s.name)}</td><td>${esc(s.size)}</td><td>${esc(s.colour)}</td><td class="num">${s.opening}</td><td class="num">${s.inward}</td><td class="num">${s.outward}</td><td class="num">${s.returns}</td><td class="num">${s.damaged}</td><td class="num"><b>${s.available}</b></td><td><span class="pill p-${s.status}">${s.status}</span></td></tr>`).join('');
}
function recTable() {
  $('rec').innerHTML = rec.length ? `<tr><th>SKU</th><th class="num">Listed</th><th class="num">Actual</th><th>Status</th><th>Action</th></tr>` + rec.map((r) => `<tr><td>${esc(r.sku)}<div class="note">${esc(r.channel)}</div></td><td class="num">${r.listed}</td><td class="num">${r.available ?? '–'}</td><td><span class="pill p-${r.status}">${r.status.replace('-', ' ')}</span></td><td class="wrap" style="min-width:180px">${esc(r.note)}</td></tr>`).join('') : '<tr><td>Load a channel inventory export to compare.</td></tr>';
}
function matrix() {
  const m = sizeColourMatrix(stock, $('prod').value);
  $('mx').innerHTML = `<tr><th>Colour \\ Size</th>${m.sizes.map((s) => `<th class="num">${esc(s)}</th>`).join('')}</tr>` + m.colours.map((c) => `<tr><td>${esc(c)}</td>${m.sizes.map((s) => { const v = m.cell(s, c); return `<td class="num" style="${v !== null && v <= 0 ? 'color:var(--bad);font-weight:700' : ''}">${v ?? '–'}</td>`; }).join('')}</tr>`).join('');
}
$('tabs').onclick = (e) => { if (e.target.dataset.f) { filter = e.target.dataset.f; table(); } };
$('prod').onchange = matrix;
const COLS = ['sku', 'name', 'size', 'colour', 'opening', 'inward', 'outward', 'returns', 'damaged', 'adjust', 'available', 'reorder', 'status'];
const dl = (data, name, type) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([data], { type })); a.download = name; a.click(); };
$('csv').onclick = () => dl(toCsv(stock, COLS), 'stock.csv', 'text/csv');
$('xls').onclick = () => dl(toExcelXml([
  { name: 'Stock', rows: stock, columns: COLS },
  { name: 'Reorder', rows: stock.filter((s) => s.status !== 'OK'), columns: COLS },
  { name: 'Channel mismatches', rows: rec, columns: ['sku', 'channel', 'listed', 'available', 'diff', 'status', 'note'] },
]), `daily_stock_${$('asof').value}.xls`, 'application/vnd.ms-excel');

// Show results straight away with the bundled sample, unless the visitor already loaded a file or opened ?sample=0.
if (new URLSearchParams(location.search).get('sample') !== '0') loadSample(true).catch(() => {});
