// Browser glue for the vendored pdf.js (vendor/pdfjs, v4.10.38, Apache-2.0). No CDN: both files are served from this site.
// The worker is started when the page loads, so picking a file later causes no network request at all.
import * as pdfjs from '../vendor/pdfjs/pdf.min.mjs';
import { normalizeItems } from './extract.js';

let worker = null;
export function startWorker() {
  if (worker) return worker;
  const url = new URL('../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;
  pdfjs.GlobalWorkerOptions.workerSrc = url;
  try { worker = new pdfjs.PDFWorker({ port: new Worker(url, { type: 'module' }) }); } catch { worker = new pdfjs.PDFWorker(); }
  return worker;
}
// isEvalSupported:false + no font/cmap URLs: nothing is fetched while parsing or rendering.
const open = (bytes) => pdfjs.getDocument({ data: bytes.slice(0), worker: startWorker(), isEvalSupported: false, useSystemFonts: true, verbosity: 0 }).promise;

/** Read text items (with positions) from every page. Returns { items, pages, scanned } */
export async function readPdf(bytes) {
  const pdf = await open(bytes);
  const items = [], pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const vp = page.getViewport({ scale: 1 });
    pages.push({ w: vp.width, h: vp.height });
    const tc = await page.getTextContent();
    items.push(...normalizeItems(tc.items, i));
  }
  await pdf.destroy();
  return { items, pages, scanned: items.length < 5 };
}

/** Render one page into a canvas sized to cssWidth. Returns a function mapping a PDF box to CSS pixels. */
export async function renderPage(bytes, pageNo, canvas, cssWidth) {
  const pdf = await open(bytes);
  try {
    const page = await pdf.getPage(pageNo);
    const base = page.getViewport({ scale: 1 });
    const scale = cssWidth / base.width, dpr = Math.min(2, globalThis.devicePixelRatio || 1);
    const vp = page.getViewport({ scale });
    canvas.width = Math.floor(vp.width * dpr); canvas.height = Math.floor(vp.height * dpr);
    canvas.style.width = `${Math.floor(vp.width)}px`; canvas.style.height = `${Math.floor(vp.height)}px`;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null }).promise;
    return { width: vp.width, height: vp.height, numPages: pdf.numPages, toCss: (b) => { const [x0, y0, x1, y1] = vp.convertToViewportRectangle([b.x0, b.y0, b.x1, b.y1]); return { left: Math.min(x0, x1), top: Math.min(y0, y1), width: Math.abs(x1 - x0), height: Math.abs(y1 - y0) }; } };
  } finally { await pdf.destroy(); }
}
