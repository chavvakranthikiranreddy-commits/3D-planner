import { jsPDF } from 'jspdf';
import type { Project } from './types';
import { buildEstimate, sceneStats } from './estimate';
import { fmtArea, fmtLen, polygonArea } from './geometry';

const pdfCurrency = (c: string) => ({ '₹': 'INR ', '$': '$', '€': 'EUR ', '£': 'GBP ' } as Record<string, string>)[c] ?? `${c} `;
/** jsPDF's built-in fonts are Latin-1 only; map the few symbols we use. */
const safe = (t: string) => t.replace(/²/g, '2').replace(/′/g, "'").replace(/″/g, '"').replace(/×/g, 'x').replace(/[—–]/g, '-').replace(/₹/g, 'INR ').replace(/…/g, '...');
const money = (n: number, c: string) => pdfCurrency(c) + Math.round(n).toLocaleString('en-IN');

/** PDF room report: render, dimensions, finishes, products and indicative quantities. */
export function buildReport(p: Project, renderDataUrl: string | null): jsPDF {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = 210, M = 14;
  let y = M;
  const s = p.scene;
  const ensure = (h: number) => { if (y + h > 285) { doc.addPage(); y = M; } };
  const h1 = (t: string) => { ensure(12); doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.setTextColor(28, 25, 23); doc.text(safe(t), M, y); y += 7; };
  const row = (cols: string[], widths: number[], bold = false) => {
    ensure(6);
    doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(8.5); doc.setTextColor(bold ? 60 : 40, 40, 40);
    let x = M;
    cols.forEach((c, i) => {
      const lines = doc.splitTextToSize(safe(c), widths[i] - 2) as string[];
      doc.text(lines[0] + (lines.length > 1 ? '...' : ''), x, y);
      x += widths[i];
    });
    y += 5;
    if (bold) { doc.setDrawColor(200); doc.line(M, y - 3.5, W - M, y - 3.5); }
  };

  doc.setFillColor(28, 25, 23); doc.rect(0, 0, W, 30, 'F');
  doc.setTextColor(245, 158, 11); doc.setFont('helvetica', 'bold'); doc.setFontSize(18); doc.text('ARCHIFORM', M, 13);
  doc.setTextColor(250, 250, 249); doc.setFontSize(12); doc.text(safe(p.name), M, 21);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(200);
  doc.text(`Project report · ${new Date().toLocaleString()} · ${p.projectType} · units: ${p.units}`, M, 26);
  y = 38;

  if (renderDataUrl) {
    const iw = W - 2 * M, ih = iw * 0.5625;
    doc.addImage(renderDataUrl, 'JPEG', M, y, iw, ih);
    y += ih + 6;
  }

  const st = sceneStats(s);
  h1('Summary');
  row(['Floors', 'Floor area', 'Wall length', 'Doors', 'Windows', 'Items'], [25, 35, 35, 25, 25, 25], true);
  row([String(s.floors.length), fmtArea(st.floorArea, p.units), fmtLen(st.wallLength, p.units), String(st.doors), String(st.windows), String(st.objects)], [25, 35, 35, 25, 25, 25]);
  y += 3;

  h1('Rooms & finishes');
  row(['Room', 'Type', 'Area', 'Floor finish', 'Ceiling'], [50, 28, 28, 46, 30], true);
  for (const r of s.rooms) {
    row([r.name + (r.source === 'detected' ? ' *' : ''), r.roomType, fmtArea(polygonArea(r.polygon), p.units), s.materials[r.floorMaterialId]?.name ?? '-', s.materials[r.ceilingMaterialId]?.name ?? '-'], [50, 28, 28, 46, 30]);
  }
  y += 3;

  const est = buildEstimate(p);
  h1('Indicative quantities & costs');
  const cw = [78, 18, 12, 26, 28, 20];
  row(['Item', 'Qty', 'Unit', 'Unit price', 'Total', 'Basis'], cw, true);
  for (const l of est) row([l.item, String(l.quantity), l.unit, money(l.unitPrice, p.currency), money(l.total, p.currency), l.confidence], cw);
  const total = est.reduce((a, l) => a + l.total, 0);
  row(['TOTAL (indicative)', '', '', '', money(total, p.currency), ''], cw, true);
  y += 4;

  ensure(30);
  doc.setFont('helvetica', 'italic'); doc.setFontSize(7.5); doc.setTextColor(110);
  const disclaimer = [
    'All quantities and prices are indicative only and are not a quotation. Prices come from the built-in catalog or user input; paint assumes 2 coats at 10 m²/L, flooring includes 10% wastage.',
    'Items marked "approximation" were generated from a reference photo and their geometry is estimated. Rooms marked * were detected automatically from a blueprint.',
    'This report is a visualisation aid. Have dimensions verified by a qualified architect or engineer before construction or purchasing.',
  ];
  for (const d of disclaimer) { const ls = doc.splitTextToSize(safe(d), W - 2 * M) as string[]; ensure(ls.length * 3.5); doc.text(ls, M, y); y += ls.length * 3.5 + 1; }
  return doc;
}
