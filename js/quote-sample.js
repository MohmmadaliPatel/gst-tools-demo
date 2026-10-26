// Sample quote register for the quotation demo. Written as if today were SAMPLE_DAY (2026-10-26); sampleRegister()
// moves every date to the visitor's today so the follow-up queue (one overdue, one due today, one upcoming) is the
// same on any day. Quote numbers use the financial year of each quote's shifted date.
import { fyLabel } from './quote.js';
import { sampleOffset, shiftIso } from './sample-dates.js';

export const SAMPLE_REG = [
  { no: 'Q/2026-27/0041', client: 'Fictional Fabricators', date: '2026-10-14', amount: 182400, status: 'Sent', followUp: '2026-10-21' },
  { no: 'Q/2026-27/0042', client: 'Demo Builders LLP', date: '2026-10-17', amount: 64250, status: 'Won', followUp: '' },
  { no: 'Q/2026-27/0043', client: 'Example Interiors', date: '2026-10-20', amount: 23900, status: 'Sent', followUp: '2026-10-26' },
  { no: 'Q/2026-27/0044', client: 'Test Engineering Works', date: '2026-10-21', amount: 412000, status: 'Lost', followUp: '' },
  { no: 'Q/2026-27/0045', client: 'Placeholder Projects', date: '2026-10-23', amount: 97500, status: 'Sent', followUp: '2026-10-30' },
];

/** The sample register with dates relative to `today` (YYYY-MM-DD). Returns fresh objects each call. */
export function sampleRegister(today) {
  const days = sampleOffset(today);
  return SAMPLE_REG.map((r) => {
    const date = shiftIso(r.date, days);
    return { ...r, no: r.no.replace(/\/\d{4}-\d{2}\//, `/${fyLabel(date)}/`), date, followUp: r.followUp ? shiftIso(r.followUp, days) : '' };
  });
}
