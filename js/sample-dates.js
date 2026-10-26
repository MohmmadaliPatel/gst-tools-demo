// The bundled sample files are written as if "today" were SAMPLE_DAY. When a demo loads them, every date is
// moved by the same number of days so that, for the visitor, the sample's "today" is their own today and the
// story (expired / due this week / low stock / dispatched today) looks the same on any day.
export const SAMPLE_DAY = '2026-10-26';

const pad = (n) => String(n).padStart(2, '0');
const dayNo = (y, m, d) => Math.floor(Date.UTC(y, m - 1, d) / 864e5);
const fromDayNo = (n) => { const t = new Date(n * 864e5); return [t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()]; };

/** The visitor's local calendar date as YYYY-MM-DD. Pass `now` to make it deterministic in tests. */
export function localToday(now = new Date()) {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Whole days from SAMPLE_DAY to `today` (YYYY-MM-DD); negative if today is earlier. */
export function sampleOffset(today) {
  const [y, m, d] = today.split('-').map(Number);
  const [sy, sm, sd] = SAMPLE_DAY.split('-').map(Number);
  return dayNo(y, m, d) - dayNo(sy, sm, sd);
}

/** Shift one YYYY-MM-DD date by `days`. */
export function shiftIso(iso, days) {
  const [y, m, d] = iso.split('-').map(Number);
  const [a, b, c] = fromDayNo(dayNo(y, m, d) + days);
  return `${a}-${pad(b)}-${pad(c)}`;
}

/**
 * Shift every date in a sample CSV by `days`, keeping each date's own format: YYYY-MM-DD, DD-MM-YYYY and DD/MM/YYYY
 * (the members sample mixes formats on purpose to show the flexible parser). Other text is left untouched.
 */
export function shiftSampleText(text, days) {
  if (!days) return text;
  return text
    .replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (_, y, m, d) => shiftIso(`${y}-${m}-${d}`, days))
    .replace(/\b(\d{2})([-/])(\d{2})\2(\d{4})\b/g, (_, d, sep, m, y) => {
      const [a, b, c] = shiftIso(`${y}-${m}-${d}`, days).split('-');
      return `${c}${sep}${b}${sep}${a}`;
    });
}
