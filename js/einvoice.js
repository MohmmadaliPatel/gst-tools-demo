// GST e-invoice (IRP schema v1.1) builder + offline validator. Does NOT talk to any government portal.
import { validateGstin, STATE_CODES, POS_CODES, round2, toNum } from './gst.js';

export const GST_RATES = [0, 0.1, 0.25, 1, 1.5, 3, 5, 6, 7.5, 12, 18, 28, 40];
export const SUP_TYPES = ['B2B', 'SEZWP', 'SEZWOP', 'EXPWP', 'EXPWOP', 'DEXP'];
export const DOC_TYPES = ['INV', 'CRN', 'DBN'];
export const UQC = ['BAG', 'BAL', 'BDL', 'BKL', 'BOU', 'BOX', 'BTL', 'BUN', 'CAN', 'CBM', 'CCM', 'CMS', 'CTN', 'DOZ', 'DRM', 'GGK', 'GMS', 'GRS', 'GYD', 'KGS', 'KLR', 'KME', 'LTR', 'MLT', 'MTR', 'MTS', 'NOS', 'OTH', 'PAC', 'PCS', 'PRS', 'QTL', 'ROL', 'SET', 'SQF', 'SQM', 'SQY', 'TBS', 'TGM', 'THD', 'TON', 'TUB', 'UGS', 'UNT', 'YDS'];
const TOL = 1; // IRP tolerates ±₹1 rounding differences on computed values
const DOCNO_RE = /^[A-Za-z1-9][A-Za-z0-9/-]{0,15}$/;
const DATE_RE = /^(0[1-9]|[12][0-9]|3[01])\/(0[1-9]|1[0-2])\/(20\d\d)$/;

export function toIrpDate(s) {
  const t = String(s ?? '').trim();
  let m;
  if ((m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/))) return `${m[3]}/${m[2]}/${m[1]}`;
  if ((m = t.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/))) return `${m[1].padStart(2, '0')}/${m[2].padStart(2, '0')}/${m[3]}`;
  return t;
}

/** Inter-state (IGST) vs intra-state (CGST+SGST) per supply type and place of supply. */
export function isInterState({ supTyp = 'B2B', sellerStcd, pos, igstOnIntra = 'N' }) {
  if (['SEZWP', 'SEZWOP', 'EXPWP', 'EXPWOP'].includes(supTyp)) return true;
  if (igstOnIntra === 'Y') return true;
  return String(sellerStcd) !== String(pos);
}

export function computeItemTax({ qty, unitPrice, discount = 0, gstRt, cesRt = 0, othChrg = 0 }, inter, withoutPayment = false) {
  const totAmt = round2(toNum(qty) * toNum(unitPrice));
  const assAmt = round2(totAmt - toNum(discount));
  const tax = withoutPayment ? 0 : round2((assAmt * toNum(gstRt)) / 100);
  const igst = inter ? tax : 0;
  // Intra-state: each half is computed and rounded separately (CGST = SGST), as on the IRP.
  const half = withoutPayment ? 0 : round2((assAmt * toNum(gstRt)) / 200);
  const cgst = inter ? 0 : half;
  const sgst = inter ? 0 : half;
  const ces = withoutPayment ? 0 : round2((assAmt * toNum(cesRt)) / 100);
  const totItemVal = round2(assAmt + igst + cgst + sgst + ces + toNum(othChrg));
  return { totAmt, assAmt, igst, cgst, sgst, ces, totItemVal };
}

/** Simple input model -> IRP v1.1 JSON (taxes and totals calculated). */
export function buildEinvoice(inp) {
  const supTyp = inp.supTyp || 'B2B';
  const sellerStcd = inp.seller.stcd || String(inp.seller.gstin).slice(0, 2);
  const pos = inp.buyer.pos || inp.buyer.stcd || String(inp.buyer.gstin).slice(0, 2);
  const inter = isInterState({ supTyp, sellerStcd, pos, igstOnIntra: inp.igstOnIntra });
  const wop = supTyp.endsWith('WOP');
  const items = inp.items.map((it, i) => {
    const c = computeItemTax(it, inter, wop);
    return {
      SlNo: String(i + 1), PrdDesc: it.desc || null, IsServc: it.isServc === 'Y' || it.isServc === true ? 'Y' : 'N',
      HsnCd: String(it.hsn ?? ''), Qty: toNum(it.qty), Unit: it.unit || (it.isServc === 'Y' ? 'OTH' : 'NOS'),
      UnitPrice: toNum(it.unitPrice), TotAmt: c.totAmt, Discount: toNum(it.discount), AssAmt: c.assAmt,
      GstRt: toNum(it.gstRt), IgstAmt: c.igst, CgstAmt: c.cgst, SgstAmt: c.sgst,
      CesRt: toNum(it.cesRt), CesAmt: c.ces, StateCesAmt: 0, OthChrg: toNum(it.othChrg), TotItemVal: c.totItemVal,
    };
  });
  const s = (k) => round2(items.reduce((a, it) => a + it[k], 0));
  const othChrg = toNum(inp.othChrg);
  const invDiscount = toNum(inp.invDiscount);
  const exact = round2(s('TotItemVal') + othChrg - invDiscount);
  const total = inp.roundOff === false ? exact : Math.round(exact);
  const party = (p, buyer) => ({
    Gstin: p.gstin, LglNm: p.lglNm, TrdNm: p.trdNm || null, ...(buyer ? { Pos: pos } : {}),
    Addr1: p.addr1, Addr2: p.addr2 || null, Loc: p.loc, Pin: Number(p.pin), Stcd: p.stcd || String(p.gstin).slice(0, 2),
    Ph: p.ph || null, Em: p.em || null,
  });
  return {
    Version: '1.1',
    TranDtls: { TaxSch: 'GST', SupTyp: supTyp, RegRev: inp.regRev || 'N', EcmGstin: null, IgstOnIntra: inp.igstOnIntra || 'N' },
    DocDtls: { Typ: inp.docTyp || 'INV', No: inp.docNo, Dt: toIrpDate(inp.docDt) },
    SellerDtls: party(inp.seller, false),
    BuyerDtls: party(inp.buyer, true),
    ItemList: items,
    ValDtls: {
      AssVal: s('AssAmt'), CgstVal: s('CgstAmt'), SgstVal: s('SgstAmt'), IgstVal: s('IgstAmt'), CesVal: s('CesAmt'), StCesVal: 0,
      Discount: invDiscount, OthChrg: othChrg, RndOffAmt: round2(total - exact), TotInvVal: round2(total),
    },
  };
}

/** Validate an IRP v1.1 JSON object. Returns { valid, errors:[{path,message}], warnings:[...] } */
export function validateEinvoice(doc) {
  const errors = [], warnings = [];
  const err = (path, message) => errors.push({ path, message });
  const warn = (path, message) => warnings.push({ path, message });
  const near = (a, b) => Math.abs(round2(toNum(a) - toNum(b))) <= TOL + 1e-9;
  if (!doc || typeof doc !== 'object') return { valid: false, errors: [{ path: '', message: 'Not a JSON object.' }], warnings };

  if (doc.Version !== '1.1') err('Version', `Version must be "1.1" (got ${JSON.stringify(doc.Version)}).`);
  const t = doc.TranDtls || {};
  if (t.TaxSch !== 'GST') err('TranDtls.TaxSch', 'TaxSch must be "GST".');
  if (!SUP_TYPES.includes(t.SupTyp)) err('TranDtls.SupTyp', `SupTyp must be one of ${SUP_TYPES.join(', ')}.`);
  if (t.RegRev && !['Y', 'N'].includes(t.RegRev)) err('TranDtls.RegRev', 'RegRev must be "Y" or "N".');
  if (t.IgstOnIntra && !['Y', 'N'].includes(t.IgstOnIntra)) err('TranDtls.IgstOnIntra', 'IgstOnIntra must be "Y" or "N".');

  const d = doc.DocDtls || {};
  if (!DOC_TYPES.includes(d.Typ)) err('DocDtls.Typ', `Document type must be one of ${DOC_TYPES.join(', ')}.`);
  if (!DOCNO_RE.test(String(d.No ?? ''))) err('DocDtls.No', 'Document number must be 1-16 characters, only letters, digits, "/" and "-", and must not start with 0, "/" or "-".');
  if (!DATE_RE.test(String(d.Dt ?? ''))) err('DocDtls.Dt', 'Document date must be in DD/MM/YYYY format.');
  else {
    const [dd, mm, yy] = d.Dt.split('/').map(Number);
    const dt = new Date(Date.UTC(yy, mm - 1, dd));
    if (dt.getUTCDate() !== dd) err('DocDtls.Dt', `${d.Dt} is not a real calendar date.`);
    else if (dt.getTime() > Date.now() + 86400000) err('DocDtls.Dt', 'Document date cannot be in the future.');
  }

  const s = doc.SellerDtls || {}, b = doc.BuyerDtls || {};
  const gv = validateGstin(s.Gstin);
  if (!gv.valid) gv.errors.forEach((m) => err('SellerDtls.Gstin', `Seller ${m}`));
  const exportish = ['EXPWP', 'EXPWOP'].includes(t.SupTyp);
  if (exportish) {
    if (b.Gstin !== 'URP') err('BuyerDtls.Gstin', 'For exports, buyer GSTIN must be "URP".');
    if (String(b.Pos) !== '96') err('BuyerDtls.Pos', 'For exports, place of supply must be 96 (Other Country).');
  } else {
    const bv = validateGstin(b.Gstin);
    if (!bv.valid) bv.errors.forEach((m) => err('BuyerDtls.Gstin', `Buyer ${m}`));
    if (bv.valid && gv.valid && bv.gstin === gv.gstin) err('BuyerDtls.Gstin', 'Buyer and seller GSTIN cannot be the same.');
  }
  for (const [p, who] of [[s, 'SellerDtls'], [b, 'BuyerDtls']]) {
    if (!p.LglNm || String(p.LglNm).length < 3 || String(p.LglNm).length > 100) err(`${who}.LglNm`, 'Legal name is required (3-100 characters).');
    if (!p.Addr1 || String(p.Addr1).length < 1 || String(p.Addr1).length > 100) err(`${who}.Addr1`, 'Address line 1 is required (max 100 characters).');
    if (!p.Loc || String(p.Loc).length < 3 || String(p.Loc).length > 50) err(`${who}.Loc`, 'Location is required (3-50 characters).');
    const pin = Number(p.Pin);
    if (!Number.isInteger(pin) || pin < 100000 || pin > 999999) err(`${who}.Pin`, 'PIN code must be a 6-digit number (use 999999 for a foreign buyer).');
    const validSt = who === 'BuyerDtls' && exportish ? { ...STATE_CODES, '96': 'Other Country' } : STATE_CODES;
    if (!validSt[String(p.Stcd)]) err(`${who}.Stcd`, `State code "${p.Stcd}" is not a valid state/UT code.`);
  }
  if (gv.valid && String(s.Stcd) !== gv.stateCode) err('SellerDtls.Stcd', `Seller state code ${s.Stcd} does not match the GSTIN prefix ${gv.stateCode}.`);
  if (!POS_CODES[String(b.Pos)]) err('BuyerDtls.Pos', `Place of supply "${b.Pos}" is not a valid state/UT code.`);

  const inter = isInterState({ supTyp: t.SupTyp, sellerStcd: s.Stcd, pos: b.Pos, igstOnIntra: t.IgstOnIntra });
  const wop = String(t.SupTyp || '').endsWith('WOP');
  const items = Array.isArray(doc.ItemList) ? doc.ItemList : [];
  if (!items.length) err('ItemList', 'At least one item is required.');
  if (items.length > 1000) err('ItemList', 'An e-invoice can have at most 1000 items.');
  const seen = new Set();
  items.forEach((it, i) => {
    const p = `ItemList[${i}]`;
    if (seen.has(String(it.SlNo))) err(`${p}.SlNo`, `Duplicate serial number ${it.SlNo}.`); seen.add(String(it.SlNo));
    const hsn = String(it.HsnCd ?? '');
    if (!/^\d+$/.test(hsn) || ![4, 6, 8].includes(hsn.length)) err(`${p}.HsnCd`, `HSN/SAC "${hsn}" must be 4, 6 or 8 digits.`);
    else {
      if (it.IsServc === 'Y' && !hsn.startsWith('99')) err(`${p}.HsnCd`, `Item is marked as a service, but SAC "${hsn}" does not start with 99.`);
      if (it.IsServc !== 'Y' && hsn.startsWith('99')) err(`${p}.IsServc`, `HSN "${hsn}" is a service code (99...), so IsServc must be "Y".`);
      if (hsn.length === 4) warn(`${p}.HsnCd`, 'Businesses with turnover above ₹5 crore must report at least 6 HSN digits.');
    }
    if (!['Y', 'N'].includes(it.IsServc)) err(`${p}.IsServc`, 'IsServc must be "Y" or "N".');
    if (it.Unit && !UQC.includes(it.Unit)) warn(`${p}.Unit`, `Unit "${it.Unit}" is not a standard UQC code.`);
    if (!GST_RATES.includes(toNum(it.GstRt))) err(`${p}.GstRt`, `GST rate ${it.GstRt}% is not a valid rate (${GST_RATES.join(', ')}).`);
    const exp = computeItemTax({ qty: it.Qty, unitPrice: it.UnitPrice, discount: it.Discount, gstRt: it.GstRt, cesRt: it.CesRt, othChrg: it.OthChrg }, inter, wop);
    if (toNum(it.Qty) && toNum(it.UnitPrice) && !near(it.TotAmt, exp.totAmt)) err(`${p}.TotAmt`, `TotAmt ${it.TotAmt} ≠ Qty × UnitPrice = ${exp.totAmt}.`);
    if (!near(it.AssAmt, round2(toNum(it.TotAmt) - toNum(it.Discount)))) err(`${p}.AssAmt`, `AssAmt ${it.AssAmt} ≠ TotAmt − Discount = ${round2(toNum(it.TotAmt) - toNum(it.Discount))}.`);
    const tax = wop ? 0 : round2((toNum(it.AssAmt) * toNum(it.GstRt)) / 100);
    if (inter) {
      if (toNum(it.CgstAmt) || toNum(it.SgstAmt)) err(`${p}.CgstAmt`, `Inter-state supply (seller state ${s.Stcd} → place of supply ${b.Pos}): charge IGST, not CGST/SGST.`);
      if (!near(it.IgstAmt, tax)) err(`${p}.IgstAmt`, `IGST ${it.IgstAmt} ≠ AssAmt × ${it.GstRt}% = ${tax}.`);
    } else {
      if (toNum(it.IgstAmt)) err(`${p}.IgstAmt`, `Intra-state supply (state ${s.Stcd}): charge CGST + SGST, not IGST.`);
      if (!near(it.CgstAmt, tax / 2)) err(`${p}.CgstAmt`, `CGST ${it.CgstAmt} ≠ half of AssAmt × ${it.GstRt}% = ${round2(tax / 2)}.`);
      if (!near(it.SgstAmt, tax / 2)) err(`${p}.SgstAmt`, `SGST ${it.SgstAmt} ≠ half of AssAmt × ${it.GstRt}% = ${round2(tax / 2)}.`);
    }
    const itemTot = round2(toNum(it.AssAmt) + toNum(it.IgstAmt) + toNum(it.CgstAmt) + toNum(it.SgstAmt) + toNum(it.CesAmt) + toNum(it.StateCesAmt) + toNum(it.OthChrg));
    if (!near(it.TotItemVal, itemTot)) err(`${p}.TotItemVal`, `TotItemVal ${it.TotItemVal} ≠ AssAmt + taxes + cess + other charges = ${itemTot}.`);
  });

  const v = doc.ValDtls || {};
  const sum = (k) => round2(items.reduce((a, it) => a + toNum(it[k]), 0));
  [['AssVal', 'AssAmt'], ['CgstVal', 'CgstAmt'], ['SgstVal', 'SgstAmt'], ['IgstVal', 'IgstAmt'], ['CesVal', 'CesAmt']].forEach(([vk, ik]) => {
    if (!near(v[vk], sum(ik))) err(`ValDtls.${vk}`, `${vk} ${v[vk]} ≠ sum of item ${ik} = ${sum(ik)}.`);
  });
  const expTot = round2(sum('TotItemVal') + toNum(v.OthChrg) - toNum(v.Discount) + toNum(v.RndOffAmt));
  if (!near(v.TotInvVal, expTot)) err('ValDtls.TotInvVal', `TotInvVal ${v.TotInvVal} ≠ sum of items + other charges − discount + round-off = ${expTot}.`);
  if (Math.abs(toNum(v.RndOffAmt)) > 1) warn('ValDtls.RndOffAmt', `Round-off of ${v.RndOffAmt} is more than ₹1; check the invoice total.`);
  return { valid: errors.length === 0, errors, warnings };
}

/** CSV rows (one per item, grouped by doc_no) -> input models for buildEinvoice. */
export function rowsToInputs(rows) {
  const docs = new Map();
  for (const r of rows) {
    const k = r.doc_no;
    if (!docs.has(k)) docs.set(k, {
      supTyp: r.sup_typ || 'B2B', docTyp: r.doc_type || 'INV', docNo: r.doc_no, docDt: r.doc_date,
      seller: { gstin: r.seller_gstin, lglNm: r.seller_name, addr1: r.seller_addr, loc: r.seller_loc, pin: r.seller_pin, stcd: r.seller_stcd || String(r.seller_gstin).slice(0, 2) },
      buyer: { gstin: r.buyer_gstin, lglNm: r.buyer_name, addr1: r.buyer_addr, loc: r.buyer_loc, pin: r.buyer_pin, stcd: r.buyer_stcd || String(r.buyer_gstin).slice(0, 2), pos: r.pos || r.buyer_stcd || String(r.buyer_gstin).slice(0, 2) },
      items: [],
    });
    docs.get(k).items.push({ desc: r.item_desc, isServc: r.is_service || 'N', hsn: r.hsn, qty: r.qty, unit: r.unit, unitPrice: r.unit_price, discount: r.discount || 0, gstRt: r.gst_rate });
  }
  return [...docs.values()];
}
