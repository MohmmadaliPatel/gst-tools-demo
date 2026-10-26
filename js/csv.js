// Minimal RFC-4180 CSV parse/serialise + Excel (SpreadsheetML 2003) writer. No dependencies.

export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', q = false;
  const s = String(text).replace(/^\uFEFF/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"') { if (s[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((f) => f.trim() !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== '')) rows.push(row);
  if (!rows.length) return [];
  const head = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? '').trim()])));
}

const esc = (v) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export function toCsv(rows, columns) {
  const cols = columns || (rows[0] ? Object.keys(rows[0]) : []);
  return '\uFEFF' + [cols.map(esc).join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\r\n');
}

const x = (s) => String(s ?? '').replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
/** sheets: [{name, rows:[{}], columns?}] -> SpreadsheetML XML string (opens in Excel / LibreOffice). */
export function toExcelXml(sheets) {
  const ws = sheets.map(({ name, rows, columns }) => {
    const cols = columns || (rows[0] ? Object.keys(rows[0]) : []);
    const cell = (v) => typeof v === 'number' && Number.isFinite(v)
      ? `<Cell><Data ss:Type="Number">${v}</Data></Cell>`
      : `<Cell><Data ss:Type="String">${x(v)}</Data></Cell>`;
    const head = `<Row>${cols.map((c) => `<Cell ss:StyleID="h"><Data ss:Type="String">${x(c)}</Data></Cell>`).join('')}</Row>`;
    const body = rows.map((r) => `<Row>${cols.map((c) => cell(r[c])).join('')}</Row>`).join('');
    return `<Worksheet ss:Name="${x(name).slice(0, 31)}"><Table>${head}${body}</Table></Worksheet>`;
  }).join('');
  return `<?xml version="1.0"?><?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
<Styles><Style ss:ID="h"><Font ss:Bold="1"/><Interior ss:Color="#E8EEF7" ss:Pattern="Solid"/></Style></Styles>${ws}</Workbook>`;
}
