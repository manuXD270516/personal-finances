import PDFDocument from 'pdfkit';
import type { LifecyclePdfRenderer } from '../application/lifecycle-export.js';
import type { LifecycleReport } from '../application/lifecycle-report.js';

/**
 * Caracteres fuera de Latin-1 que sí tiene WinAnsiEncoding (la codificación de las fuentes estándar del PDF, que no
 * se incrustan): el resto se reemplaza por `?` para no emitir glifos inexistentes.
 */
const WIN_ANSI_EXTRA = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ');

/** Texto representable con Helvetica estándar (flechas como `->`). */
export function pdfText(value: string): string {
  return [...value.replace(/→/gu, '->')]
    .map((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      if (ch === '\n' || (code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff)) return ch;
      return WIN_ANSI_EXTRA.has(ch) ? ch : '?';
    })
    .join('');
}

/** Anchos de las 9 columnas de `LifecycleReport.columns` (A4 apaisado: 770 pt útiles). */
const WIDTHS = [26, 84, 150, 74, 150, 110, 46, 92, 38] as const;
const MARGIN = 36;
const PADDING = 3;
const FONT_SIZE = 8;

/**
 * PDF del recorrido con pdfkit 0.20 (MIT; fuentes estándar, sin navegador, red ni archivos externos): título,
 * elemento, estado actual, estados visitados, máquina, instante de generación con la zona horaria del workspace,
 * aviso de historia incompleta y la línea de tiempo como tabla (encabezado repetido en cada página), con
 * "Página n de m". El diagrama es opcional (spec) y no se incluye.
 */
export class PdfkitLifecyclePdf implements LifecyclePdfRenderer {
  render(report: LifecycleReport): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({
        size: 'A4',
        layout: 'landscape',
        margin: MARGIN,
        bufferPages: true,
        info: {
          Title: pdfText(report.documentTitle),
          Author: 'PFOS',
          Producer: 'PFOS',
          Creator: 'PFOS finance-api',
        },
        lang: report.locale,
      });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(new Uint8Array(Buffer.concat(chunks))));
      doc.on('error', reject);
      try {
        this.draw(doc, report);
        doc.end();
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  private draw(doc: PDFKit.PDFDocument, report: LifecycleReport): void {
    const width = doc.page.width - MARGIN * 2;
    doc.font('Helvetica-Bold').fontSize(15).text(pdfText(report.title), { width });
    doc.moveDown(0.4);
    doc.fontSize(9.5);
    for (const { label, value } of report.headerLines) {
      doc
        .font('Helvetica-Bold')
        .text(pdfText(`${label}: `), { continued: true })
        .font('Helvetica')
        .text(pdfText(value), { width });
    }
    if (report.incomplete) {
      doc.moveDown(0.3);
      doc.font('Helvetica-Oblique').text(pdfText(report.incomplete), { width });
    }
    doc.moveDown(0.8);
    this.table(doc, report);
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i += 1) {
      doc.switchToPage(i);
      // Pie fuera del margen inferior: sin cambiar `margins` pdfkit agregaría una página al escribir ahí.
      const bottomMargin = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      doc
        .font('Helvetica')
        .fontSize(8)
        .text(pdfText(report.page(i - range.start + 1, range.count)), MARGIN, doc.page.height - MARGIN + 10, {
          width,
          align: 'right',
          lineBreak: false,
        });
      doc.page.margins.bottom = bottomMargin;
    }
  }

  private table(doc: PDFKit.PDFDocument, report: LifecycleReport): void {
    const totalWidth = WIDTHS.reduce((s, w) => s + w, 0);
    const bottom = () => doc.page.height - MARGIN;
    const header = report.columns.map(pdfText);
    const heightOf = (cells: readonly string[], bold: boolean) => {
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(FONT_SIZE);
      return (
        Math.max(...cells.map((c, i) => doc.heightOfString(c, { width: (WIDTHS[i] ?? 40) - PADDING * 2 }))) +
        PADDING * 2
      );
    };
    const drawRow = (cells: readonly string[], bold: boolean): void => {
      const h = heightOf(cells, bold);
      if (doc.y + h > bottom()) {
        doc.addPage();
        if (!bold) drawRow(header, true);
      }
      const y = doc.y;
      if (bold) doc.save().rect(MARGIN, y, totalWidth, h).fill('#eeeeee').restore();
      doc
        .fillColor('#000000')
        .font(bold ? 'Helvetica-Bold' : 'Helvetica')
        .fontSize(FONT_SIZE);
      let x = MARGIN;
      cells.forEach((c, i) => {
        const w = WIDTHS[i] ?? 40;
        doc.text(c, x + PADDING, y + PADDING, { width: w - PADDING * 2 });
        x += w;
      });
      doc
        .save()
        .moveTo(MARGIN, y + h)
        .lineTo(MARGIN + totalWidth, y + h)
        .lineWidth(0.5)
        .strokeColor('#999999')
        .stroke()
        .restore();
      doc.x = MARGIN;
      doc.y = y + h;
    };
    drawRow(header, true);
    if (report.rows.length === 0) {
      doc
        .font('Helvetica')
        .fontSize(FONT_SIZE)
        .text(pdfText(report.empty), MARGIN + PADDING, doc.y + PADDING);
      return;
    }
    for (const row of report.rows) drawRow(row.map(pdfText), false);
  }
}
