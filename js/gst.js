// Core GST helpers: GSTIN/PAN validation, checksum, state codes, rounding.
// Pure functions, shared by the browser UI and the Node unit tests.

export const STATE_CODES = {
  '01': 'Jammu & Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh',
  '05': 'Uttarakhand', '06': 'Haryana', '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh',
  '10': 'Bihar', '11': 'Sikkim', '12': 'Arunachal Pradesh', '13': 'Nagaland', '14': 'Manipur',
  '15': 'Mizoram', '16': 'Tripura', '17': 'Meghalaya', '18': 'Assam', '19': 'West Bengal',
  '20': 'Jharkhand', '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh', '24': 'Gujarat',
  '26': 'Dadra & Nagar Haveli and Daman & Diu', '27': 'Maharashtra', '29': 'Karnataka',
  '30': 'Goa', '31': 'Lakshadweep', '32': 'Kerala', '33': 'Tamil Nadu', '34': 'Puducherry',
  '35': 'Andaman & Nicobar Islands', '36': 'Telangana', '37': 'Andhra Pradesh', '38': 'Ladakh',
  '97': 'Other Territory',
};
// 96 = place of supply outside India (exports) - valid only as Pos, not as a GSTIN prefix.
export const POS_CODES = { ...STATE_CODES, '96': 'Other Country (export)' };

const CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
export const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
export const PAN_RE = /^[A-Z]{3}[ABCFGHLJPTE][A-Z][0-9]{4}[A-Z]$/;

/** Mod-36 check character over the first 14 chars of a GSTIN. */
export function gstinCheckChar(first14) {
  const s = String(first14).toUpperCase();
  if (s.length !== 14) throw new Error('need 14 characters');
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const v = CHARS.indexOf(s[i]);
    if (v < 0) throw new Error(`invalid character "${s[i]}"`);
    const p = v * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(p / 36) + (p % 36);
  }
  return CHARS[(36 - (sum % 36)) % 36];
}

export function normalizeGstin(g) {
  return String(g ?? '').toUpperCase().replace(/[^0-9A-Z]/g, '');
}

/** Returns { valid, errors[], stateCode, pan } */
export function validateGstin(raw) {
  const g = normalizeGstin(raw);
  const errors = [];
  if (g.length !== 15) errors.push(`GSTIN must be 15 characters (got ${g.length}).`);
  else if (!GSTIN_RE.test(g)) errors.push('GSTIN format is invalid (expected 2-digit state + 10-char PAN + entity no. + "Z" + check char).');
  else {
    if (!STATE_CODES[g.slice(0, 2)]) errors.push(`GSTIN state code "${g.slice(0, 2)}" is not a valid state/UT code.`);
    const pan = g.slice(2, 12);
    if (!PAN_RE.test(pan)) errors.push(`Embedded PAN "${pan}" is not a valid PAN format.`);
    const want = gstinCheckChar(g.slice(0, 14));
    if (want !== g[14]) errors.push(`GSTIN checksum failed: last character should be "${want}", not "${g[14]}".`);
  }
  return { valid: errors.length === 0, errors, gstin: g, stateCode: g.slice(0, 2), pan: g.slice(2, 12) };
}

export function validatePan(p) {
  const s = String(p ?? '').toUpperCase().trim();
  return PAN_RE.test(s);
}

/** Make a checksum-valid GSTIN (for synthetic test data only). */
export function makeGstin(stateCode, pan, entity = '1') {
  const first14 = `${stateCode}${pan}${entity}Z`;
  return first14 + gstinCheckChar(first14);
}

/** Round half away from zero to 2 decimals without binary-float drift. */
export function round2(x) {
  const n = Number(x) || 0;
  const s = Math.sign(n);
  return (s * Math.round(Math.abs(n) * 100 + 1e-7)) / 100;
}

export const toNum = (v) => {
  if (v === null || v === undefined || v === '') return 0;
  const n = Number(String(v).replace(/[,₹\s]/g, ''));
  return Number.isFinite(n) ? n : NaN;
};
