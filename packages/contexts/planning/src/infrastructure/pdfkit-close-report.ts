import PDFDocument from 'pdfkit';
import type { CloseReportDocument, CloseReportPdfRenderer } from '../application/closing.queries.js';

/** Texto representable con las fuentes estándar del PDF (Helvetica / WinAnsi): lo demás se reemplaza por `?`. */
function pdfText(value: string): string {
  return [...value.replace(/→/gu, '->')]
    .map((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      return ch === '\n' || (code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff) ? ch : '?';
    })
    .join('');
}

const MARGIN = 40;

/**
 * PDF del reporte de cierre (openspec add-month-closing decisión 11) con pdfkit, igual que el recorrido de AUDIT:
 * KPIs, saldos por cuenta con su base de conciliación, variaciones y el aviso de que existe una versión anterior.
 */
export class PdfkitCloseReportPdf implements CloseReportPdfRenderer {
  render(report: CloseReportDocument): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({
        size: 'A4',
        margin: MARGIN,
        info: { Title: pdfText(`Reporte de cierre ${report.label}`), Author: 'PFOS', Producer: 'PFOS' },
        lang: 'es',
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

  private draw(doc: PDFKit.PDFDocument, r: CloseReportDocument): void {
    const c = r.content;
    const line = (text: string, bold = false) =>
      doc
        .font(bold ? 'Helvetica-Bold' : 'Helvetica')
        .fontSize(10)
        .text(pdfText(text));
    doc
      .font('Helvetica-Bold')
      .fontSize(16)
      .text(pdfText(`Reporte de cierre ${r.label}`));
    doc.moveDown(0.4);
    line(`Periodo: ${r.periodStart} a ${r.periodEnd}`);
    line(`Version del snapshot: ${r.closeNo}`);
    line(`Fecha de cierre: ${r.closedAt}`);
    if (r.hasPreviousVersion)
      line('Existe una version anterior de este cierre (el snapshot anterior se conserva intacto).');
    doc.moveDown();
    line('Indicadores', true);
    const k = c.flows.consolidated;
    line(`Ingresos: ${k.income.amount} ${k.income.currency}`);
    line(`Gastos: ${k.expense.amount} ${k.expense.currency}`);
    line(`Ahorro: ${k.savings.amount} ${k.savings.currency}`);
    line(`Tasa de ahorro: ${k.savingsRate ?? '-'}${k.savingsRate === null ? '' : ' %'}`);
    line(
      `Patrimonio neto: ${c.netWorth.amount.amount} ${c.netWorth.amount.currency}${c.netWorth.complete ? '' : ' (incompleto)'}`,
    );
    for (const u of c.netWorth.unconverted) line(`Sin convertir: ${u.amount} ${u.currency}`);
    doc.moveDown();
    line('Saldos por cuenta', true);
    for (const b of c.balances) {
      const basis =
        b.reconciliationBasis === 'STATEMENT'
          ? 'conciliada con extracto'
          : b.reconciliationBasis === 'WITHOUT_STATEMENT'
            ? 'conciliada sin extracto'
            : 'sin conciliar';
      line(`${b.accountName}: ${b.balance.amount} ${b.balance.currency} (${basis})`);
    }
    if (r.comparison) {
      doc.moveDown();
      line(`Variacion respecto a ${r.comparison.previousLabel}`, true);
      for (const d of r.comparison.deltas) {
        const abs =
          d.absolute === null
            ? '-'
            : typeof d.absolute === 'string'
              ? d.absolute
              : `${d.absolute.amount} ${d.absolute.currency}`;
        line(`${d.kpi}: ${abs}${d.percentage === null ? '' : ` (${d.percentage} %)`}`);
      }
    }
  }
}
