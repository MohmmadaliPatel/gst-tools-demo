// TDS credit check engine: books TDS receivable vs Form 26AS / Form 168 Part I (pure, testable, no network).
// Reuses levenshtein() and parseDate() from recon.js (imported). recon.js summarize()/vendorFollowUp()/candidateScore()
// are GST-specific (tax heads, GSTIN), so their patterns are adapted here rather than imported.
import { levenshtein } from './recon.js';
import { round2 } from './gst.js';
import { normalizeTan, quarterIndex, maskPan } from './form26as.js';

export const DEFAULT_OPTIONS = {
  valueTolerance: 1,      // ₹ on TDS (and on gross where both sides have it)
  dateToleranceDays: 7,
  crossQuarter: true,
  aggregate: true,
  rateCheck: true,
  minNameSimilarity: 0.8,
};

export const STATUS = {
  MATCHED: 'Matched', AGG: 'Matched (aggregate)', SHORT: 'Short in 26AS', EXCESS: 'Excess in 26AS',
  MISSING: 'Missing in 26AS', ONLY: 'Only in 26AS', NOT_FINAL: 'Not final (U/P/O)', TIMING: 'Timing',
  SECTION: 'Section mismatch', WRONG_TAN: 'Possible wrong TAN', DUP: 'Duplicate in books',
};
export const STATUS_ORDER = [STATUS.MISSING, STATUS.SHORT, STATUS.NOT_FINAL, STATUS.WRONG_TAN, STATUS.SECTION, STATUS.TIMING, STATUS.ONLY, STATUS.EXCESS, STATUS.DUP, STATUS.AGG, STATUS.MATCHED];

// ---------- names ----------
export function normalizeName(s) {
  return String(s ?? '').toUpperCase().replace(/[.,&()]/g, ' ').replace(/\b(PVT|PRIVATE|LTD|LIMITED|LLP|CO|COMPANY|THE|M\/S)\b/g, ' ').replace(/\s+/g, ' ').trim();
}
/** 0..1 similarity of two party/deductor names (Levenshtein ratio, or 0.85 when one name's words are all in the other). */
export function nameSimilarity(a, b) {
  const x = normalizeName(a), y = normalizeName(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const lev = 1 - levenshtein(x, y) / Math.max(x.length, y.length);
  const tx = x.split(' '), ty = y.split(' ');
  const [small, big] = tx.length <= ty.length ? [tx, new Set(ty)] : [ty, new Set(tx)];
  const contained = small.length >= 2 && small.every((t) => big.has(t)) ? 0.85 : 0;
  return Math.max(lev, contained);
}

// ---------- sections (194-series <-> section 393 Table, from the versioned JSON) ----------
const secKey = (s) => String(s ?? '').toUpperCase().replace(/TABLE\s*\d?|SL\.?\s*NO\.?|SL\.?/g, '').replace(/[^0-9A-Z]/g, '');
export function buildSectionIndex(table) {
  const idx = new Map();
  for (const e of table?.entries ?? []) {
    for (const a of [...e.old, ...e.new, e.id]) idx.set(secKey(a), e);
    for (const c of e.payment_codes) if (!idx.has(c)) idx.set(c, { ...e, viaPaymentCode: true });
  }
  return { version: table?.version ?? '', lookup(label) {
    let k = secKey(label);
    if (!k) return null;
    if (idx.has(k)) return idx.get(k);
    // drop a trailing sub-item ".D(a)/.D(b)" and retry at family level
    const m = k.match(/^(.*?)D[AB]$/); if (m && idx.has(m[1])) return idx.get(m[1]);
    k = k.replace(/[AB]$/, ''); return idx.get(k) ?? null;
  } };
}
const famOf = (sx, label) => sx.lookup(label)?.family ?? '';
const sectionsCompatible = (sx, a, b) => { const fa = famOf(sx, a), fb = famOf(sx, b); return !fa || !fb || fa === fb; };
const isNewCode = (label) => /^\s*39[234]/.test(String(label ?? ''));
const isOldCode = (label) => /^\s*19[2-6]/.test(String(label ?? ''));

const dayDiff = (a, b) => (a && b ? Math.round(Math.abs(Date.parse(a) - Date.parse(b)) / 86400000) : Infinity);
const sum = (arr, k) => round2(arr.reduce((s, r) => s + (r[k] || 0), 0));

/** Fill each books row's TAN from the party map (books TAN wins when present and valid). */
export function applyPartyMap(books, partyMap = {}) {
  return books.map((b) => {
    if (b.tan && b.tanSource === 'books') return b;
    const t = partyMap[b.party];
    return t ? { ...b, tan: normalizeTan(t), tanSource: 'map' } : { ...b, tan: '', tanSource: '' };
  });
}
/** Suggest a TAN for every distinct books party from statement deductor names. */
export function suggestPartyMap(books, deductors, existing = {}, min = DEFAULT_OPTIONS.minNameSimilarity) {
  const parties = [...new Set(books.map((b) => b.party).filter(Boolean))];
  return parties.map((party) => {
    const fromBooks = books.find((b) => b.party === party && b.tan && b.tanSource === 'books')?.tan || '';
    const ranked = deductors.map((d) => ({ tan: d.tan, name: d.name, score: Math.round(nameSimilarity(party, d.name) * 100) / 100 })).sort((a, b) => b.score - a.score);
    const best = ranked[0] && ranked[0].score >= min ? ranked[0] : null;
    const tan = existing[party] || fromBooks || best?.tan || '';
    const how = existing[party] ? 'saved map' : fromBooks ? 'books TAN' : best ? `name match ${Math.round(best.score * 100)}%` : 'not found';
    return { party, tan, how, candidates: ranked.slice(0, 3) };
  });
}

/**
 * Reconcile books TDS rows with statement rows.
 * stmt: [{id,tan,deductor,section,date,quarter,fy,status,gross,tds,deposited}], books: [{id,party,tan,ref,date,quarter,fy,gross,tds,section}]
 * Returns { results[], summary, deductors[], options }. Each result has books[] and stmt[] (either can be empty).
 */
export function reconcileTds(stmt, books, options = {}) {
  const o = { ...DEFAULT_OPTIONS, ...options };
  const stmtIn = stmt.length;
  stmt = dropRepeatedLines(uniqueIds(stmt)); books = uniqueIds(books);
  const repeatedStatementLines = stmtIn - stmt.length;
  const sx = buildSectionIndex(o.sectionTable);
  const usedS = new Set(), usedB = new Set(), results = [];
  const tol = o.valueTolerance + 1e-9;
  const push = (status, bs, ss, how, extra = {}) => { bs.forEach((b) => usedB.add(b.id)); ss.forEach((s) => usedS.add(s.id)); results.push({ status, how, books: bs, stmt: ss, flags: [], ...extra }); };

  // Pass 0: duplicates in books (same party + ref + date + TDS) are set aside so they never inflate credit at risk.
  const seen = new Map();
  for (const b of books) {
    const k = `${b.party.toUpperCase()}|${b.ref.toUpperCase()}|${b.date}|${b.tds}`;
    if (b.ref && seen.has(k)) push(STATUS.DUP, [b], [], 'duplicate', { dupOf: seen.get(k) }); else seen.set(k, b.id);
  }
  const freeB = () => books.filter((b) => !usedB.has(b.id) && b.tan);
  const freeS = () => stmt.filter((s) => !usedS.has(s.id));

  // Pass 1: exact TAN + quarter + TDS, section compatible (books section may be blank). Closest date wins.
  const byKey = new Map();
  for (const s of stmt) { const k = `${s.tan}|${s.quarter}|${Math.round(s.tds * 100)}`; if (!byKey.has(k)) byKey.set(k, []); byKey.get(k).push(s); }
  for (const b of freeB()) {
    const c = (byKey.get(`${b.tan}|${b.quarter}|${Math.round(b.tds * 100)}`) || []).filter((s) => !usedS.has(s.id) && sectionsCompatible(sx, b.section, s.section));
    if (!c.length) continue;
    c.sort((x, y) => dayDiff(b.date, x.date) - dayDiff(b.date, y.date));
    push(STATUS.MATCHED, [b], [c[0]], 'exact');
  }

  // Pass 2: fuzzy line, same TAN, TDS within tolerance, date within tolerance; greedy by score
  // (0.5 amount + 0.3 date + 0.2 section, the recon.js candidateScore pattern).
  const cands = [];
  for (const b of freeB()) for (const s of freeS()) {
    if (s.tan !== b.tan || Math.abs(s.tds - b.tds) > tol) continue;
    const dd = dayDiff(b.date, s.date);
    if (dd > o.dateToleranceDays) continue;
    const grossOk = !(b.gross && s.gross) || Math.abs(b.gross - s.gross) <= tol;
    const secOk = sectionsCompatible(sx, b.section, s.section);
    cands.push([0.5 * (grossOk ? 1 : 0.5) + 0.3 * (1 - dd / (o.dateToleranceDays + 1)) + 0.2 * (secOk ? 1 : 0), b, s, secOk]);
  }
  cands.sort((a, b) => b[0] - a[0]);
  for (const [, b, s, secOk] of cands) {
    if (usedB.has(b.id) || usedS.has(s.id)) continue;
    const status = !secOk ? STATUS.SECTION : b.quarter !== s.quarter ? STATUS.TIMING : STATUS.MATCHED;
    push(status, [b], [s], 'fuzzy');
  }

  // Pass 3: aggregate. Deductors often report one consolidated line per month/quarter.
  if (o.aggregate) {
    const stages = [
      ['TAN + quarter + section', (r, side) => { const f = famOf(sx, r.section); return f ? `${r.tan}|${r.quarter}|${f}` : (side === 'b' ? null : null); }],
      ['TAN + quarter', (r) => `${r.tan}|${r.quarter}`],
      ['TAN + year', (r) => `${r.tan}|${r.fy}`],
    ];
    for (const [label, keyFn] of stages) {
      const groups = new Map();
      const add = (r, side) => { const k = keyFn(r, side); if (!k) return; if (!groups.has(k)) groups.set(k, { b: [], s: [] }); groups.get(k)[side].push(r); };
      freeB().forEach((b) => add(b, 'b')); freeS().forEach((s) => add(s, 's'));
      for (const g of groups.values()) {
        if (!g.b.length || !g.s.length) continue;
        if (g.b.length === 1 && g.s.length === 1 && label !== 'TAN + quarter + section' && !sectionsCompatible(sx, g.b[0].section, g.s[0].section)) continue;
        const bt = sum(g.b, 'tds'), st = sum(g.s, 'tds'), diff = round2(bt - st);
        const status = Math.abs(diff) <= tol ? (g.b.length === 1 && g.s.length === 1 ? STATUS.MATCHED : STATUS.AGG) : diff > 0 ? STATUS.SHORT : STATUS.EXCESS;
        push(status, g.b, g.s, `aggregate: ${label}`, { diff });
      }
    }
  }

  // Pass 4: cross-entity. Same TDS and date under a different TAN whose deductor name is similar (or mapped to the same party).
  for (const b of freeB()) {
    const s = freeS().find((x) => x.tan !== b.tan && Math.abs(x.tds - b.tds) <= tol && dayDiff(b.date, x.date) <= o.dateToleranceDays
      && (nameSimilarity(b.party, x.deductor) >= o.minNameSimilarity || (o.partyMap && o.partyMap[b.party] === x.tan)));
    if (s) push(STATUS.WRONG_TAN, [b], [s], 'cross-entity');
  }

  // Pass 5: cross-period. Same TAN and TDS in an adjacent quarter (including across the year boundary).
  if (o.crossQuarter) for (const b of freeB()) {
    const s = freeS().filter((x) => x.tan === b.tan && Math.abs(x.tds - b.tds) <= tol && Math.abs(quarterIndex(x.date) - quarterIndex(b.date)) === 1)
      .sort((x, y) => dayDiff(b.date, x.date) - dayDiff(b.date, y.date))[0];
    if (s) push(STATUS.TIMING, [b], [s], 'cross-period');
  }

  // Pass 6: leftovers, with a likely cause for the follow-up email.
  const stmtTans = new Set(stmt.map((s) => s.tan));
  const stmtTanQ = new Set(stmt.map((s) => `${s.tan}|${s.quarter}`));
  for (const b of books) {
    if (usedB.has(b.id)) continue;
    const cause = !b.tan ? 'no_tan' : !stmtTans.has(b.tan) ? 'no_entries' : !stmtTanQ.has(`${b.tan}|${b.quarter}`) ? 'quarter_absent' : 'line_missing';
    push(STATUS.MISSING, [b], [], 'leftover', { cause });
  }
  for (const s of stmt) if (!usedS.has(s.id)) push(STATUS.ONLY, [], [s], 'leftover');

  // Post-checks: booking status, deducted vs deposited, rate, old section code after 1 Apr 2026.
  for (const r of results) {
    for (const s of r.stmt) {
      if (s.status && s.status !== 'F' && !r.flags.includes('not_final')) r.flags.push('not_final');
      if (s.deposited + tol < s.tds && !r.flags.includes('not_deposited')) r.flags.push('not_deposited');
      if (s.date >= '2026-04-01' && isOldCode(s.section) && !r.flags.includes('old_code')) r.flags.push('old_code');
    }
    if (r.flags.includes('not_final') && [STATUS.MATCHED, STATUS.AGG, STATUS.TIMING].includes(r.status)) { r.matchedAs = r.status; r.status = STATUS.NOT_FINAL; }
    if (o.rateCheck && r.status !== STATUS.SECTION) {
      for (const s of r.stmt) {
        const e = sx.lookup(s.section) || sx.lookup(r.books[0]?.section);
        const gross = s.gross || (r.books.length === 1 ? r.books[0].gross : 0);
        if (!e || !gross || !s.tds) continue;
        const pct = (s.tds / gross) * 100;
        if (!e.rates_pct.some((x) => Math.abs(gross * x / 100 - s.tds) <= Math.max(tol, gross * 0.0005))) {
          r.flags.push('rate'); r.rate = { actual: Math.round(pct * 100) / 100, expected: e.rates_pct, section: e.id, confirmed: e.confirmed };
          break;
        }
      }
    }
    r.tan = r.stmt[0]?.tan || r.books[0]?.tan || '';
    r.deductor = r.stmt[0]?.deductor || '';
    r.party = r.books[0]?.party || '';
    r.quarter = (r.books[0] || r.stmt[0])?.quarter || '';
    r.booksTds = sum(r.books, 'tds'); r.stmtTds = sum(r.stmt, 'tds');
    r.atRisk = atRisk(r);
  }
  results.sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || a.tan.localeCompare(b.tan) || a.quarter.localeCompare(b.quarter));
  const summary = summarizeTds(results, stmt, books);
  summary.repeatedStatementLines = repeatedStatementLines;
  return { results, summary, deductors: deductorFollowUp(results, o.deductee), options: o, sectionVersion: sx.version };
}

/** Two files can reuse an id (e.g. the same statement loaded twice): suffix repeats so every row is matched once. */
function uniqueIds(rows) {
  const seen = new Map();
  return rows.map((r) => { const n = seen.get(r.id) || 0; seen.set(r.id, n + 1); return n ? { ...r, id: `${r.id}~${n + 1}` } : r; });
}

/** The same statement file loaded twice: identical lines (same TAN, Sr. No., date, TDS) are kept once. */
function dropRepeatedLines(rows) {
  const seen = new Set();
  return rows.filter((r) => { const k = `${r.id.replace(/~\d+$/, '')}|${r.date}|${r.tds}|${r.section}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

/** ₹ credit at risk for one result: books TDS not (finally) credited in the statement. */
function atRisk(r) {
  if (r.status === STATUS.MISSING) return r.booksTds;
  if (r.status === STATUS.SHORT) return round2(Math.max(0, r.booksTds - r.stmtTds));
  if (r.status === STATUS.NOT_FINAL) return round2(r.stmt.filter((s) => s.status !== 'F').reduce((a, s) => a + s.tds, 0));
  return 0;
}

/** Dashboard totals (adapted from recon.js summarize). */
export function summarizeTds(results, stmt, books) {
  const counts = Object.fromEntries(STATUS_ORDER.map((s) => [s, 0]));
  results.forEach((r) => counts[r.status]++);
  const tdsOf = (st, side) => round2(results.filter((r) => r.status === st).reduce((a, r) => a + (side === 'b' ? r.booksTds : r.stmtTds), 0));
  const dupTds = tdsOf(STATUS.DUP, 'b');
  const chase = new Set(results.filter((r) => isChase(r)).map((r) => r.tan || r.party));
  return {
    counts,
    booksTds: round2(sum(books, 'tds') - dupTds),
    stmtTds: sum(stmt, 'tds'),
    matchedTds: round2(tdsOf(STATUS.MATCHED, 'b') + tdsOf(STATUS.AGG, 'b')),
    creditAtRisk: round2(results.reduce((a, r) => a + r.atRisk, 0)),
    missingTds: tdsOf(STATUS.MISSING, 'b'),
    shortTds: round2(results.filter((r) => r.status === STATUS.SHORT).reduce((a, r) => a + r.atRisk, 0)),
    notFinalTds: round2(results.filter((r) => r.status === STATUS.NOT_FINAL).reduce((a, r) => a + r.atRisk, 0)),
    unbookedTds: round2(tdsOf(STATUS.ONLY, 's') + results.filter((r) => r.status === STATUS.EXCESS).reduce((a, r) => a + (r.stmtTds - r.booksTds), 0)),
    timingTds: tdsOf(STATUS.TIMING, 'b'),
    wrongTanTds: tdsOf(STATUS.WRONG_TAN, 'b'),
    sectionMismatchTds: tdsOf(STATUS.SECTION, 'b'),
    duplicateTds: dupTds,
    deductorsToChase: chase.size,
    flags: {
      rate: results.filter((r) => r.flags.includes('rate')).length,
      notDeposited: results.filter((r) => r.flags.includes('not_deposited')).length,
      notFinal: results.filter((r) => r.flags.includes('not_final')).length,
      oldCode: results.filter((r) => r.flags.includes('old_code')).length,
    },
  };
}

const CHASE = new Set([STATUS.MISSING, STATUS.SHORT, STATUS.NOT_FINAL, STATUS.WRONG_TAN, STATUS.SECTION]);
const isChase = (r) => CHASE.has(r.status) || r.flags.includes('not_deposited');
const CAUSE_TEXT = {
  no_tan: 'we could not match this customer to a TAN; please confirm your TAN',
  no_entries: 'no entry from your TAN appears against our PAN at all; please check the PAN you hold for us and whether the statement was filed',
  quarter_absent: 'nothing from your TAN appears for this quarter; the TDS statement may not be filed yet, or was filed with a different PAN',
  line_missing: 'other entries from you appear, but this one does not; please check the PAN quoted on this entry',
};
const inr = (n) => Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** One follow-up per deductor TAN, sorted by ₹ at risk (adapted from recon.js vendorFollowUp). */
export function deductorFollowUp(results, deductee = {}) {
  const map = new Map();
  for (const r of results) {
    if (!isChase(r)) continue;
    // write to OUR customer: for a wrong-TAN line that is the books party/TAN, not the TAN that reported it
    const tan = r.status === STATUS.WRONG_TAN ? (r.books[0]?.tan || r.tan) : r.tan;
    const k = tan || `party:${r.party}`;
    const d = map.get(k) || { tan, name: r.status === STATUS.WRONG_TAN ? r.party : (r.deductor || r.party), party: r.party, items: [], atRisk: 0, quarters: new Set() };
    if (!d.name) d.name = r.party;
    d.items.push(r); d.atRisk = round2(d.atRisk + r.atRisk); if (r.quarter) d.quarters.add(r.quarter);
    map.set(k, d);
  }
  return [...map.values()].map((d) => { const x = { ...d, quarters: [...d.quarters].sort() }; x.email = followUpEmail(x, deductee); return x; }).sort((a, b) => b.atRisk - a.atRisk || a.name.localeCompare(b.name));
}

/** Plain-text email to a deductor. Copy only: the app never sends anything. */
export function followUpEmail(d, deductee = {}) {
  const who = deductee.name || '[Your firm name]';
  const pan = deductee.maskPan === false ? deductee.pan : maskPan(deductee.pan);
  const lines = d.items.map((r) => {
    const refs = r.books.map((b) => b.ref).filter(Boolean).join(', ') || 'see statement';
    const q = r.quarter;
    switch (r.status) {
      case STATUS.MISSING: return `- ${q}, invoice(s) ${refs}: TDS ₹${inr(r.booksTds)} as per our books is not in our Form 26AS/168. Likely cause: ${CAUSE_TEXT[r.cause] || 'not reported'}.`;
      case STATUS.SHORT: return `- ${q}, invoice(s) ${refs}: TDS ₹${inr(r.booksTds)} per our books, ₹${inr(r.stmtTds)} reported. Short by ₹${inr(r.booksTds - r.stmtTds)}.`;
      case STATUS.NOT_FINAL: return `- ${q}, invoice(s) ${refs}: ₹${inr(r.atRisk)} shows booking status ${[...new Set(r.stmt.map((s) => s.status))].join('/')} (not Final). Please check the challan details in your statement.`;
      case STATUS.WRONG_TAN: return `- ${q}, invoice(s) ${refs}: TDS ₹${inr(r.booksTds)} appears under TAN ${r.stmt[0].tan} (${r.stmt[0].deductor}), not your TAN. Please confirm which entity deducted it so our records and certificate match.`;
      case STATUS.SECTION: return `- ${q}, invoice(s) ${refs}: TDS ₹${inr(r.booksTds)} was reported under "${r.stmt[0].section}", but the payment was "${r.books[0].section || 'professional fees'}". Please correct the section.`;
      default: return r.flags.includes('not_deposited') ? `- ${q}, invoice(s) ${refs}: tax deducted ₹${inr(r.stmtTds)} but deposited ₹${inr(sum(r.stmt, 'deposited'))}.` : '';
    }
  }).filter(Boolean);
  const notDep = d.items.some((r) => r.flags.includes('not_deposited') && r.status !== STATUS.MISSING);
  return [
    `Subject: TDS credit not reflecting in Form 26AS/168: ${who}${d.tan ? ` (your TAN ${d.tan})` : ''}`,
    '',
    `Dear ${d.name || 'Sir/Madam'} accounts team,`,
    '',
    `We reconciled our Form 26AS/Form 168 (PAN ${pan || '[PAN]'}) with our books for ${d.quarters.join(', ') || 'the year'}. The following TDS deducted by you needs your attention:`,
    ...lines,
    '',
    `Total TDS credit at risk: ₹${inr(d.atRisk)}.`,
    '',
    'Please check the PAN, section and amounts in your TDS statement for these quarters and, where needed, file a correction statement so the credit reflects against our PAN. Kindly also share the TDS certificate for these entries.',
    notDep ? 'Where tax was deducted but not fully deposited, please deposit the balance and update the statement.' : '',
    'If the correction does not reflect within a few weeks, we may raise a request on the TRACES grievance system for your TAN.',
    '',
    'Thank you,',
    who,
  ].filter((l, i, a) => !(l === '' && a[i - 1] === '')).join('\n');
}

/** Flat rows for CSV/Excel (PAN never included). */
export function resultsToRowsTds(results) {
  return results.map((r) => ({
    Status: r.status, 'Matched as': r.matchedAs || '', 'Match pass': r.how, TAN: r.tan, Deductor: r.deductor, 'Books party': r.party, Quarter: r.quarter,
    'Invoice refs': r.books.map((b) => b.ref).join(', '), 'Books dates': r.books.map((b) => b.date).join(', '), 'Statement dates': r.stmt.map((s) => s.date).join(', '),
    'Books section': [...new Set(r.books.map((b) => b.section))].join(', '), 'Statement section': [...new Set(r.stmt.map((s) => s.section))].join(', '),
    'Booking status': [...new Set(r.stmt.map((s) => s.status))].join(', '),
    'Books TDS': r.booksTds, 'Statement TDS': r.stmtTds, 'Difference': round2(r.booksTds - r.stmtTds), 'Credit at risk': r.atRisk,
    Flags: r.flags.map((f) => FLAG_TEXT[f] || f).join('; '), Cause: r.cause ? CAUSE_TEXT[r.cause] : '',
  }));
}
export const FLAG_TEXT = { not_final: 'Booking status not F', not_deposited: 'Deducted more than deposited', rate: 'Rate check', old_code: 'Old 194-series code after 1 Apr 2026' };
