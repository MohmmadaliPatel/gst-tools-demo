// Renewals & fee reminders: classify members/students by expiry, sessions left and pending fees; fill message templates.
const n = (v) => { const x = Number(String(v ?? '').replace(/[,₹\s]/g, '')); return Number.isFinite(x) ? x : 0; };
const pick = (row, names) => { for (const k of Object.keys(row)) if (names.includes(k.trim().toLowerCase())) return row[k]; return ''; };
const day = (s) => Math.floor(new Date(`${s}T00:00:00Z`).getTime() / 864e5);
/** Accepts YYYY-MM-DD or DD-MM-YYYY / DD/MM/YYYY (Indian sheets). */
export function isoDate(s) {
  const t = String(s ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const m = t.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return '';
}
export function normalizeMembers(rows) {
  return rows.map((r) => ({
    name: pick(r, ['name', 'student', 'member', 'client']).trim(),
    plan: pick(r, ['plan', 'package', 'course', 'batch']),
    expiry: isoDate(pick(r, ['expiry', 'expiry date', 'valid till', 'end date'])),
    total: n(pick(r, ['sessions_total', 'classes total', 'total sessions', 'hours total'])),
    used: n(pick(r, ['sessions_used', 'classes used', 'attended', 'hours used'])),
    fee: n(pick(r, ['fee_total', 'fee', 'fees', 'amount'])),
    paid: n(pick(r, ['fee_paid', 'paid', 'amount paid'])),
    renewalPrice: n(pick(r, ['renewal_price', 'renewal fee', 'renewal'])),
  })).filter((m) => m.name);
}
/** opts: {dueDays=7, lowSessions=2}. Returns member + {daysLeft, left, pending, flags[], status} */
export function classify(m, today, opts = {}) {
  const dueDays = opts.dueDays ?? 7, low = opts.lowSessions ?? 2;
  const daysLeft = m.expiry ? day(m.expiry) - day(today) : null;
  const left = m.total ? Math.max(m.total - m.used, 0) : null;
  const pending = Math.max(m.fee - m.paid, 0);
  const flags = [];
  if (daysLeft !== null && daysLeft < 0) flags.push('Expired');
  else if (daysLeft !== null && daysLeft <= dueDays) flags.push('Due-soon');
  if (left !== null && left <= low) flags.push('Low-balance');
  if (pending > 0) flags.push('Fee-pending');
  return { ...m, daysLeft, left, pending, flags, status: flags[0] || 'Active' };
}
export function buildBoard(members, today, opts) {
  const order = { Expired: 0, 'Due-soon': 1, 'Low-balance': 2, 'Fee-pending': 3, Active: 4 };
  return members.map((m) => classify(m, today, opts)).sort((a, b) => order[a.status] - order[b.status] || (a.daysLeft ?? 1e9) - (b.daysLeft ?? 1e9));
}
const fmtDate = (iso) => { if (!iso) return ''; const [y, mo, d] = iso.split('-'); return `${Number(d)} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(mo) - 1]} ${y}`; };
/** {first} {name} {plan} {expiry} {days} {left} {pending} {renewal} {business} placeholders. Unknown ones are left as-is. */
export function fillTemplate(tpl, r, business = '') {
  const vals = {
    first: r.name.split(/\s+/)[0], name: r.name, plan: r.plan, expiry: fmtDate(r.expiry), days: r.daysLeft === null ? '' : String(Math.abs(r.daysLeft)),
    left: r.left === null ? '' : String(r.left), pending: `₹${r.pending.toLocaleString('en-IN')}`, renewal: `₹${(r.renewalPrice || r.fee).toLocaleString('en-IN')}`, business,
  };
  return tpl.replace(/\{(\w+)\}/g, (m, k) => (k in vals ? vals[k] : m));
}
export const DEFAULT_TEMPLATES = {
  Expired: 'Hi {first}, your {plan} plan ended on {expiry}. We would love to have you back: renewal is {renewal}. Reply here and we will keep your usual slot. – {business}',
  'Due-soon': 'Hi {first}, a quick reminder that your {plan} plan ends on {expiry} ({days} days left). Renewal is {renewal}. Shall we renew it for you? – {business}',
  'Low-balance': 'Hi {first}, you have {left} session(s) left on your {plan} package. Want to top up so your classes continue without a gap? – {business}',
  'Fee-pending': 'Hi {first}, a gentle reminder that {pending} is pending for {plan}. Please ignore if already paid. – {business}',
};
export function renewalPipeline(board, days = 30) {
  const due = board.filter((r) => r.daysLeft !== null && r.daysLeft >= 0 && r.daysLeft <= days);
  return { count: due.length, value: due.reduce((s, r) => s + (r.renewalPrice || r.fee), 0), pendingFees: board.reduce((s, r) => s + r.pending, 0) };
}
