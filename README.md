# GST compliance tools: portfolio demo

A fully static site with working, in-browser demos (two GST tools and three quick small-business tools) and a services/about landing page.

| Page | What it does |
|---|---|
| `index.html` | Landing page: services (fixed-price packages), demos, About me, Selected work, contact. **All text comes from `profile.json`.** |
| `recon.html` | **GSTR-2B vs purchase register reconciliation.** Normalises GSTINs and invoice numbers, then matches in three passes: (1) exact GSTIN + invoice no., (2) fuzzy invoice no. within the same GSTIN, scored on similarity, date and amount, (3) GSTIN typos with the same PAN or 1–2 characters different. Shows Matched / Mismatch (with field-by-field differences) / Only in 2B / Only in books, ITC summary totals, and a vendor follow-up sheet. Exports CSV and an Excel workbook. Tolerances for value, tax and date are configurable. |
| `einvoice.html` | **GST e-invoice JSON builder & validator** (IRP schema v1.1). Build from a form or bulk CSV, or paste existing JSON. Checks GSTIN format and mod-36 checksum, PAN, HSN/SAC length and service codes, state/POS codes, CGST+SGST vs IGST by place of supply, tax math with ±₹1 tolerance, totals and round-off, doc no./date/PIN rules. **It does not submit anything to IRP/NIC/GSTN.** |
| `quote.html` | **Quotation & proforma builder.** Rate-card presets (per-kg pipes/tubes, FOB export cost sheet with CBM/container fill, per-word translation; `?type=steel|export|translation`), discount, CGST/SGST vs IGST by state, freight, round-off, amount in words (lakh/crore), FY quote numbering, print/PDF, and a quote register with follow-up queue (browser local storage only). |
| `stock.html` | **Stock tracker & channel reconciliation.** SKU master + IN/OUT/RETURN/DAMAGED/ADJUST movements → available stock by SKU/size/colour, low/negative stock, unknown-SKU warnings, Shopify/marketplace inventory comparison (oversell risk), size×colour grid, daily Excel report. |
| `renewals.html` | **Renewals & fee reminder board.** Member/student CSV (DD-MM-YYYY ok) → expired / due soon / low sessions / fee pending, editable message templates with placeholders, copy-to-clipboard, reminder list CSV. Sends nothing. |
| `extract.html` | **Invoice & PO extractor.** Reads supplier invoice PDFs (Indian GST, US sales tax, UK VAT, AU GST) in the browser with the vendored pdf.js: vendor, invoice no., dates, PO no., currency, tax and line items, each with a confidence score; checks totals, tax and duplicates; matches against a purchase-order CSV (price, quantity, missing PO); exports bills for QuickBooks Online, Xero, QuickBooks Desktop (IIF), Tally and Zoho Books. Sample PDFs in `samples/extract/` (regenerate with `node scripts/make-extract-samples.mjs`). Sends nothing. |

**Third-party code:** `vendor/pdfjs/` is Mozilla pdf.js 4.10.38, unmodified, under the Apache License 2.0 (`vendor/pdfjs/LICENSE`). Everything else is original to this repo.
**Privacy:** there's no backend, API keys, analytics or external requests. Every file is processed in the browser, and the smoke test fails if the page makes any non-local request.
**Data:** all sample files in `samples/` are synthetic, with fictional names and checksum-valid but made-up GSTINs (regenerate with `npm run samples`). The formats follow public GSTN (GSTR-2B JSON) and NIC (e-invoice schema v1.1) specs.

## Edit the content
All landing-page text lives in **`profile.json`** (name, about, strengths, stack, services, selected work). Text in `[square brackets]` renders as a highlighted placeholder, so keep the file free of them.

## Run locally
ES modules need an HTTP server (opening the file directly won't work):
```bash
cd demo
python3 -m http.server 8080      # then open http://localhost:8080
```

## Tests
Requires Node 18+, with no dependencies:
```bash
npm test          # node --test tests/  (GSTIN checksum, PAN, rounding, matching logic, e-invoice tax math/validation)
```
Optional browser smoke test + screenshots (needs `npm i playwright && npx playwright install chromium`):
```bash
python3 -m http.server 8080 & node scripts/screenshots.mjs
```

## Project layout
```
index.html recon.html einvoice.html quote.html stock.html renewals.html profile.json
css/style.css
js/gst.js        GSTIN/PAN validation, checksum, state codes, rounding
js/recon.js      reconciliation engine (pure)
js/einvoice.js   e-invoice builder + validator (pure)
js/csv.js        CSV parse/export + Excel (SpreadsheetML) writer
js/quote.js      quotation maths, amount in words, FY numbering, follow-ups (pure)
js/stock.js      stock ledger + channel reconciliation (pure)
js/renewals.js   renewal/fee classification + message templates (pure)
js/extract*.js   invoice/PO extraction, checks, PO matching and accounting exports
vendor/pdfjs/    third-party: Mozilla pdf.js 4.10.38 (unmodified build), Apache-2.0, see vendor/pdfjs/LICENSE
js/*-ui.js       page wiring
samples/         synthetic GSTR-2B JSON, purchase register CSV, e-invoice CSV, stock and member CSVs
tests/           node:test unit tests
scripts/         sample generator, screenshot/smoke script
```

## Deploy
Static files only, nothing to build. Served with GitHub Pages from the default branch root (`.nojekyll` included).

## Known limits (demo scope)
- The Excel export is SpreadsheetML (`.xls` XML). Excel and LibreOffice open it, though Excel may show a format notice. A client build would use a real `.xlsx` writer.
- GSTR-2B: B2B invoices and CDNR notes are handled. B2BA/ISD/IMPG sections and IMS actions are out of scope for the demo.
- The e-invoice validator covers the main IRP business rules but isn't the full NIC rule set. The final check is always the IRP itself.
