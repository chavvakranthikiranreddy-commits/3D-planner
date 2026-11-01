import { jsPDF } from 'jspdf';
import type { Project } from './types';
import { buildEstimate, sceneStats } from './estimate';
import { fmtArea, fmtLen, polygonArea } from './geometry';

const pdfCurrency = (c: string) => ({ '₹': 'INR ', '$': '$', '€': 'EUR ', '£': 'GBP ' } as Record<string, string>)[c] ?? `${c} `;
/** jsPDF's built-in fonts are Latin-1 only; map the symbols we use and replace anything else visibly. */
export const safe = (t: string) => t.replace(/²/g, '2').replace(/′/g, "'").replace(/″/g, '"').replace(/×/g, 'x').replace(/[—–]/g, '-').replace(/₹/g, 'INR ').replace(/…/g, '...').replace(/[^\x20-\x7E\xA0-\xFF\n]/g, '?');
/** True when text contains characters the PDF fonts cannot show (e.g. Telugu, Hindi). */
export const hasUnsupportedText = (t: string) => /[^\x00-\xFF²′″×—–₹…]/.test(t);
const money = (n: number, c: string) => pdfCurrency(c) + Math.round(n).toLocaleString('en-IN');

/** PDF room report: render, dimensions, finishes, products and indicative quantities. */
export function buildReport(p: Project, renderDataUrl: string | null): jsPDF {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = 210, M = 14, LINE = 3.8, BOTTOM = 283;
  let y = M;
  const s = p.scene;
  const floorName = (id: string) => s.floors.find((f) => f.id === id)?.name ?? '';
  let header: { cols: string[]; widths: number[] } | null = null;

  const newPage = () => { doc.addPage(); y = M; if (header) drawRow(header.cols, header.widths, true); };
  const ensure = (h: number) => { if (y + h > BOTTOM) newPage(); };
  const h1 = (t: string) => { header = null; ensure(14); doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.setTextColor(28, 25, 23); doc.text(safe(t), M, y); y += 7; };
  function drawRow(cols: string[], widths: number[], bold: boolean) {
    const style = () => { doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(8.5); doc.setTextColor(bold ? 60 : 40, 40, 40); };
    style();
    const wrapped = cols.map((c, i) => doc.splitTextToSize(safe(c), widths[i] - 2) as string[]);
    const lines = Math.max(...wrapped.map((w) => w.length));
    if (y + lines * LINE + 1.5 > BOTTOM) { doc.addPage(); y = M; if (header && !bold) drawRow(header.cols, header.widths, true); style(); }
    let x = M;
    wrapped.forEach((w, i) => { doc.text(w, x, y); x += widths[i]; });
    y += lines * LINE + 1.2;
    if (bold) { doc.setDrawColor(200); doc.line(M, y - LINE + 0.6, W - M, y - LINE + 0.6); }
  }
  const table = (cols: string[], widths: number[]) => { header = { cols, widths }; ensure(12); drawRow(cols, widths, true); };
  const row = (cols: string[], widths: number[]) => drawRow(cols, widths, false);

  doc.setFillColor(28, 25, 23); doc.rect(0, 0, W, 32, 'F');
  doc.setTextColor(245, 158, 11); doc.setFont('helvetica', 'bold'); doc.setFontSize(18); doc.text('ARCHIFORM', M, 13);
  doc.setTextColor(250, 250, 249); doc.setFontSize(12);
  const title = doc.splitTextToSize(safe(p.name), W - 2 * M) as string[];
  doc.text(title.slice(0, 2), M, 20);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(200);
  doc.text(`Project report · ${new Date().toLocaleString()} · ${p.projectType} · units: ${p.units} · ${s.floors.length} floor(s)`, M, title.length > 1 ? 29 : 26);
  y = 40;

  if (renderDataUrl) {
    const iw = W - 2 * M, ih = iw * 0.5625;
    doc.addImage(renderDataUrl, 'JPEG', M, y, iw, ih);
    y += ih + 6;
  }

  const st = sceneStats(s);
  h1('Summary');
  table(['Floors', 'Floor area', 'Wall length', 'Doors', 'Windows', 'Items'], [25, 35, 35, 25, 25, 25]);
  row([String(s.floors.length), fmtArea(st.floorArea, p.units), fmtLen(st.wallLength, p.units), String(st.doors), String(st.windows), String(st.objects)], [25, 35, 35, 25, 25, 25]);
  y += 3;

  h1('Rooms & finishes');
  const rw = [44, 26, 22, 24, 38, 28];
  table(['Room', 'Floor', 'Type', 'Area', 'Floor finish', 'Ceiling'], rw);
  for (const r of s.rooms) {
    row([r.name + (r.source === 'detected' ? ' *' : ''), floorName(r.floorId), r.roomType, fmtArea(polygonArea(r.polygon), p.units), s.materials[r.floorMaterialId]?.name ?? '-', s.materials[r.ceilingMaterialId]?.name ?? '-'], rw);
  }
  y += 3;

  const est = buildEstimate(p);
  h1('Indicative quantities & costs');
  const cw = [78, 16, 12, 26, 28, 22];
  table(['Item', 'Qty', 'Unit', 'Unit price', 'Total', 'Basis'], cw);
  for (const l of est) row([l.item, String(l.quantity), l.unit, money(l.unitPrice, p.currency), money(l.total, p.currency), l.confidence], cw);
  const total = est.reduce((a, l) => a + l.total, 0);
  header = null;
  drawRow(['TOTAL (indicative)', '', '', '', money(total, p.currency), ''], cw, true);
  y += 4;

  ensure(30);
  doc.setFont('helvetica', 'italic'); doc.setFontSize(7.5); doc.setTextColor(110);
  const disclaimer = [
    'All quantities and prices are indicative only and are not a quotation. Catalog prices are placeholder values; the currency symbol is a label and no conversion is applied. Paint assumes 2 coats at 10 m2/L; flooring includes 10% wastage.',
    'Measured = drawn or confirmed by the user at the calibrated scale. Estimated = derived (wall areas) or from a reference photo ("approximation"). Rooms marked * were detected automatically from a blueprint and should be checked.',
    'This report is a visualisation aid. Have dimensions verified by a qualified architect or engineer before construction or purchasing.',
  ];
  for (const d of disclaimer) { const ls = doc.splitTextToSize(safe(d), W - 2 * M) as string[]; ensure(ls.length * 3.5); doc.text(ls, M, y); y += ls.length * 3.5 + 1; }
  return doc;
}
