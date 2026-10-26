// Stock ledger engine: movements -> available stock per SKU, low-stock flags, channel (Shopify/marketplace) reconciliation.
const n = (v) => { const x = Number(String(v ?? '').replace(/,/g, '')); return Number.isFinite(x) ? x : 0; };
export const normSku = (s) => String(s ?? '').trim().toUpperCase().replace(/\s+/g, '-');
const pick = (row, names) => { for (const k of Object.keys(row)) if (names.includes(k.trim().toLowerCase())) return row[k]; return ''; };

export const TYPES = { IN: 1, INWARD: 1, PURCHASE: 1, OUT: -1, OUTWARD: -1, SALE: -1, DISPATCH: -1, RETURN: 1, RTO: 1, DAMAGED: -1, DAMAGE: -1, ADJUST: 1 };

export function normalizeMaster(rows) {
  return rows.map((r) => ({
    sku: normSku(pick(r, ['sku', 'sku code', 'item code'])),
    name: pick(r, ['name', 'product', 'product name', 'title']),
    size: pick(r, ['size']), colour: pick(r, ['colour', 'color']),
    reorder: n(pick(r, ['reorder', 'reorder level', 'min stock', 'min'])),
    opening: n(pick(r, ['opening', 'opening stock'])),
  })).filter((r) => r.sku);
}
export function normalizeMoves(rows) {
  return rows.map((r, i) => {
    const type = String(pick(r, ['type', 'movement', 'txn type'])).trim().toUpperCase();
    if (!(type in TYPES)) throw new Error(`Row ${i + 2}: unknown movement type "${type}" (use IN, OUT, RETURN, DAMAGED or ADJUST)`);
    return { date: pick(r, ['date']), sku: normSku(pick(r, ['sku', 'sku code'])), type, qty: n(pick(r, ['qty', 'quantity'])), channel: pick(r, ['channel', 'source']), ref: pick(r, ['ref', 'reference', 'order id']) };
  }).filter((m) => m.sku);
}

/** -> [{sku,name,size,colour,opening,inward,outward,returns,damaged,adjust,available,reorder,status}] */
export function computeStock(master, moves, asOf = null) {
  const by = new Map(master.map((m) => [m.sku, { ...m, inward: 0, outward: 0, returns: 0, damaged: 0, adjust: 0, unknown: false }]));
  for (const mv of moves) {
    if (asOf && mv.date && mv.date > asOf) continue;
    if (!by.has(mv.sku)) by.set(mv.sku, { sku: mv.sku, name: '(not in master)', size: '', colour: '', reorder: 0, opening: 0, inward: 0, outward: 0, returns: 0, damaged: 0, adjust: 0, unknown: true });
    const s = by.get(mv.sku);
    const t = mv.type;
    if (['IN', 'INWARD', 'PURCHASE'].includes(t)) s.inward += mv.qty;
    else if (['OUT', 'OUTWARD', 'SALE', 'DISPATCH'].includes(t)) s.outward += mv.qty;
    else if (['RETURN', 'RTO'].includes(t)) s.returns += mv.qty;
    else if (['DAMAGED', 'DAMAGE'].includes(t)) s.damaged += mv.qty;
    else s.adjust += mv.qty;
  }
  return [...by.values()].map((s) => {
    const available = s.opening + s.inward - s.outward + s.returns - s.damaged + s.adjust;
    const status = available <= 0 ? 'Out' : available <= s.reorder ? 'Low' : 'OK';
    return { ...s, available, status };
  });
}

/** channelRows: [{sku, channel, qty}] -> mismatches where listed qty != available (oversell risk if listed > available). */
export function reconcileChannels(stock, channelRows) {
  const avail = new Map(stock.map((s) => [s.sku, s.available]));
  const out = [];
  for (const r of channelRows) {
    const sku = normSku(pick(r, ['sku', 'variant sku', 'seller sku', 'fsn sku']));
    if (!sku) continue;
    const channel = pick(r, ['channel', 'marketplace']) || 'Channel';
    const listed = n(pick(r, ['qty', 'quantity', 'listed qty', 'inventory', 'available']));
    if (!avail.has(sku)) { out.push({ sku, channel, listed, available: null, diff: null, status: 'Not-listed', note: 'SKU on channel but not in your stock master (check SKU mapping)' }); continue; }
    const a = Math.max(avail.get(sku), 0), diff = listed - a;
    if (diff === 0) continue;
    out.push({ sku, channel, listed, available: a, diff, status: diff > 0 ? 'Oversell-risk' : 'Mismatch-qty', note: diff > 0 ? `Channel shows ${diff} more than you have: reduce listing` : `${-diff} unit(s) not listed: increase listing` });
  }
  return out.sort((x, y) => (y.status === 'Oversell-risk') - (x.status === 'Oversell-risk') || Math.abs(y.diff ?? 0) - Math.abs(x.diff ?? 0));
}

/** Size x colour grid for one product name. */
export function sizeColourMatrix(stock, name) {
  const rows = stock.filter((s) => s.name === name);
  const sizes = [...new Set(rows.map((r) => r.size))], colours = [...new Set(rows.map((r) => r.colour))];
  return { sizes, colours, cell: (sz, c) => rows.find((r) => r.size === sz && r.colour === c)?.available ?? null };
}

/** Day summary: units in/out/returned/damaged on a date, by channel for outward. */
export function daySummary(moves, date) {
  const d = moves.filter((m) => m.date === date);
  const sum = (types) => d.filter((m) => types.includes(m.type)).reduce((s, m) => s + m.qty, 0);
  const byChannel = {};
  d.filter((m) => ['OUT', 'OUTWARD', 'SALE', 'DISPATCH'].includes(m.type)).forEach((m) => { byChannel[m.channel || 'Other'] = (byChannel[m.channel || 'Other'] || 0) + m.qty; });
  return { inward: sum(['IN', 'INWARD', 'PURCHASE']), outward: sum(['OUT', 'OUTWARD', 'SALE', 'DISPATCH']), returns: sum(['RETURN', 'RTO']), damaged: sum(['DAMAGED', 'DAMAGE']), byChannel };
}
