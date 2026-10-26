// UI for tds.html. Everything runs in this tab: files are read with FileReader/Blob.text(), nothing is uploaded.
// The only fetches are same-origin site assets (the section table and the bundled sample files).
import { readStatement, readTable, autoMap, missingRequired, mapBooksRows, mapStatementRows, deductorsFromRecords, BOOKS_FIELDS, BOOKS_PRESETS, STMT_FIELDS, readPartyMap, readAis, maskPan, decodeBytes, isTan, normalizeTan } from './form26as.js';
import { reconcileTds, applyPartyMap, suggestPartyMap, resultsToRowsTds, STATUS, STATUS_ORDER, FLAG_TEXT } from './tds.js';
import { toCsv, toExcelXml } from './csv.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
const inr = (n) => Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pill = (s) => `<span class="pill p-${s.replace(/[^A-Za-z]+/g, '-')}">${esc(s)}</span>`;
const STORE = 'tds-check-demo-v1';

let sectionTable = null;
const st = { stmts: [], books: null, booksMap: {}, preset: 'auto', fileMap: {}, overrides: {}, ais: null, out: null, filter: 'All', userData: false };
const saved = (() => { try { return JSON.parse(localStorage.getItem(STORE) || '{}'); } catch { return {}; } })();

$('preset').innerHTML = Object.entries(BOOKS_PRESETS).map(([k, p]) => `<option value="${k}">${esc(p.label)}</option>`).join('');
if (saved.settings) for (const [id, v] of Object.entries(saved.settings)) { const el = $(id); if (el) el.type === 'checkbox' ? (el.checked = v) : (el.value = v); }

// ---------- loading ----------
function addStatement(text, name) {
  const p = readStatement(text, name);
  st.stmts = st.stmts.filter((s) => s.name !== name).concat({ name, p });
}
function setBooks(text, name) {
  const t = readTable(text, BOOKS_FIELDS);
  st.books = { name, t };
  st.booksMap = autoMap(t.headers, BOOKS_FIELDS, BOOKS_PRESETS[st.preset].map);
}
async function fileText(f) { return decodeBytes(await f.arrayBuffer()); }
$('fst').onchange = async (e) => { if (!e.target.files.length) return; st.userData = true; if (!st.stmtsUser) { st.stmts = []; st.stmtsUser = true; } for (const f of e.target.files) addStatement(await fileText(f), f.name); refresh(); };
$('fbk').onchange = async (e) => { const f = e.target.files[0]; if (!f) return; st.userData = true; setBooks(await fileText(f), f.name); refresh(); };
$('fpm').onchange = async (e) => { const f = e.target.files[0]; if (!f) return; st.userData = true; st.fileMap = readPartyMap(await fileText(f)); st.fileMapName = f.name; refresh(); };
$('fais').onchange = async (e) => { const f = e.target.files[0]; if (!f) return; st.userData = true; st.ais = { name: f.name, rows: readAis(await fileText(f)) }; refresh(); };
$('preset').onchange = () => { st.preset = $('preset').value; if (st.books) st.booksMap = autoMap(st.books.t.headers, BOOKS_FIELDS, BOOKS_PRESETS[st.preset].map); refresh(); };

async function loadSample(auto = false) {
  const names = ['form26as_sample.txt', 'form26as_prev_sample.txt', 'books_generic.csv', 'party_tan_map.csv', 'ais_tds_sample.csv'];
  const texts = await Promise.all(names.map((n) => fetch(`samples/tds/${n}`).then((r) => { if (!r.ok) throw new Error(n); return r.text(); })));
  if (auto && st.userData) return;
  st.stmts = []; st.stmtsUser = false; st.overrides = {};
  addStatement(texts[0], `${names[0]} (sample)`); addStatement(texts[1], `${names[1]} (sample)`);
  st.preset = 'auto'; $('preset').value = 'auto'; setBooks(texts[2], `${names[2]} (sample)`);
  st.fileMap = readPartyMap(texts[3]); st.fileMapName = `${names[3]} (sample)`;
  st.ais = { name: `${names[4]} (sample)`, rows: readAis(texts[4]) };
  refresh(); run();
}
$('sample').onclick = () => loadSample();
$('clear').onclick = () => {
  localStorage.removeItem(STORE); Object.keys(saved).forEach((k) => delete saved[k]);
  Object.assign(st, { stmts: [], books: null, booksMap: {}, fileMap: {}, fileMapName: '', overrides: {}, ais: null, out: null, userData: true, stmtsUser: false });
  ['fst', 'fbk', 'fpm', 'fais'].forEach((id) => ($(id).value = ''));
  $('out').hidden = true; refresh(); $('status').textContent = 'All data cleared from this tab and this browser.';
};

// ---------- derived data ----------
const allStmt = () => st.stmts.flatMap((s) => s.p.records);
const allDeductors = () => {
  const m = new Map();
  for (const s of st.stmts) for (const d of (s.p.deductors.length ? s.p.deductors : deductorsFromRecords(s.p.records))) if (!m.has(d.tan)) m.set(d.tan, d);
  return [...m.values()];
};
const booksRaw = () => (st.books && !missingRequired(st.booksMap, BOOKS_FIELDS).length ? mapBooksRows(st.books.t.rows, st.booksMap) : []);
const partyMap = () => ({ ...(saved.partyMap || {}), ...st.fileMap, ...st.overrides });
const deductee = () => { const h = st.stmts.find((s) => s.p.header?.pan)?.p.header || {}; return { name: h.name || '', pan: h.pan || '', maskPan: $('mask').checked }; };
const showPan = (p) => ($('mask').checked ? maskPan(p) : p);

function refresh() {
  // load messages
  const msgs = [];
  setDrop('dst', st.stmts.length > 0, st.stmts.length ? `✓ ${st.stmts.map((s) => `${s.name}: ${s.p.records.length} lines`).join(' · ')}` : 'No statement loaded');
  setDrop('dbk', !!st.books, st.books ? `✓ ${st.books.name}: ${st.books.t.rows.length} rows` : 'No books file loaded');
  setDrop('dpm', Object.keys(st.fileMap).length > 0, Object.keys(st.fileMap).length ? `✓ ${st.fileMapName}: ${Object.keys(st.fileMap).length} parties` : 'Not loaded (names are matched automatically)');
  setDrop('dais', !!st.ais, st.ais ? `✓ ${st.ais.name}: ${st.ais.rows.length} lines` : 'Not loaded');
  for (const s of st.stmts) for (const w of s.p.warnings) msgs.push(['w', `${s.name}: ${w}`]);
  if (st.books && st.books.t.headerRow > 0) msgs.push(['ok', `Books: skipped ${st.books.t.headerRow} title line(s) above the header row.`]);
  $('loadmsgs').innerHTML = msgs.map(([c, m]) => `<li class="${c}">${esc(m)}</li>`).join('');
  renderMapping(); renderStatement(); renderParty();
  $('run').disabled = !(allStmt().length && booksRaw().length && sectionTable);
}
function setDrop(id, ok, msg) { const d = $(id); d.textContent = msg; d.classList.toggle('ok', ok); }

// ---------- 2. mapping ----------
function selects(fields, headers, map, prefix) {
  return Object.entries(fields).map(([f, d]) => `<div><label for="${prefix}-${f}">${esc(d.label)}${d.req ? ' *' : ''}</label><select class="map-sel" id="${prefix}-${f}" data-f="${f}"><option value="">(not in file)</option>${headers.map((h) => `<option${map[f] === h ? ' selected' : ''}>${esc(h)}</option>`).join('')}</select></div>`).join('');
}
function renderMapping() {
  const out = [];
  if (st.books) {
    $('mapbooks').innerHTML = `<p class="note" style="grid-column:1/-1;margin:0"><b>Books</b> · ${esc(st.books.name)}</p>` + selects(BOOKS_FIELDS, st.books.t.headers, st.booksMap, 'mb');
    $('mapbooks').querySelectorAll('select').forEach((s) => (s.onchange = () => { st.booksMap[s.dataset.f] = s.value; if (!s.value) delete st.booksMap[s.dataset.f]; refresh(); }));
    const miss = missingRequired(st.booksMap, BOOKS_FIELDS);
    out.push(miss.length ? ['e', `Books: map ${miss.join(', ')}.`] : ['ok', `Books: ${booksRaw().length} rows read · TAN column ${st.booksMap.tan ? 'present' : 'absent (party ↔ TAN map used)'} · section column ${st.booksMap.section ? 'present' : 'absent (section checks skipped)'}.`]);
    const badDates = booksRaw().filter((b) => !b.date).length;
    if (badDates) out.push(['w', `Books: ${badDates} row(s) with an unreadable date.`]);
  } else $('mapbooks').innerHTML = '<p class="note" style="margin:0">Load a books file to map its columns.</p>';
  const csv = st.stmts.filter((s) => s.p.table);
  $('mapstmt').innerHTML = csv.map((s, i) => `<p class="note" style="grid-column:1/-1;margin:0"><b>Statement (CSV)</b> · ${esc(s.name)}</p>` + selects(STMT_FIELDS, s.p.table.headers, s.p.map, `ms${i}`)).join('');
  csv.forEach((s, i) => $('mapstmt').querySelectorAll(`select[id^="ms${i}-"]`).forEach((sel) => (sel.onchange = () => {
    s.p.map[sel.dataset.f] = sel.value; if (!sel.value) delete s.p.map[sel.dataset.f];
    const miss = missingRequired(s.p.map, STMT_FIELDS);
    s.p.records = miss.length ? [] : mapStatementRows(s.p.table.rows, s.p.map, s.name); s.p.deductors = deductorsFromRecords(s.p.records);
    s.p.warnings = miss.length ? [`Map these statement columns: ${miss.join(', ')}.`] : [];
    refresh();
  })));
  for (const s of st.stmts.filter((x) => !x.p.table)) out.push(['ok', `${s.name}: Form 26AS text read directly (${s.p.records.length} Part I lines); no mapping needed.`]);
  $('mapmsgs').innerHTML = out.map(([c, m]) => `<li class="${c}">${esc(m)}</li>`).join('');
}

// ---------- 3. statement review ----------
function renderStatement() {
  const heads = st.stmts.map((s) => ({ ...s.p.header, file: s.name, kind: s.p.kind }));
  const yy = (y) => String(y || '').replace(/^(\d{4})-\d{2}(\d{2})$/, '$1-$2');
  $('stmthead').innerHTML = heads.map((h) => `<div class="tds-file"><div><b>File</b>${esc(h.file)}</div><div><b>Assessee</b>${esc(h.name || '–')}</div><div><b>PAN</b>${esc(h.pan ? showPan(h.pan) : '–')}${h.panStatus ? ` · ${esc(h.panStatus)}` : ''}</div><div><b>Year</b>${esc(h.taxYear ? `Tax Year ${h.taxYear}` : h.fy ? `FY ${yy(h.fy)} / AY ${yy(h.ay)}` : '–')}</div></div>`).join('');
  const ds = st.stmts.flatMap((s) => (s.p.deductors.length ? s.p.deductors : deductorsFromRecords(s.p.records)).map((d) => ({ ...d, file: s.name, lines: s.p.records.filter((r) => r.tan === d.tan) })));
  $('dtbl').innerHTML = ds.length ? `<thead><tr><th>File</th><th>Deductor</th><th>TAN</th><th class="num">Lines</th><th class="num">Amount paid (₹)</th><th class="num">TDS (₹)</th><th class="num">Deposited (₹)</th><th>Booking status</th><th>Check</th></tr></thead><tbody>${ds.map((d) => {
    const sumT = d.lines.reduce((a, r) => a + r.tds, 0), stat = [...new Set(d.lines.map((r) => r.status))].join(', ');
    const ok = Math.abs(sumT - d.totalTds) < 0.5;
    return `<tr><td class="note">${esc(d.file.replace(' (sample)', ''))}</td><td>${esc(d.name)}</td><td>${esc(d.tan)}${isTan(d.tan) ? '' : ' <span class="flag">check TAN</span>'}</td><td class="num">${d.lines.length}</td><td class="num">${inr(d.totalPaid)}</td><td class="num">${inr(d.totalTds)}</td><td class="num">${inr(d.totalDeposited)}</td><td>${esc(stat)}</td><td>${ok ? '✓ lines = summary' : '<span class="flag">lines ≠ summary</span>'}</td></tr>`;
  }).join('')}</tbody>` : '<tbody><tr><td>Load a Form 26AS text or Form 168 CSV.</td></tr></tbody>';
  const m = [];
  for (const s of st.stmts) {
    const empty = s.p.parts.filter((p) => p.empty).map((p) => p.id);
    if (s.p.parts.length) m.push(['ok', `${s.name}: parts found ${s.p.parts.map((p) => p.id).join(', ')}${empty.length ? ` (no transactions in ${empty.join(', ')})` : ''}. Only Part I (TDS) is matched.`]);
    const nf = s.p.records.filter((r) => r.status && r.status !== 'F').length;
    if (nf) m.push(['w', `${s.name}: ${nf} line(s) not Final (U = unmatched challan, P = provisional, O = overbooked). Credit may not be allowed until they turn F.`]);
  }
  $('stmtmsgs').innerHTML = m.map(([c, x]) => `<li class="${c}">${esc(x)}</li>`).join('');
}

// ---------- 4. party <-> TAN ----------
function renderParty() {
  const raw = booksRaw(), ds = allDeductors();
  if (!raw.length) { $('ptbl').innerHTML = '<tbody><tr><td>Load books to map parties to TANs.</td></tr></tbody>'; return; }
  const sug = suggestPartyMap(raw, ds, partyMap(), +$('ns').value || 0.8);
  st.suggested = Object.fromEntries(sug.filter((s) => s.tan).map((s) => [s.party, s.tan]));
  const names = Object.fromEntries(ds.map((d) => [d.tan, d.name]));
  $('ptbl').innerHTML = `<thead><tr><th>Books party</th><th>TAN</th><th>Statement name</th><th>How</th><th class="num">Books rows</th></tr></thead><tbody>${sug.map((s, i) => `<tr><td>${esc(s.party)}</td><td><input id="pt${i}" data-p="${esc(s.party)}" value="${esc(s.tan)}" list="tans" aria-label="TAN for ${esc(s.party)}" maxlength="10"></td><td>${esc(names[s.tan] || (s.tan ? 'not in statement' : '–'))}</td><td class="note">${esc(s.how)}</td><td class="num">${raw.filter((b) => b.party === s.party).length}</td></tr>`).join('')}</tbody>`;
  if (!$('tans')) document.body.insertAdjacentHTML('beforeend', '<datalist id="tans"></datalist>');
  $('tans').innerHTML = ds.map((d) => `<option value="${esc(d.tan)}">${esc(d.name)}</option>`).join('');
  $('ptbl').querySelectorAll('input').forEach((inp) => (inp.onchange = () => { const t = normalizeTan(inp.value); if (t) st.overrides[inp.dataset.p] = t; else delete st.overrides[inp.dataset.p]; renderParty(); if (st.out) run(); }));
  $('pnote').textContent = saved.partyMap ? `${Object.keys(saved.partyMap).length} pairing(s) saved in this browser.` : '';
}
const finalMap = () => ({ ...st.suggested, ...partyMap() });
$('psave').onclick = () => { saved.partyMap = finalMap(); saveStore(); $('pnote').textContent = `Saved ${Object.keys(saved.partyMap).length} pairing(s) in this browser only.`; };
$('pcsv').onclick = () => download('party_tan_map.csv', toCsv(mapRows()), 'text/csv');
const mapRows = () => Object.entries(finalMap()).map(([Party, TAN]) => ({ Party, TAN, 'Statement name': allDeductors().find((d) => d.tan === TAN)?.name || '' }));
function saveStore() { try { localStorage.setItem(STORE, JSON.stringify(saved)); } catch { /* private mode */ } }

// ---------- 5/6. run + results ----------
const optIds = ['tv', 'td', 'ns', 'xq', 'ag', 'rc'];
function run() {
  if ($('run').disabled) return;
  const pm = finalMap();
  const books = applyPartyMap(booksRaw(), pm), stmt = allStmt();
  const opts = { valueTolerance: +$('tv').value || 0, dateToleranceDays: +$('td').value || 0, minNameSimilarity: +$('ns').value || 0.8, crossQuarter: $('xq').checked, aggregate: $('ag').checked, rateCheck: $('rc').checked, sectionTable, partyMap: pm, deductee: deductee() };
  saved.settings = Object.fromEntries(optIds.map((id) => [id, $(id).type === 'checkbox' ? $(id).checked : $(id).value])); if (st.userData) saveStore();
  const t0 = performance.now();
  st.out = reconcileTds(stmt, books, opts);
  $('status').textContent = `Checked ${books.length} books rows against ${stmt.length} statement lines in ${Math.max(1, Math.round(performance.now() - t0))} ms, in this tab.`;
  $('out').hidden = false;
  render();
}
$('run').onclick = run;
optIds.forEach((id) => $(id).addEventListener('change', () => { if (id === 'ns') renderParty(); if (st.out) run(); }));
$('mask').onchange = () => { renderStatement(); if (st.out) run(); };

function render() {
  const { summary: s, results } = st.out, c = s.counts;
  const k = (cls, v, l) => `<div class="kpi ${cls}"><div class="v">${v}</div><div class="l">${l}</div></div>`;
  $('kpis').innerHTML = [
    k('', `₹${inr(s.booksTds)}`, 'TDS as per books'),
    k('info', `₹${inr(s.stmtTds)}`, 'TDS in 26AS / Form 168'),
    k('ok', `₹${inr(s.matchedTds)}`, `Matched (${c[STATUS.MATCHED] + c[STATUS.AGG]} groups)`),
    k('bad', `₹${inr(s.creditAtRisk)}`, `Credit at risk: missing ${c[STATUS.MISSING]} · short ${c[STATUS.SHORT]} · not final ${c[STATUS.NOT_FINAL]}`),
    k('warn', `₹${inr(s.wrongTanTds + s.sectionMismatchTds)}`, `Wrong TAN / section to correct (${c[STATUS.WRONG_TAN] + c[STATUS.SECTION]})`),
    k('info', `₹${inr(s.timingTds)}`, `Timing: other quarter or year (${c[STATUS.TIMING]})`),
    k('info', `₹${inr(s.unbookedTds)}`, `In statement, not in books (${c[STATUS.ONLY] + c[STATUS.EXCESS]})`),
    k('', `${s.deductorsToChase}`, `Deductors to chase · flags: rate ${s.flags.rate}, not deposited ${s.flags.notDeposited}, old code ${s.flags.oldCode}`),
  ].join('');
  const tabs = ['All', 'Exceptions', ...STATUS_ORDER.filter((x) => c[x])];
  const isExc = (r) => ![STATUS.MATCHED, STATUS.AGG].includes(r.status) || r.flags.length;
  $('tabs').innerHTML = tabs.map((t) => `<button class="${t === st.filter ? 'on' : ''}" data-t="${esc(t)}">${esc(t)} (${t === 'All' ? results.length : t === 'Exceptions' ? results.filter(isExc).length : c[t]})</button>`).join('');
  $('tabs').querySelectorAll('button').forEach((b) => (b.onclick = () => { st.filter = b.dataset.t; render(); }));
  const rows = results.filter((r) => st.filter === 'All' || (st.filter === 'Exceptions' ? isExc(r) : r.status === st.filter));
  $('tbl').innerHTML = `<thead><tr><th>Status</th><th>Deductor / party</th><th>Quarter</th><th>Books (invoice · date · section)</th><th>Statement (date · section · status)</th><th class="num">Books TDS</th><th class="num">26AS TDS</th><th class="num">At risk</th><th>Notes</th></tr></thead><tbody>${rows.map((r) => {
    const flags = r.flags.map((f) => `<span class="flag">${esc(f === 'rate' && r.rate ? `Rate ${r.rate.actual}% vs ${r.rate.expected.join('/')}% (${r.rate.section}${r.rate.confirmed ? '' : ', unconfirmed'})` : FLAG_TEXT[f])}</span>`).join('');
    const bl = r.books.map((b) => `${esc(b.ref || b.party)} · ${esc(b.date)}${b.section ? ` · ${esc(b.section)}` : ''}`).join('<br>') || '–';
    const sl = r.stmt.map((x) => `${esc(x.date)} · ${esc(x.section || '–')} · ${esc(x.status)}`).join('<br>') || '–';
    const note = r.status === STATUS.MISSING ? ({ no_tan: 'No TAN for this party: map it in step 4', no_entries: 'TAN has no entries against this PAN', quarter_absent: 'Nothing from this TAN in this quarter: not filed or wrong PAN', line_missing: 'Other lines present: check the PAN quoted' })[r.cause]
      : r.status === STATUS.WRONG_TAN ? `Reported under ${r.stmt[0].tan}` : r.status === STATUS.DUP ? 'Same party, invoice, date and TDS as an earlier row' : r.matchedAs ? `Paired (${r.how}) but credit not final` : r.how !== 'exact' && r.how !== 'leftover' ? `Paired by ${r.how}` : '';
    return `<tr><td>${pill(r.status)}</td><td>${esc(r.deductor || r.party)}<div class="note">${esc(r.tan || 'no TAN')}${r.party && r.deductor ? ` · books: ${esc(r.party)}` : ''}</div></td><td>${esc(r.quarter)}</td><td>${bl}</td><td>${sl}</td><td class="num">${r.books.length ? inr(r.booksTds) : '–'}</td><td class="num">${r.stmt.length ? inr(r.stmtTds) : '–'}</td><td class="num">${r.atRisk ? inr(r.atRisk) : '–'}</td><td class="wrap">${esc(note)}${flags ? `<div>${flags}</div>` : ''}</td></tr>`;
  }).join('')}</tbody>`;
  renderAis(); renderFollowUps(); renderSummary();
}

function renderAis() {
  if (!st.ais?.rows.length) { $('aisnote').textContent = ''; return; }
  const key = (tan, date, amt) => `${tan}|${date}|${Math.round(amt)}`;
  const ais = new Set(st.ais.rows.map((a) => key(a.tan, a.date, a.amount)));
  const years = new Set(st.ais.rows.filter((a) => a.date).map((a) => fyFromIso(a.date)));
  const missing = allStmt().filter((r) => years.has(r.fy) && !ais.has(key(r.tan, r.date, r.gross)));
  $('aisnote').textContent = `Third-way check with AIS (${st.ais.name}): ${st.ais.rows.length} AIS lines; ${missing.length} statement line(s) for the same year not found in AIS${missing.length ? ` (${missing.slice(0, 4).map((r) => `${r.tan} ${r.date} ₹${inr(r.gross)}`).join('; ')}${missing.length > 4 ? '…' : ''})` : ''}. AIS can lag the statement; differences are informational only.`;
}
const fyFromIso = (d) => { const y = +d.slice(0, 4), m = +d.slice(5, 7); const s = m >= 4 ? y : y - 1; return `${s}-${String((s + 1) % 100).padStart(2, '0')}`; };

// ---------- 7. follow-ups ----------
function renderFollowUps() {
  const ds = st.out.deductors;
  $('fu').innerHTML = ds.length ? ds.map((d, i) => `<article><h3>${esc(d.name)}</h3><div class="note">${esc(d.tan || 'no TAN')} · ${d.items.length} item(s) · ${esc(d.quarters.join(', '))}</div><div>At risk: <span class="amt">₹${inr(d.atRisk)}</span>${d.atRisk ? '' : ' <span class="note">(correction needed, credit shown elsewhere)</span>'}</div><textarea id="fu${i}" readonly aria-label="Follow-up note for ${esc(d.name)}">${esc(d.email)}</textarea><button class="btn sm" data-i="${i}">Copy text</button> <span class="note" id="fuc${i}"></span></article>`).join('') : '<p>No follow-ups needed 🎉</p>';
  $('fu').querySelectorAll('button').forEach((b) => (b.onclick = async () => {
    const ta = $(`fu${b.dataset.i}`);
    try { await navigator.clipboard.writeText(ta.value); } catch { ta.select(); document.execCommand('copy'); }
    $(`fuc${b.dataset.i}`).textContent = 'Copied. Paste it into your own email.';
  }));
}

// ---------- 8. client summary ----------
function renderSummary() {
  const s = st.out.summary, d = deductee(), years = [...new Set(st.stmts.map((x) => x.p.header?.taxYear ? `Tax Year ${x.p.header.taxYear}` : x.p.header?.fy ? `FY ${String(x.p.header.fy).replace(/^(\d{4})-\d{2}(\d{2})$/, '$1-$2')}` : ''))].filter(Boolean);
  const kv = (l, v, cls = '') => `<div><span>${l}</span><span class="${cls}">${v}</span></div>`;
  $('sum').innerHTML = `<h3>TDS credit summary${d.name ? `: ${esc(d.name)}` : ''}</h3>
    <div class="meta"><span>PAN ${esc(d.pan ? showPan(d.pan) : '–')}</span><span>${esc(years.join(' + ') || '–')}</span><span>Prepared ${esc(new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }))}</span></div>
    <div class="kv">${kv('TDS as per books', `₹${inr(s.booksTds)}`)}${kv('TDS in 26AS / Form 168', `₹${inr(s.stmtTds)}`)}${kv('Matched', `₹${inr(s.matchedTds)}`)}${kv('Credit at risk', `₹${inr(s.creditAtRisk)}`, 'big')}${kv('of which missing', `₹${inr(s.missingTds)}`)}${kv('of which short reported', `₹${inr(s.shortTds)}`)}${kv('of which not final (U/P/O)', `₹${inr(s.notFinalTds)}`)}${kv('Wrong TAN / section to correct', `₹${inr(s.wrongTanTds + s.sectionMismatchTds)}`)}${kv('Timing (other period)', `₹${inr(s.timingTds)}`)}${kv('In statement, not in books', `₹${inr(s.unbookedTds)}`)}</div>
    <div class="tbl-wrap"><table><tr><th>Deductor</th><th>TAN</th><th>Quarters</th><th>Issue</th><th class="num">At risk (₹)</th></tr>${st.out.deductors.map((x) => `<tr><td>${esc(x.name)}</td><td>${esc(x.tan)}</td><td>${esc(x.quarters.join(', '))}</td><td>${esc([...new Set(x.items.map((r) => r.status))].join(', '))}</td><td class="num">${inr(x.atRisk)}</td></tr>`).join('')}</table></div>
    <p class="note" style="margin-top:10px">Next steps: we will write to each deductor above and recheck the statement after their correction. Credit shown as "not final" may be allowed once the booking status turns F. Amounts in the statement but not in books should be checked and recorded as income where due. Prepared from Form 26AS / Form 168 and your books; not tax advice.</p>`;
}
$('print').onclick = () => window.print();

// ---------- exports ----------
function download(name, content, type) {
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([content], { type })), download: name });
  document.body.appendChild(a); a.click(); a.remove();
}
const summaryRows = () => {
  const s = st.out.summary, d = deductee();
  return Object.entries({
    Deductee: d.name, PAN: d.pan ? showPan(d.pan) : '', 'Section table version': st.out.sectionVersion,
    'TDS as per books': s.booksTds, 'TDS in statement': s.stmtTds, Matched: s.matchedTds, 'Credit at risk': s.creditAtRisk, 'Missing in statement': s.missingTds, 'Short reported': s.shortTds, 'Not final (U/P/O)': s.notFinalTds,
    'Wrong TAN': s.wrongTanTds, 'Section mismatch': s.sectionMismatchTds, Timing: s.timingTds, 'In statement, not in books': s.unbookedTds, 'Duplicate rows in books (excluded)': s.duplicateTds, 'Deductors to chase': s.deductorsToChase,
    ...Object.fromEntries(Object.entries(s.counts).map(([k, v]) => [`Count: ${k}`, v])),
  }).map(([Metric, Value]) => ({ Metric, Value }));
};
const fuRows = () => st.out.deductors.map((d) => ({ Deductor: d.name, TAN: d.tan, Quarters: d.quarters.join(', '), Issues: [...new Set(d.items.map((r) => r.status))].join(', '), 'Credit at risk (₹)': d.atRisk, 'Follow-up text': d.email, 'Date contacted': '', 'Follow-up status': '' }));
const isMatch = (r) => [STATUS.MATCHED, STATUS.AGG].includes(r.status) && !r.flags.length;
$('csv').onclick = () => download('tds_credit_check.csv', toCsv(resultsToRowsTds(st.out.results)), 'text/csv');
$('fcsv').onclick = () => download('tds_deductor_follow_up.csv', toCsv(fuRows()), 'text/csv');
$('xls').onclick = () => download('tds_credit_check.xls', toExcelXml([
  { name: 'Summary', rows: summaryRows() },
  { name: 'Matches', rows: resultsToRowsTds(st.out.results.filter(isMatch)) },
  { name: 'Exceptions', rows: resultsToRowsTds(st.out.results.filter((r) => !isMatch(r))) },
  { name: 'Deductor follow-ups', rows: fuRows() },
  { name: 'Party-TAN map', rows: mapRows() },
]), 'application/vnd.ms-excel');

// ---------- start ----------
fetch('js/tds-sections.json').then((r) => r.json()).then((t) => {
  sectionTable = t; refresh();
  if (new URLSearchParams(location.search).get('sample') !== '0') loadSample(true).catch(() => {});
}).catch(() => { $('status').textContent = 'Could not read the section table.'; });
refresh();
