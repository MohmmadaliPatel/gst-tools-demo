// Sample rate cards: fictional prices; weights are approximate sample values (a client build uses the client's own weight chart).
export const PRESETS = {
  steel: {
    label: 'Pipes & tubes trader (priced per kg)',
    seller: { name: 'Sample Steel Traders', state: 'Tamil Nadu', gstin: '33ABCDE1234F1Z5' },
    terms: 'Prices ex-godown. Weight is theoretical (kg/m x length); billing on actual weighment. Payment: 100% before dispatch. Validity: 7 days.',
    items: [
      { name: 'MS ERW pipe 1" NB, Medium (C)', hsn: '7306', unit: 'm', basis: 'kg', kgPerUnit: 2.42, rate: 64, gst: 18 },
      { name: 'MS ERW pipe 2" NB, Medium (C)', hsn: '7306', unit: 'm', basis: 'kg', kgPerUnit: 5.10, rate: 63, gst: 18 },
      { name: 'GI pipe 1.5" NB, Medium', hsn: '7306', unit: 'm', basis: 'kg', kgPerUnit: 3.75, rate: 78, gst: 18 },
      { name: 'SS 304 seamless tube 25.4 x 1.65 mm', hsn: '7304', unit: 'm', basis: 'kg', kgPerUnit: 0.98, rate: 310, gst: 18 },
      { name: 'Copper tube 15 mm, 0.7 mm wall', hsn: '7411', unit: 'm', basis: 'kg', kgPerUnit: 0.28, rate: 960, gst: 18 },
      { name: 'Cutting & threading charges', hsn: '998898', unit: 'Nos', basis: 'unit', rate: 40, gst: 18 },
    ],
    lines: [[0, 120, 0], [1, 60, 2], [3, 24, 0], [5, 30, 0]],
  },
  export: {
    label: 'Export cost sheet (FOB, with container fill)',
    seller: { name: 'Sample Exports LLP', state: 'Uttar Pradesh', gstin: '09ABCDE1234F1Z2' },
    terms: 'FOB Nhava Sheva. Zero-rated export under LUT. 30% advance, 70% against scanned B/L. Validity: 15 days.',
    items: [
      { name: 'Bath towel 70x140 cm, 500 GSM (carton of 24)', hsn: '6302', unit: 'ctn', basis: 'unit', rate: 4320, gst: 5, cbmPerUnit: 0.085 },
      { name: 'Hotel bed sheet, percale 250 TC (carton of 20)', hsn: '6302', unit: 'ctn', basis: 'unit', rate: 7400, gst: 5, cbmPerUnit: 0.07 },
      { name: 'Facial tissue 2-ply, 100 pulls (carton of 48)', hsn: '4818', unit: 'ctn', basis: 'unit', rate: 1150, gst: 12, cbmPerUnit: 0.06 },
      { name: 'Masala incense 100 g box (carton of 120)', hsn: '3307', unit: 'ctn', basis: 'unit', rate: 3600, gst: 5, cbmPerUnit: 0.04 },
    ],
    lines: [[0, 120, 0], [1, 80, 0], [2, 60, 3]],
    export: true,
  },
  translation: {
    label: 'Translation agency (priced per word)',
    seller: { name: 'Sample Language Services', state: 'Chandigarh', gstin: '04ABCDE1234F1Z8' },
    terms: 'Rates per source word. Certified copies on request. Turnaround starts after confirmation. 50% advance.',
    items: [
      { name: 'English > Hindi translation', hsn: '998395', unit: 'word', basis: 'unit', rate: 1.6, gst: 18 },
      { name: 'English > German translation', hsn: '998395', unit: 'word', basis: 'unit', rate: 4.5, gst: 18 },
      { name: 'Proofreading (second linguist)', hsn: '998395', unit: 'word', basis: 'unit', rate: 0.6, gst: 18 },
      { name: 'Certification & notary coordination', hsn: '998395', unit: 'doc', basis: 'unit', rate: 750, gst: 18 },
      { name: 'Express turnaround surcharge', hsn: '998395', unit: 'job', basis: 'unit', rate: 1500, gst: 18 },
    ],
    lines: [[0, 4200, 0], [2, 4200, 0], [3, 2, 0]],
  },
};
