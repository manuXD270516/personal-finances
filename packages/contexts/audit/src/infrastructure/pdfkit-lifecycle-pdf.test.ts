import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import type { LifecycleDto, LifecycleItemDto } from '../contracts/index.js';
import { buildLifecycleReport } from '../application/lifecycle-report.js';
import { PdfkitLifecyclePdf, pdfText } from './pdfkit-lifecycle-pdf.js';

const ACCOUNT = '0190a000-0000-7000-8000-0000000000c3';
const U1 = '0190a000-0000-7000-8000-000000000001';

const item = (sequence: number, transition: string, from: string | null, to: string, reason: string | null) =>
  ({
    sequence,
    kind: 'TRANSITION',
    transition,
    fromState: from,
    toState: to,
    machineVersion: 1,
    occurredAt: new Date(Date.UTC(2026, 2, 10 + sequence, 14)).toISOString(),
    actor: { type: 'USER', id: U1, displayName: null },
    origin: 'ui',
    reason,
    revisionFrom: null,
    revisionTo: null,
    aggregateVersion: sequence,
    journalEntries: { reversed: null, reversal: null, posted: sequence === 1 ? 'je-open' : null },
    detailRefs: {},
    events: [],
    auditLogId: null,
    derived: false,
  }) satisfies LifecycleItemDto;

/** TC-AUDIT-LIFECYCLE-023: "Bank C" abierta, archivada ("sin uso"), reactivada y cerrada. */
const bankC = (items: LifecycleItemDto[]): LifecycleDto => ({
  aggregateType: 'Account',
  aggregateId: ACCOUNT,
  currentState: 'CLOSED',
  path: ['ACTIVE', 'ARCHIVED', 'ACTIVE', 'CLOSED'],
  historyComplete: true,
  machine: { aggregateType: 'Account', machineVersion: 1, states: [], transitions: [] },
  items,
});

/** Texto visible del PDF: descomprime los content streams y junta los literales `(…) Tj` / `[…] TJ`. */
export function pdfVisibleText(pdf: Uint8Array): string {
  const raw = Buffer.from(pdf).toString('latin1');
  const out: string[] = [];
  const re = /stream\r?\n([\s\S]*?)\r?\nendstream/gu;
  for (let m = re.exec(raw); m; m = re.exec(raw)) {
    let content: string;
    try {
      content = inflateSync(Buffer.from(m[1] as string, 'latin1')).toString('latin1');
    } catch {
      continue;
    }
    for (const t of content.matchAll(/\[(.*?)\]\s*TJ|<([0-9a-fA-F]+)>\s*Tj|\((.*?)\)\s*Tj/gu)) {
      if (t[1] !== undefined) {
        out.push(
          [...t[1].matchAll(/<([0-9a-fA-F]+)>|\((.*?)\)/gu)]
            .map((p) => (p[1] ? Buffer.from(p[1], 'hex').toString('latin1') : (p[2] ?? '')))
            .join(''),
        );
      } else if (t[2]) out.push(Buffer.from(t[2], 'hex').toString('latin1'));
      else out.push(t[3] ?? '');
    }
  }
  return out.join(' ');
}

const pageCount = (pdf: Uint8Array) =>
  (
    Buffer.from(pdf)
      .toString('latin1')
      .match(/\/Type \/Page\b/gu) ?? []
  ).length;

describe('PDF del recorrido con pdfkit (docs/31 D52, tarea 9.5)', () => {
  it('[TC-AUDIT-LIFECYCLE-023] cabecera %PDF, ≥ 1 página y texto con cuenta, estado actual, camino y línea de tiempo', async () => {
    const report = buildLifecycleReport(
      {
        label: 'Bank C',
        lifecycle: bankC([
          item(1, 'OPEN', null, 'ACTIVE', null),
          item(2, 'ARCHIVE', 'ACTIVE', 'ARCHIVED', 'sin uso'),
          item(3, 'REACTIVATE', 'ARCHIVED', 'ACTIVE', null),
          item(4, 'CLOSE', 'ACTIVE', 'CLOSED', null),
        ]),
      },
      { timeZone: 'America/La_Paz', generatedAt: '2026-03-31T20:00:00Z', locale: 'es' },
    );
    const pdf = await new PdfkitLifecyclePdf().render(report);
    expect(Buffer.from(pdf.subarray(0, 5)).toString('latin1')).toBe('%PDF-');
    expect(Buffer.from(pdf.subarray(-8)).toString('latin1')).toContain('%%EOF');
    expect(pageCount(pdf)).toBeGreaterThan(0);
    const text = pdfVisibleText(pdf);
    for (const expected of [
      'Bank C',
      'Cerrada (CLOSED)',
      'Activa (ACTIVE) -> Archivada (ARCHIVED) -> Activa (ACTIVE) -> Cerrada (CLOSED)',
      'Abrir',
      'Archivar',
      'sin uso',
      'Reactivar',
      'Cerrar',
      '11/03/2026 10:00',
      'America/La_Paz',
      'Página 1 de 1',
    ]) {
      expect(text, expected).toContain(expected);
    }
  });

  it('[TC-AUDIT-LIFECYCLE-023] un recorrido largo pagina con "Página n de m" y repite el encabezado', async () => {
    const items = Array.from({ length: 120 }, (_, i) =>
      item(i + 1, i % 2 === 0 ? 'ARCHIVE' : 'REACTIVATE', 'ACTIVE', 'ARCHIVED', `motivo ${i + 1}`),
    );
    const pdf = await new PdfkitLifecyclePdf().render(
      buildLifecycleReport(
        { lifecycle: bankC(items) },
        { timeZone: 'America/La_Paz', generatedAt: '2026-03-31T20:00:00Z', locale: 'es' },
      ),
    );
    const pages = pageCount(pdf);
    expect(pages).toBeGreaterThan(1);
    const text = pdfVisibleText(pdf);
    expect(text).toContain(`Página ${pages} de ${pages}`);
    expect(text.split('Fecha y hora').length - 1).toBe(pages);
    expect(text).toContain('motivo 120');
  });

  it('[TC-AUDIT-LIFECYCLE-023] texto fuera de WinAnsi se sustituye (sin glifos inexistentes)', () => {
    expect(pdfText('Ñandú → ∅ 😀 €')).toBe('Ñandú -> ? ? €');
  });
});
