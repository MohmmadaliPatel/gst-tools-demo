// UI for extract.html. Everything runs in this tab: PDFs are read with File.arrayBuffer() and the vendored pdf.js.
// The only fetches are same-origin site files (pdf.js, and the bundled samples when the sample button or auto-load is used).
import { extractInvoice, checkDoc, docTotals, findDuplicates, parsePoCsv, matchPo, confBand, parseAmount, FIELD_LABELS, TAX_KEYS } from './extract.js';
import { TARGETS, COLUMNS, DEFAULT_SETTINGS, buildExport } from './extract-export.js';
import { startWorker, readPdf, renderPage } from './extract-pdf.js';
import { round2 } from './gst.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
const SYM = { INR: '₹', USD: '$', GBP: '£', AUD: 'A$', EUR: '€' };
const money = (n, cur) => (n === null || n === undefined || n === '' ? '—' : `${SYM[cur] || ''}${Number(n).toLocaleString(cur === 'INR' ? 'en-IN' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const pill = (cls, text) => `<span class="pill s-${cls}">${esc(text)}</span>`;
const clone = (o) => JSON.parse(JSON.stringify(o));
const STORE = 'invoice-extractor-demo-v1';
const SAMPLES = ['in_sahyadri_gst_cgst_sgst.pdf', 'in_kaveri_gst_igst.pdf', 'us_bayline_sales_tax.pdf', 'uk_hartwell_vat.pdf', 'au_southern_cross_gst.pdf', 'us_bayline_resent_copy.pdf'];
const TEXT_FIELDS = ['vendor', 'invoiceNo', 'invoiceDate', 'dueDate', 'poNo', 'currency', 'vendorTaxId', 'buyerTaxId'];
const MONEY_FIELDS = ['subtotal', ...TAX_KEYS, 'freight', 'roundOff', 'total'];
const OPTIONAL = [...TAX_KEYS, 'freight', 'roundOff', 'buyerTaxId', 'poNo'];
const COUNTRY_TAX = { IN: ['cgst', 'sgst', 'igst'], GB: ['vat'], AU: ['gst'], US: ['salesTax'] };
const PO_TEXT = { matched: 'PO matched', mismatch: 'PO mismatch', missing_po: 'No PO no.', unknown_po: 'Unknown PO', no_po_file: 'No PO file' };

const st = { docs: [], po: null, cur: 0, page: 1, focus: null, userData: false, busy: false };
const saved = (() => { try { return JSON.parse(localStorage.getItem(STORE) || '{}'); } catch { return {}; } })();
const settings = { ...DEFAULT_SETTINGS, ...(saved.settings || {}) };
startWorker(); // load pdf.js worker now, so picking files later needs no request

// ---------- loading ----------
const knownVendors = () => (st.po ? [...new Set(st.po.lines.map((l) => l.vendor).filter(Boolean))] : []);
async function addPdf(bytes, name) {
  const r = await readPdf(bytes);
  const doc = extractInvoice(r.items, { file: name, knownVendors: knownVendors() });
  st.docs.push({ file: name, bytes, pages: r.pages, scanned: r.scanned, orig: clone(doc), doc, reviewed: false });
}
function setPo(text, name) { const p = parsePoCsv(text); st.po = { name, lines: p.lines, errors: p.errors, hasReceived: p.hasReceived }; }
async function loadFiles(files) {
  if (!files.length) return;
  st.userData = true; st.busy = true; $('loadmsg').textContent = `Reading ${files.length} PDF${files.length > 1 ? 's' : ''}…`;
  if (st.sample) { st.docs = []; st.sample = false; }
  const bad = [];
  for (const f of files) { try { await addPdf(new Uint8Array(await f.arrayBuffer()), f.name); } catch (e) { bad.push(`${f.name}: ${e.message || e}`); } }
  st.busy = false; $('loadmsg').textContent = bad.length ? `Could not read: ${bad.join('; ')}` : '';
  st.cur = Math.max(0, st.docs.length - files.length + bad.length); st.page = 1; refresh(true);
}
$('fpdf').onchange = (e) => loadFiles([...e.target.files]);
$('fpo').onchange = async (e) => { const f = e.target.files[0]; if (!f) return; st.userData = true; setPo(await f.text(), f.name); refresh(false); };

async function loadSample(auto = false) {
  $('loadmsg').textContent = 'Loading the sample invoices…';
  const get = (n, t) => fetch(`samples/extract/${n}`).then((r) => { if (!r.ok) throw new Error(n); return t ? r.text() : r.arrayBuffer(); });
  const [po, ...pdfs] = await Promise.all([get('purchase_orders.csv', true), ...SAMPLES.map((n) => get(n))]);
  if (auto && st.userData) return;
  st.docs = []; setPo(po, 'purchase_orders.csv (sample)'); st.po.sample = true;
  for (let i = 0; i < SAMPLES.length; i++) await addPdf(new Uint8Array(pdfs[i]), SAMPLES[i]);
  st.sample = true; st.cur = 0; st.page = 1; $('loadmsg').textContent = `Loaded ${SAMPLES.length} sample invoices and a PO file.`;
  refresh(true);
}
$('sample').onclick = () => loadSample().catch((e) => { $('loadmsg').textContent = `Sample failed to load: ${e.message}`; });
$('clear').onclick = () => {
  localStorage.removeItem(STORE); st.docs = []; st.po = null; st.cur = 0; st.userData = true; st.sample = false;
  $('fpdf').value = ''; $('fpo').value = ''; $('loadmsg').textContent = 'Cleared. Nothing is stored.'; refresh(true);
};

// ---------- per-document status ----------
const tol = () => ({ priceTolPct: Number($('ptol').value) || 0, qtyTol: Number($('qtol').value) || 0 });
function status(i) {
  const d = st.docs[i], checks = d.scanned ? [{ level: 'error', id: 'scanned', msg: 'No text layer (scanned image). This demo does not OCR; a real build adds OCR for these.' }] : checkDoc(d.doc);
  const po = st.po ? matchPo(d.doc, st.po.lines, tol()) : { status: 'no_po_file', flags: [], issues: [] };
  const dups = findDuplicates(st.docs.map((x) => x.doc)).filter((p) => p.b === i).map((p) => ({ of: st.docs[p.a].file, reason: p.reason }));
  const F = d.doc.fields, need = ['vendor', 'invoiceNo', 'invoiceDate', 'total'].map((k) => (F[k].edited ? 1 : F[k].conf));
  const errors = checks.filter((c) => c.level === 'error').length, warns = checks.filter((c) => c.level === 'warn').length;
  return { checks, po, dups, conf: Math.min(...need), errors, warns, ready: !errors && !dups.length && !['mismatch', 'missing_po', 'unknown_po'].includes(po.status) };
}

// ---------- queue ----------
function renderQueue(S) {
  const n = st.docs.length, ready = S.filter((s) => s.ready).length, rev = st.docs.filter((d) => d.reviewed).length;
  const poIssues = S.filter((s) => ['mismatch', 'missing_po', 'unknown_po'].includes(s.po.status)).length, dups = S.filter((s) => s.dups.length).length;
  const k = (cls, v, l) => `<div class="kpi ${cls}"><div class="v">${v}</div><div class="l">${l}</div></div>`;
  $('kpis').innerHTML = [k('info', n, 'invoices read'), k(rev === n ? 'ok' : 'warn', `${rev} / ${n}`, 'reviewed'), k(ready === n ? 'ok' : 'warn', ready, 'ready to export'), k(poIssues ? 'bad' : 'ok', poIssues, 'PO problems'), k(dups ? 'bad' : 'ok', dups, 'possible duplicates')].join('');
  $('qtbl').innerHTML = `<tr><th>File</th><th>Vendor</th><th>Invoice no.</th><th>Date</th><th class="num">Total</th><th>Confidence</th><th>Checks</th><th>PO</th><th>Status</th><th></th></tr>` + st.docs.map((d, i) => {
    const F = d.doc.fields, s = S[i], b = confBand(s.conf);
    const chk = s.errors ? pill('error', `${s.errors} error${s.errors > 1 ? 's' : ''}`) : s.warns ? pill('warn', `${s.warns} to check`) : pill('ok', 'all pass');
    return `<tr data-i="${i}"><td class="f" title="${esc(d.file)}">${esc(d.file)}</td><td class="v">${esc(F.vendor.value)}</td><td>${esc(F.invoiceNo.value)}</td><td>${esc(F.invoiceDate.value)}</td><td class="num">${money(F.total.value, F.currency.value)}</td>
      <td><span class="cb ${b}">${Math.round(s.conf * 100)}%</span></td><td>${chk}</td><td>${pill(s.po.status, PO_TEXT[s.po.status])}</td>
      <td>${s.dups.length ? pill('dup', 'Duplicate?') + ' ' : ''}${d.reviewed ? pill('reviewed', 'Reviewed') : pill('todo', 'To review')}</td><td><button class="btn sm" data-rev="${i}">Review</button></td></tr>`;
  }).join('');
  $('qtbl').querySelectorAll('[data-rev]').forEach((b) => (b.onclick = () => { st.cur = Number(b.dataset.rev); st.page = 1; renderReview(true); $('s-review').scrollIntoView({ behavior: 'smooth' }); }));
}

// ---------- review ----------
const fieldList = (d) => {
  const F = d.doc.fields, taxes = (COUNTRY_TAX[d.doc.country] || TAX_KEYS).concat(TAX_KEYS.filter((k) => F[k].value !== null && !(COUNTRY_TAX[d.doc.country] || []).includes(k)));
  return [...TEXT_FIELDS, 'subtotal', ...new Set(taxes), 'freight', 'roundOff', 'total'];
};
function renderFields(d, S) {
  const F = d.doc.fields, errF = new Set(S.checks.filter((c) => c.level === 'error' && c.field).map((c) => c.field));
  $('fields').innerHTML = fieldList(d).map((k) => {
    const f = F[k], absent = OPTIONAL.includes(k) && (f.value === null || f.value === '') && !f.edited;
    const b = f.edited ? 'hi' : absent ? 'none' : confBand(f.conf);
    const tag = f.edited ? '<span class="cb ed">edited</span>' : absent ? '<span class="cb none" title="Not on this invoice">none</span>' : `<span class="cb ${b}" title="${esc(f.how)}">${f.conf ? Math.round(f.conf * 100) + '%' : 'not found'}</span>`;
    let input;
    if (k === 'currency') input = `<select id="f-${k}" data-k="${k}">${['', 'INR', 'USD', 'GBP', 'AUD', 'EUR'].map((c) => `<option ${c === f.value ? 'selected' : ''} value="${c}">${c || '—'}</option>`).join('')}</select>`;
    else if (k.endsWith('Date')) input = `<input id="f-${k}" data-k="${k}" type="date" value="${esc(f.value)}">`;
    else if (MONEY_FIELDS.includes(k)) input = `<input id="f-${k}" data-k="${k}" inputmode="decimal" value="${f.value === null ? '' : f.value}">`;
    else input = `<input id="f-${k}" data-k="${k}" value="${esc(f.value)}">`;
    return `<div class="f ${b}${errF.has(k) ? ' err' : ''}"><label for="f-${k}">${esc(FIELD_LABELS[k] || k)} ${tag}</label>${input}</div>`;
  }).join('');
  $('fields').querySelectorAll('[data-k]').forEach((el) => {
    el.onfocus = () => { st.focus = el.dataset.k; showFocus(); };
    el.onchange = () => {
      const k = el.dataset.k, f = d.doc.fields[k];
      if (MONEY_FIELDS.includes(k)) { const n = el.value.trim() === '' ? null : parseAmount(el.value); f.value = Number.isFinite(n) ? round2(n) : null; } else f.value = el.value.trim();
      f.edited = true; f.conf = 1; d.reviewed = false; afterEdit();
    };
  });
}
function renderLines(d, S) {
  const cur = d.doc.fields.currency.value, isIN = d.doc.country === 'IN';
  const badL = new Set(S.checks.filter((c) => c.level === 'error' && c.line !== undefined).map((c) => c.line)), warnL = new Set(S.checks.filter((c) => c.level === 'warn' && c.line !== undefined).map((c) => c.line));
  const t = docTotals(d.doc);
  const cell = (i, k, v, cls) => `<td class="${cls}"><input data-l="${i}" data-c="${k}" aria-label="Line ${i + 1} ${k}" value="${esc(v ?? '')}"${cls === 'n' ? ' inputmode="decimal"' : ''}></td>`;
  $('ltbl').innerHTML = `<thead><tr><th>#</th><th>Code</th><th>Description</th>${isIN ? '<th>HSN/SAC</th>' : ''}<th class="num">Qty</th><th class="num">Rate</th><th class="num">Amount</th><th></th></tr></thead><tbody>` +
    d.doc.lines.map((l, i) => `<tr class="${badL.has(i) ? 'bad' : warnL.has(i) ? 'warn' : ''}" data-row="${i}"><td>${i + 1} <span class="cb ${l.edited ? 'ed' : confBand(l.conf ?? 0.9)}">${l.edited ? 'ed' : Math.round((l.conf ?? 0.9) * 100) + '%'}</span></td>${cell(i, 'code', l.code, 's')}${cell(i, 'description', l.description, 'd')}${isIN ? cell(i, 'hsn', l.hsn, 's') : ''}${cell(i, 'qty', l.qty, 'n')}${cell(i, 'rate', l.rate, 'n')}${cell(i, 'amount', l.amount, 'n')}<td><button class="btn sm" data-del="${i}" aria-label="Delete line ${i + 1}">✕</button></td></tr>`).join('') +
    `</tbody><tfoot><tr><td colspan="${isIN ? 6 : 5}">Sum of lines</td><td class="num" id="lsum">${money(t.sumLines, cur)}</td><td></td></tr></tfoot>`;
  $('ltbl').querySelectorAll('input[data-l]').forEach((el) => {
    el.onfocus = () => { st.focus = `line${el.dataset.l}`; showFocus(); };
    el.onchange = () => {
      const l = d.doc.lines[Number(el.dataset.l)], c = el.dataset.c;
      if (['qty', 'rate', 'amount'].includes(c)) { const n = el.value.trim() === '' ? null : parseAmount(el.value); l[c] = Number.isFinite(n) ? n : null; } else l[c] = el.value.trim();
      l.edited = true; d.reviewed = false; afterEdit();
    };
  });
  $('ltbl').querySelectorAll('[data-del]').forEach((b) => (b.onclick = () => { d.doc.lines.splice(Number(b.dataset.del), 1); d.reviewed = false; afterEdit(true); }));
}
function renderChecks(S) {
  const cls = { error: 'e', warn: 'w', ok: 'ok' };
  const items = [...S.dups.map((x) => ({ level: 'error', msg: `Possible duplicate of ${x.of} (${x.reason}). It is left out of the export unless you tick "include".` })), ...S.checks];
  items.sort((a, b) => ['error', 'warn', 'ok'].indexOf(a.level) - ['error', 'warn', 'ok'].indexOf(b.level));
  $('checks').innerHTML = items.map((c) => `<li class="${cls[c.level]}" data-chk="${esc(c.id || 'dup')}">${c.level === 'ok' ? '✓' : c.level === 'warn' ? '!' : '✕'} ${esc(c.msg)}</li>`).join('') || '<li class="ok">No checks.</li>';
}
let renderSeq = 0;
async function renderPdf(d) {
  const seq = ++renderSeq, w = Math.max(240, Math.floor($('page').clientWidth || 600));
  try {
    const r = await renderPage(d.bytes, st.page, $('cv'), w);
    if (seq !== renderSeq) return;
    d.numPages = r.numPages; st.toCss = r.toCss; $('pginfo').textContent = `Page ${st.page} of ${r.numPages}`;
    drawBoxes(d);
    document.body.dataset.rendered = `${st.cur}:${st.page}`;
  } catch (e) { $('pginfo').textContent = `Could not render: ${e.message || e}`; }
}
function drawBoxes(d) {
  if (!st.toCss) return;
  const F = d.doc.fields, out = [];
  for (const k of fieldList(d)) { const f = F[k]; if (f.box && f.box.page === st.page) out.push({ key: k, box: f.box, band: f.edited ? 'hi' : confBand(f.conf), label: FIELD_LABELS[k] }); }
  d.doc.lines.forEach((l, i) => { if (l.box && l.box.page === st.page) out.push({ key: `line${i}`, box: l.box, band: l.edited ? 'hi' : confBand(l.conf ?? 0.9), label: `Line ${i + 1}` }); });
  $('boxes').innerHTML = out.map((o) => { const r = st.toCss(o.box); return `<b class="c-${o.band}" data-box="${esc(o.key)}" title="${esc(o.label)}" style="left:${r.left - 2}px;top:${r.top - 1}px;width:${r.width + 4}px;height:${r.height + 2}px"></b>`; }).join('');
  $('boxes').querySelectorAll('[data-box]').forEach((b) => (b.onclick = () => { const k = b.dataset.box; const el = k.startsWith('line') ? document.querySelector(`[data-l="${k.slice(4)}"][data-c="description"]`) : $(`f-${k}`); if (el) el.focus(); }));
  showFocus();
}
function showFocus() {
  $('boxes').querySelectorAll('[data-box]').forEach((b) => b.classList.toggle('focus', b.dataset.box === st.focus));
  const d = st.docs[st.cur]; if (!d || !st.focus) return;
  const f = st.focus.startsWith('line') ? d.doc.lines[Number(st.focus.slice(4))] : d.doc.fields[st.focus];
  const pg = f?.box?.page; if (pg && pg !== st.page) { st.page = pg; renderPdf(d); }
}
function renderReview(withPdf) {
  const d = st.docs[st.cur]; if (!d) return;
  $('docsel').innerHTML = st.docs.map((x, i) => `<option value="${i}" ${i === st.cur ? 'selected' : ''}>${i + 1}. ${esc(x.doc.fields.vendor.value || x.file)} · ${esc(x.doc.fields.invoiceNo.value || '?')}</option>`).join('');
  const S = status(st.cur);
  renderFields(d, S); renderLines(d, S); renderChecks(S);
  $('revstate').innerHTML = d.reviewed ? pill('reviewed', 'Reviewed') : pill('todo', 'Not reviewed yet');
  if (withPdf) { st.toCss = null; $('boxes').innerHTML = ''; renderPdf(d); }
}
function afterEdit(full = false) {
  const d = st.docs[st.cur], S = status(st.cur);
  if (full) renderReview(false); else { renderChecks(S); renderLines(d, S); $('revstate').innerHTML = pill('todo', 'Not reviewed yet');
    const errF = new Set(S.checks.filter((c) => c.level === 'error' && c.field).map((c) => c.field));
    $('fields').querySelectorAll('.f').forEach((el) => { const k = el.querySelector('[data-k]').dataset.k; el.classList.toggle('err', errF.has(k)); const f = d.doc.fields[k]; if (f.edited) { el.className = `f hi${errF.has(k) ? ' err' : ''}`; el.querySelector('.cb').outerHTML = '<span class="cb ed">edited</span>'; } });
  }
  drawBoxes(d); refresh(false, true);
}
$('docsel').onchange = () => { st.cur = Number($('docsel').value); st.page = 1; renderReview(true); };
$('prev').onclick = () => { if (st.cur > 0) { st.cur--; st.page = 1; renderReview(true); } };
$('next').onclick = () => { if (st.cur < st.docs.length - 1) { st.cur++; st.page = 1; renderReview(true); } };
$('pgprev').onclick = () => { if (st.page > 1) { st.page--; renderPdf(st.docs[st.cur]); } };
$('pgnext').onclick = () => { const d = st.docs[st.cur]; if (d && st.page < (d.numPages || 1)) { st.page++; renderPdf(d); } };
$('addline').onclick = () => { const d = st.docs[st.cur]; d.doc.lines.push({ code: '', description: '', hsn: '', qty: 1, rate: 0, amount: 0, uom: '', edited: true, conf: 1 }); d.reviewed = false; afterEdit(true); };
$('fixamt').onclick = () => { const d = st.docs[st.cur]; for (const l of d.doc.lines) if (l.qty !== null && l.rate !== null && round2(l.qty * l.rate) !== l.amount) { l.amount = round2(l.qty * l.rate); l.edited = true; } afterEdit(true); };
$('markrev').onclick = () => { const d = st.docs[st.cur]; d.reviewed = true; if (st.cur < st.docs.length - 1) { st.cur++; st.page = 1; } renderReview(true); refresh(false, true); };
$('reset').onclick = () => { const d = st.docs[st.cur]; d.doc = clone(d.orig); d.reviewed = false; renderReview(true); refresh(false, true); };
let rz; addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { if (st.docs[st.cur]) renderPdf(st.docs[st.cur]); }, 200); });

// ---------- PO match ----------
function renderPo(S) {
  if (!st.po) { $('po').innerHTML = '<p class="note">Load a PO CSV in step 1 to check prices, quantities and missing PO numbers.</p>'; return; }
  const errs = st.po.errors?.length ? `<p class="note">${esc(st.po.errors.join(' '))}</p>` : '';
  $('po').innerHTML = errs + st.docs.map((d, i) => {
    const s = S[i].po, F = d.doc.fields, cls = { error: 'e', warn: 'w', ok: 'ok', info: 'i' };
    const fix = s.suggestedPo ? `<button class="btn sm" data-sug="${i}" data-po="${esc(s.suggestedPo)}">Use ${esc(s.suggestedPo)}</button>` : '';
    const vari = s.variance ? `<div class="sub">Over-billing vs PO / receipts: <b>${money(s.variance, F.currency.value)}</b></div>` : '';
    return `<article data-poi="${i}"><h3>${esc(F.vendor.value || d.file)} · ${esc(F.invoiceNo.value)} ${pill(s.status, PO_TEXT[s.status])}</h3><div class="sub">${F.poNo.value ? `PO ${esc(F.poNo.value)}` : 'No PO number on the invoice'} · ${money(F.total.value, F.currency.value)}</div>${vari}
      <ul class="msgs">${s.issues.map((x) => `<li class="${cls[x.level] || 'w'}">${esc(x.msg)}</li>`).join('')}</ul>${fix}</article>`;
  }).join('') + `<p class="note">${esc(st.po.name)} · ${st.po.lines.length} PO lines${st.po.hasReceived ? ' · with received quantities (3-way match)' : ''}</p>`;
  $('po').querySelectorAll('[data-sug]').forEach((b) => (b.onclick = () => { const d = st.docs[Number(b.dataset.sug)]; Object.assign(d.doc.fields.poNo, { value: b.dataset.po, edited: true, conf: 1 }); if (Number(b.dataset.sug) === st.cur) renderReview(false); refresh(false); }));
}
['ptol', 'qtol'].forEach((id) => ($(id).oninput = () => refresh(false)));

// ---------- export ----------
$('target').innerHTML = Object.entries(TARGETS).map(([k, t]) => `<option value="${k}">${esc(t.label)}</option>`).join('');
const SET_IDS = { expacc: 'expenseAccount', apacc: 'apAccount', xacc: 'xeroAccountCode', xdate: 'xeroDate' };
for (const [id, k] of Object.entries(SET_IDS)) $(id).value = settings[k];
if (saved.target) $('target').value = saved.target;
for (const id of [...Object.keys(SET_IDS), 'target', 'incl']) $(id).onchange = () => {
  for (const [i, k] of Object.entries(SET_IDS)) settings[k] = $(i).value;
  settings.qboDate = settings.xeroDate;
  try { localStorage.setItem(STORE, JSON.stringify({ settings: Object.fromEntries(Object.values(SET_IDS).map((k) => [k, settings[k]])), target: $('target').value })); } catch { /* storage off */ }
  renderExport(st.lastS || []);
};
function exportSet(S) {
  const incl = $('incl').checked;
  return st.docs.map((d, i) => ({ d, s: S[i] })).filter(({ d, s }) => !d.scanned && (incl || s.ready));
}
function renderExport(S) {
  const t = $('target').value, set = exportSet(S);
  const r = buildExport(t, set.map((x) => x.d.doc), settings);
  st.lastExport = r;
  const left = st.docs.length - set.length, unrev = set.filter((x) => !x.d.reviewed).length;
  $('dlinfo').textContent = `${set.length} bill${set.length === 1 ? '' : 's'} · ${r.rows.length} lines → ${r.file}${left ? ` · ${left} held back (errors, duplicates or PO problems)` : ''}`;
  $('dl').disabled = !set.length;
  const w = [...r.warnings]; if (unrev) w.unshift(`${unrev} of these bills ${unrev === 1 ? 'is' : 'are'} not marked reviewed yet.`);
  $('xwarn').innerHTML = w.map((x) => `<li class="w">${esc(x)}</li>`).join('');
  const V = { true: ['v', 'verified against the software\u2019s help article'], 'third-party': ['t', 'from a published copy of the template; the official page needs a login'], false: ['u', 'unverified: check against your import template'] };
  $('xcols').innerHTML = COLUMNS[t].map(([c, v]) => `<span class="${V[v][0]}" title="${V[v][1]}">${esc(c)}</span>`).join('');
  const cols = r.columns.filter((c) => r.rows.some((row) => String(row[c] ?? '') !== ''));
  $('xhid').textContent = cols.length < r.columns.length ? `Preview of the first 12 lines; ${r.columns.length - cols.length} empty column(s) hidden here but present in the file.` : 'Preview of the first 12 lines.';
  $('xtbl').innerHTML = `<tr>${cols.map((c) => `<th>${esc(c)}</th>`).join('')}</tr>` + r.rows.slice(0, 12).map((row) => `<tr>${cols.map((c) => `<td>${esc(row[c])}</td>`).join('')}</tr>`).join('');
}
$('dl').onclick = () => {
  const r = st.lastExport; if (!r) return;
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([r.content], { type: `${r.mime};charset=utf-8` })); a.download = r.file;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
};

// ---------- refresh ----------
function refresh(withPdf = false, skipReview = false) {
  $('dpdf').textContent = st.docs.length ? `${st.docs.length} invoice${st.docs.length > 1 ? 's' : ''}: ${st.docs.map((d) => d.file).join(', ')}` : 'No invoices loaded';
  $('dpdf').classList.toggle('ok', !!st.docs.length);
  $('dpo').textContent = st.po ? `${st.po.name} · ${st.po.lines.length} PO lines` : 'No PO file (PO match is skipped)';
  $('dpo').classList.toggle('ok', !!st.po);
  $('out').hidden = !st.docs.length;
  if (!st.docs.length) return;
  st.cur = Math.min(st.cur, st.docs.length - 1);
  const S = st.docs.map((_, i) => status(i)); st.lastS = S;
  renderQueue(S); renderPo(S); renderExport(S);
  if (!skipReview) renderReview(withPdf);
  document.body.dataset.ready = String(st.docs.length);
}

refresh();
if (new URLSearchParams(location.search).get('sample') !== '0') loadSample(true).catch((e) => { $('loadmsg').textContent = `Sample failed to load: ${e.message}`; });
