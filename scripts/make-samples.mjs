// Generates the bundled SYNTHETIC sample files. All names and GSTINs are fictional
// (checksum-valid format only). Run: node scripts/make-samples.mjs
import { writeFileSync } from 'node:fs';
import { makeGstin } from '../js/gst.js';
import { toCsv } from '../js/csv.js';

const me = makeGstin('27', 'AAECD0001K');
const S = {
  a: ['27', 'AABCE1111M', 'Example Steel Traders'], b: ['27', 'AADFS2222P', 'Sample Office Supplies'],
  c: ['24', 'AAGCT3333Q', 'Test Logistics Pvt Ltd'], d: ['29', 'AAHCD4444R', 'Demo Cloud Services Pvt Ltd'],
  e: ['27', 'AAJFM5555L', 'Mock Packaging Co'], f: ['33', 'AAKCF6666N', 'Fictional Chemicals Ltd'],
  g: ['07', 'AALPZ7777H', 'Placeholder Printing Works'], h: ['27', 'AAMCQ8888J', 'Imaginary Electricals LLP'],
};
const G = Object.fromEntries(Object.entries(S).map(([k, [st, pan, n]]) => [k, { gstin: makeGstin(st, pan), name: n, st }]));
const tax = (s, tv, rt) => (s === '27' ? { igst: 0, cgst: +(tv * rt / 200).toFixed(2), sgst: +(tv * rt / 200).toFixed(2) } : { igst: +(tv * rt / 100).toFixed(2), cgst: 0, sgst: 0 });
const inv = (k, no, dt, tv, rt, extra = {}) => { const t = tax(G[k].st, tv, rt); return { k, no, dt, tv, ...t, val: +(tv + t.igst + t.cgst + t.sgst).toFixed(2), ...extra }; };

// [2B record, books record] scenarios
const twoB = [
  inv('a', 'EST/1001', '03-09-2026', 100000, 18), inv('a', 'EST/1017', '12-09-2026', 45000, 18),
  inv('b', 'SOS-0045', '05-09-2026', 12000, 12),
  inv('c', 'TL/26-27/118', '08-09-2026', 80000, 5),
  inv('d', 'DCS2026090041', '01-09-2026', 150000, 18),
  inv('e', 'MPC/552', '18-09-2026', 30000, 12),
  inv('f', 'FCL-7781', '21-09-2026', 64000, 18),
  inv('g', 'PPW/233', '25-09-2026', 9000, 18, { itcavl: 'N', rsn: 'P' }),
  inv('h', 'IE/0091', '27-09-2026', 22000, 18),
  inv('h', 'IE/0094', '29-09-2026', 15500.4, 18),
  inv('b', 'SOS-0052', '28-09-2026', 6400, 18),
];
const books = [
  { ...twoB[0] },                                    // exact match
  { ...twoB[1], tv: 45000.4 },                       // within ₹1 tolerance -> matched
  { ...twoB[2], no: 'SOS/45' },                      // same after normalisation -> matched
  { ...twoB[3], no: '118' },                         // fuzzy invoice no -> mismatch (inv no)
  { ...twoB[4], tv: 150500, cgst: 0, sgst: 0, igst: 27090 }, // taxable value differs
  { ...twoB[5], dt: '28-09-2026' },                  // date differs
  { ...twoB[6], igst: 0, cgst: 5760, sgst: 5760 },   // wrong tax heads
  { ...twoB[8], gstinOverride: makeGstin('27', 'AAMCQ8888J', '2') }, // GSTIN typo (same PAN)
  inv('a', 'EST/1033', '30-09-2026', 52000, 18),     // only in books
  inv('e', 'MPC/561', '29-09-2026', 18500, 12),      // only in books
];
const cn2b = { k: 'a', no: 'EST/CN/07', dt: '20-09-2026', ...tax('27', 5000, 18), tv: 5000 };

const supmap = new Map();
for (const r of twoB) {
  if (!supmap.has(r.k)) supmap.set(r.k, { ctin: G[r.k].gstin, trdnm: G[r.k].name, supfildt: '11-10-2026', supprd: '092026', inv: [] });
  const rt = r.k === 'c' ? 5 : r.k === 'b' && r.no === 'SOS-0045' ? 12 : r.k === 'e' ? 12 : 18;
  supmap.get(r.k).inv.push({
    inum: r.no, typ: 'R', dt: r.dt, val: r.val, pos: '27', rev: 'N', itcavl: r.itcavl || 'Y', rsn: r.rsn || '', diffprcnt: 1,
    srctyp: r.k === 'd' ? 'e-Invoice' : 'Upload', irn: '', irngendate: '',
    items: [{ num: 1, rt, txval: r.tv, igst: r.igst, cgst: r.cgst, sgst: r.sgst, cess: 0 }],
  });
}
const gstr2b = {
  _note: 'SYNTHETIC SAMPLE in the public GSTR-2B JSON shape. All names and GSTINs are fictional.',
  chksum: 'SAMPLE', data: {
    gstin: me, rtnprd: '092026', version: '1.0', gendt: '14-10-2026',
    docdata: {
      b2b: [...supmap.values()],
      cdnr: [{ ctin: G.a.gstin, trdnm: G.a.name, supfildt: '11-10-2026', supprd: '092026', nt: [{ ntnum: cn2b.no, typ: 'C', suptyp: 'R', dt: cn2b.dt, val: 5900, pos: '27', rev: 'N', itcavl: 'Y', rsn: '', diffprcnt: 1, srctyp: 'Upload', irn: '', irngendate: '', items: [{ num: 1, rt: 18, txval: 5000, igst: 0, cgst: 450, sgst: 450, cess: 0 }] }] }],
    },
  },
};
writeFileSync('samples/gstr2b_sample.json', JSON.stringify(gstr2b, null, 2));

const rows = books.map((r) => ({
  'Supplier GSTIN': r.gstinOverride || G[r.k].gstin, 'Supplier Name': G[r.k].name, 'Type': 'Invoice',
  'Invoice No': r.no, 'Invoice Date': r.dt, 'Invoice Value': +(r.tv + r.igst + r.cgst + r.sgst).toFixed(2),
  'Taxable Value': r.tv, IGST: r.igst, CGST: r.cgst, SGST: r.sgst, Cess: 0,
}));
rows.push({ 'Supplier GSTIN': G.a.gstin, 'Supplier Name': G.a.name, Type: 'Credit Note', 'Invoice No': 'EST-CN-7', 'Invoice Date': '20-09-2026', 'Invoice Value': 5900, 'Taxable Value': 5000, IGST: 0, CGST: 450, SGST: 450, Cess: 0 });
writeFileSync('samples/purchase_register.csv', toCsv(rows).replace(/^\uFEFF/, ''));

const ein = [
  { doc_no: 'DEMO/26-27/101', doc_date: '2026-10-20', sup_typ: 'B2B', doc_type: 'INV', seller_gstin: me, seller_name: 'Demo Software Solutions Pvt Ltd', seller_addr: '101 Sample Tech Park', seller_loc: 'Pune', seller_pin: '411001', buyer_gstin: G.d.gstin, buyer_name: G.d.name, buyer_addr: '22 Example Road', buyer_loc: 'Bengaluru', buyer_pin: '560001', pos: '29', item_desc: 'GST reconciliation tool - fixed price build', is_service: 'Y', hsn: '998314', qty: 1, unit: 'OTH', unit_price: 30000, discount: 0, gst_rate: 18 },
  { doc_no: 'DEMO/26-27/101', doc_date: '2026-10-20', sup_typ: 'B2B', doc_type: 'INV', seller_gstin: me, seller_name: 'Demo Software Solutions Pvt Ltd', seller_addr: '101 Sample Tech Park', seller_loc: 'Pune', seller_pin: '411001', buyer_gstin: G.d.gstin, buyer_name: G.d.name, buyer_addr: '22 Example Road', buyer_loc: 'Bengaluru', buyer_pin: '560001', pos: '29', item_desc: 'Annual schema update support', is_service: 'Y', hsn: '998313', qty: 1, unit: 'OTH', unit_price: 12500.5, discount: 500, gst_rate: 18 },
  { doc_no: 'DEMO/26-27/102', doc_date: '2026-10-21', sup_typ: 'B2B', doc_type: 'INV', seller_gstin: me, seller_name: 'Demo Software Solutions Pvt Ltd', seller_addr: '101 Sample Tech Park', seller_loc: 'Pune', seller_pin: '411001', buyer_gstin: G.e.gstin, buyer_name: G.e.name, buyer_addr: '9 Mock Industrial Estate', buyer_loc: 'Mumbai', buyer_pin: '400001', pos: '27', item_desc: 'Thermal label printer', is_service: 'N', hsn: '84433250', qty: 3, unit: 'NOS', unit_price: 8499.99, discount: 0, gst_rate: 18 },
];
writeFileSync('samples/einvoice_rows.csv', toCsv(ein).replace(/^\uFEFF/, ''));
console.log('samples written; recipient GSTIN', me);
