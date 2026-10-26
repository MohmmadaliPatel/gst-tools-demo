import { normalizeMembers, buildBoard, fillTemplate, DEFAULT_TEMPLATES, renewalPipeline } from './renewals.js';
import { parseCsv, toCsv } from './csv.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
const tpls = { ...DEFAULT_TEMPLATES };
let members = null, board = [], filter = 'Action needed';

function load(text, name) {
  try { members = normalizeMembers(parseCsv(text)); $('dm').textContent = `✓ ${name}: ${members.length} people`; $('dm').classList.add('ok'); }
  catch (e) { members = null; $('dm').textContent = `✗ ${e.message}`; $('dm').classList.remove('ok'); }
  run();
}
$('fm').onchange = async (e) => { const f = e.target.files[0]; if (f) load(await f.text(), f.name); };
$('sample').onclick = async () => load(await (await fetch('samples/members.csv')).text(), 'members.csv');
['today', 'due', 'low', 'biz'].forEach((id) => { $(id).oninput = run; });

const msg = (r) => (r.status === 'Active' ? '' : fillTemplate(tpls[r.status], r, $('biz').value));
function run() {
  if (!members) return;
  board = buildBoard(members, $('today').value, { dueDays: Number($('due').value), lowSessions: Number($('low').value) });
  const c = (s) => board.filter((r) => r.flags.includes(s)).length;
  const pipe = renewalPipeline(board, 30);
  $('kpis').innerHTML = `<div class="kpi bad"><div class="v">${c('Expired')}</div><div class="l">Expired, not renewed</div></div>
  <div class="kpi warn"><div class="v">${c('Due-soon')}</div><div class="l">Expiring in ${Number($('due').value)} days</div></div>
  <div class="kpi warn"><div class="v">${c('Low-balance')}</div><div class="l">Low classes / hours left</div></div>
  <div class="kpi info"><div class="v">₹${pipe.pendingFees.toLocaleString('en-IN')}</div><div class="l">Fees pending</div></div>
  <div class="kpi ok"><div class="v">₹${pipe.value.toLocaleString('en-IN')}</div><div class="l">Renewals due in 30 days (${pipe.count})</div></div>`;
  $('tpls').innerHTML = Object.entries(tpls).map(([k, v]) => `<div><label><span class="pill p-${k}">${k.replace('-', ' ')}</span></label><textarea data-t="${k}" rows="3">${esc(v)}</textarea></div>`).join('');
  $('out').hidden = false;
  table();
}
function table() {
  const tabs = ['Action needed', 'Expired', 'Due-soon', 'Low-balance', 'Fee-pending', 'All'];
  const rows = board.filter((r) => filter === 'All' || (filter === 'Action needed' ? r.status !== 'Active' : r.flags.includes(filter)));
  $('tabs').innerHTML = tabs.map((t) => `<button data-f="${t}" class="${t === filter ? 'on' : ''}">${t.replace('-', ' ')}</button>`).join('');
  $('tbl').innerHTML = `<tr><th>Name</th><th>Plan</th><th>Expiry</th><th class="num">Left</th><th class="num">Pending</th><th>Flags</th><th>Reminder</th><th></th></tr>` + rows.map((r) => {
    const i = board.indexOf(r);
    return `<tr><td>${esc(r.name)}</td><td>${esc(r.plan)}</td><td>${esc(r.expiry)}<div class="note">${r.daysLeft === null ? '' : r.daysLeft < 0 ? `${-r.daysLeft} day${r.daysLeft === -1 ? "" : "s"} ago` : `in ${r.daysLeft} day${r.daysLeft === 1 ? "" : "s"}`}</div></td>
    <td class="num">${r.left ?? '–'}</td><td class="num">${r.pending ? '₹' + r.pending.toLocaleString('en-IN') : ''}</td>
    <td>${r.flags.length ? r.flags.map((f) => `<span class="pill p-${f}">${f.replace('-', ' ')}</span>`).join(' ') : '<span class="pill p-Active">Active</span>'}</td>
    <td><div class="msgbox">${esc(msg(r))}</div></td><td>${r.status === 'Active' ? '' : `<button class="btn sm" data-copy="${i}">Copy</button>`}</td></tr>`;
  }).join('');
}
$('tabs').onclick = (e) => { if (e.target.dataset.f) { filter = e.target.dataset.f; table(); } };
$('tbl').onclick = async (e) => {
  const i = e.target.dataset.copy; if (i === undefined) return;
  try { await navigator.clipboard.writeText(msg(board[i])); e.target.textContent = 'Copied ✓'; } catch { e.target.textContent = 'Select text'; }
};
$('tpls').oninput = (e) => { const k = e.target.dataset.t; if (k) { tpls[k] = e.target.value; table(); } };
$('csv').onclick = () => {
  const rows = board.filter((r) => r.status !== 'Active').map((r) => ({ name: r.name, plan: r.plan, expiry: r.expiry, days_left: r.daysLeft, sessions_left: r.left, fee_pending: r.pending, flags: r.flags.join(' '), message: msg(r) }));
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([toCsv(rows)], { type: 'text/csv' })); a.download = `reminders_${$('today').value}.csv`; a.click();
};
