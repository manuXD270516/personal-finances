import { DomainError, FixedClock, Instant } from '@pf/shared-kernel';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type {
  LifecycleDto,
  LifecycleExportSource,
  LifecycleItemDto,
  LifecycleTransitionDto,
} from '../contracts/index.js';
import { RedactionPolicy } from '../domain/redaction-policy.js';
import { AuditRecorder } from './audit-recorder.js';
import { LifecycleExporter, type LifecyclePdfRenderer } from './lifecycle-export.js';
import {
  LIFECYCLE_CSV_COLUMNS,
  buildLifecycleReport,
  csvCell,
  isoInTimeZone,
  lifecycleCsv,
  lifecycleFileName,
  reportLocale,
} from './lifecycle-report.js';
import { InMemoryAudit, fixedTimeZones, sequentialIds, sha256IpHasher } from './testing/in-memory.js';
import { LIFECYCLE_EXPORT_AUDIT_POLICY } from '../contracts/index.js';

const U1 = '0190a000-0000-7000-8000-000000000001';
const W1 = '0190a000-0000-7000-8000-0000000000a1';
const T1 = '0190a000-0000-7000-8000-0000000000f1';
const LA_PAZ = 'America/La_Paz';

const base = {
  actor: { type: 'USER' as const, id: U1, displayName: null },
  origin: 'ui' as const,
  aggregateVersion: 1,
  auditLogId: null,
  derived: false,
  events: [] as string[],
};

const step = (
  sequence: number,
  hour: number,
  transition: string,
  fromState: string | null,
  toState: string,
  extra: Partial<LifecycleTransitionDto> = {},
): LifecycleItemDto => ({
  ...base,
  sequence,
  kind: 'TRANSITION',
  transition,
  fromState,
  toState,
  machineVersion: 1,
  occurredAt: `2026-03-10T${String(14 + hour).padStart(2, '0')}:00:00.000Z`,
  reason: null,
  revisionFrom: null,
  revisionTo: null,
  journalEntries: { reversed: null, reversal: null, posted: null },
  detailRefs: {},
  ...extra,
});

/** TC-AUDIT-LIFECYCLE-021: gasto de 80.00 BOB pending → POST → CLEAR → REVISE a 85.00 → VOID "duplicado" (1 h por paso). */
function expenseLifecycle(reason = 'duplicado'): LifecycleExportSource {
  const lifecycle: LifecycleDto = {
    aggregateType: 'Transaction',
    aggregateId: T1,
    currentState: 'VOIDED',
    path: ['PENDING', 'POSTED', 'CLEARED', 'POSTED', 'VOIDED'],
    historyComplete: true,
    machine: { aggregateType: 'Transaction', machineVersion: 1, states: [], transitions: [] },
    items: [
      step(1, 0, 'RECORD', null, 'PENDING', {
        revisionTo: 1,
        events: ['transactions.TransactionCreated.v1'],
      }),
      step(2, 1, 'POST', 'PENDING', 'POSTED', {
        revisionTo: 1,
        journalEntries: { reversed: null, reversal: null, posted: 'je-1' },
        events: ['transactions.TransactionPosted.v1'],
      }),
      step(3, 2, 'CLEAR', 'POSTED', 'CLEARED'),
      step(4, 3, 'REVISE', 'CLEARED', 'POSTED', {
        revisionFrom: 1,
        revisionTo: 2,
        journalEntries: { reversed: 'je-1', reversal: 'je-2', posted: 'je-3' },
        events: ['transactions.TransactionPosted.v1', 'transactions.TransactionUpdated.v1'],
      }),
      step(5, 4, 'VOID', 'POSTED', 'VOIDED', { reason }),
      {
        ...base,
        sequence: 6,
        kind: 'ANNOTATION',
        occurredAt: '2026-03-10T19:00:00.000Z',
        changedFields: ['description', 'notes'],
        revisionFrom: null,
        revisionTo: null,
        derived: true,
      },
    ],
  };
  return {
    lifecycle,
    label: 'Hipermaxi',
    revisions: [
      { revision: 1, amount: { amount: '80.00', currency: 'BOB' }, fee: null },
      { revision: 2, amount: { amount: '85.00', currency: 'BOB' }, fee: { amount: '1.50', currency: 'BOB' } },
    ],
  };
}

/** Parser RFC 4180 mínimo (para leer el CSV como lo haría una planilla). */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i] as string;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\r' && text[i + 1] === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      i += 1;
    } else cell += ch;
  }
  return rows;
}

describe('Exportación del recorrido en CSV (docs/31 D52, tarea 9.5)', () => {
  it('[TC-AUDIT-LIFECYCLE-021] BOM, CRLF, encabezado estable y una fila por ítem con hora de La Paz (-04:00) y montos exactos', () => {
    const csv = lifecycleCsv(expenseLifecycle(), LA_PAZ);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv.endsWith('\r\n')).toBe(true);
    expect(csv.slice(1).split('\r\n')[0]).toBe(LIFECYCLE_CSV_COLUMNS.join(','));
    const [header, ...rows] = parseCsv(csv.slice(1));
    const col = (name: (typeof LIFECYCLE_CSV_COLUMNS)[number]) => header!.indexOf(name);
    expect(rows.map((r) => r[col('transition')])).toEqual(['RECORD', 'POST', 'CLEAR', 'REVISE', 'VOID', '']);
    expect(rows.map((r) => r[col('occurredAt')])).toEqual([
      '2026-03-10T10:00:00-04:00',
      '2026-03-10T11:00:00-04:00',
      '2026-03-10T12:00:00-04:00',
      '2026-03-10T13:00:00-04:00',
      '2026-03-10T14:00:00-04:00',
      '2026-03-10T15:00:00-04:00',
    ]);
    const revise = rows[3]!;
    expect([revise[col('revisionFrom')], revise[col('revisionTo')]]).toEqual(['1', '2']);
    expect([revise[col('amount')], revise[col('fee')], revise[col('currency')]]).toEqual([
      '85.00',
      '1.50',
      'BOB',
    ]);
    expect([
      revise[col('reversedJournalEntryId')],
      revise[col('reversalJournalEntryId')],
      revise[col('postedJournalEntryId')],
    ]).toEqual(['je-1', 'je-2', 'je-3']);
    expect(revise[col('events')]).toBe(
      'transactions.TransactionPosted.v1|transactions.TransactionUpdated.v1',
    );
    expect(rows[0]![col('amount')]).toBe('80.00');
    expect(rows[4]![col('reason')]).toBe('duplicado');
    const annotation = rows[5]!;
    expect([annotation[col('kind')], annotation[col('changedFields')], annotation[col('derived')]]).toEqual([
      'ANNOTATION',
      'description|notes',
      'true',
    ]);
    expect(rows.every((r) => r.length === LIFECYCLE_CSV_COLUMNS.length)).toBe(true);
  });

  it('[TC-AUDIT-LIFECYCLE-022] un motivo "=SUM(A1:A9)" sale neutralizado con \'; también + - @; los decimales no cambian', () => {
    const [, ...rows] = parseCsv(lifecycleCsv(expenseLifecycle('=SUM(A1:A9)'), LA_PAZ).slice(1));
    expect(rows[4]![LIFECYCLE_CSV_COLUMNS.indexOf('reason')]).toBe("'=SUM(A1:A9)");
    expect(csvCell('+1 555')).toBe("'+1 555");
    expect(csvCell('-cmd|calc')).toBe("'-cmd|calc");
    expect(csvCell('@SUM(1)')).toBe("'@SUM(1)");
    expect(csvCell('\tx')).toBe("'\tx");
    expect(csvCell('-12.50')).toBe('-12.50');
    expect(csvCell('a,"b"\nc')).toBe('"a,""b""\nc"');
    expect(csvCell('Pago, "Entel"')).toBe('"Pago, ""Entel"""');
  });

  it('[TC-AUDIT-LIFECYCLE-022] PBT: toda celda se lee igual (salvo el prefijo de neutralización) y ninguna empieza con = + - @', () => {
    fc.assert(
      fc.property(fc.array(fc.string(), { minLength: 1, maxLength: 6 }), (cells) => {
        const line = `${cells.map(csvCell).join(',')}\r\n`;
        const [parsed] = parseCsv(line);
        expect(parsed).toHaveLength(cells.length);
        parsed!.forEach((value, i) => {
          const original = cells[i] as string;
          if (/^-?\d+(\.\d+)?$/u.test(original) || !/^[=+\-@\t\r]/u.test(original)) {
            expect(value).toBe(original);
          } else {
            expect(value).toBe(`'${original}`);
          }
          expect(/^-?\d+(\.\d+)?$/u.test(value) || !/^[=+\-@\t\r]/u.test(value)).toBe(true);
        });
      }),
    );
  });

  it('[TC-AUDIT-LIFECYCLE-021] desfase de la zona: UTC ⇒ +00:00; nombre de archivo ASCII seguro', () => {
    expect(isoInTimeZone('2026-03-10T14:00:00Z', 'UTC')).toBe('2026-03-10T14:00:00+00:00');
    expect(isoInTimeZone('2026-03-10T03:30:00Z', LA_PAZ)).toBe('2026-03-09T23:30:00-04:00');
    expect(lifecycleFileName('Category', T1, 'csv')).toBe(`recorrido-Category-${T1}.csv`);
    expect(lifecycleFileName('Transaction', '../"x"\r\n', 'pdf')).toBe('recorrido-Transaction-.pdf');
  });
});

describe('Reporte del PDF (docs/31 D52, tarea 9.5)', () => {
  it('[TC-AUDIT-LIFECYCLE-023] es-BO: elemento, estado actual, estados visitados, generado con TZ y línea de tiempo', () => {
    const r = buildLifecycleReport(expenseLifecycle(), {
      timeZone: LA_PAZ,
      generatedAt: '2026-03-10T20:00:00Z',
      locale: 'es',
    });
    expect(r.title).toBe('Recorrido: Transacción "Hipermaxi"');
    expect(Object.fromEntries(r.headerLines.map((l) => [l.label, l.value]))).toMatchObject({
      'Estado actual': 'Anulada (VOIDED)',
      'Estados visitados':
        'Pendiente (PENDING) -> Contabilizada (POSTED) -> Confirmada (CLEARED) -> Contabilizada (POSTED) -> Anulada (VOIDED)',
      Generado: '10/03/2026 16:00 (America/La_Paz)',
    });
    expect(r.incomplete).toBeNull();
    expect(r.rows[0]).toEqual([
      '1',
      'Registrar',
      '(inicio) -> Pendiente',
      '10/03/2026 10:00',
      `Usuario ${U1} (ui)`,
      '',
      '1',
      '80.00 BOB',
      '',
    ]);
    expect(r.rows[3]?.[7]).toBe('85.00 BOB (comisión 1.50 BOB)');
    expect(r.rows[4]?.[5]).toBe('duplicado');
    expect(r.rows[5]?.slice(1, 3)).toEqual(['Cambio descriptivo', 'description, notes']);
    expect(r.rows[5]?.[8]).toBe('derivada');
  });

  it('[TC-AUDIT-LIFECYCLE-023] en/pt preparados por Accept-Language; historia incompleta avisada', () => {
    expect(reportLocale('en-US,en;q=0.9')).toBe('en');
    expect(reportLocale('pt-BR')).toBe('pt');
    expect(reportLocale('fr-FR, es;q=0.5')).toBe('es');
    expect(reportLocale(undefined)).toBe('es');
    const source = expenseLifecycle();
    const en = buildLifecycleReport(
      { ...source, lifecycle: { ...source.lifecycle, historyComplete: false } },
      { timeZone: LA_PAZ, generatedAt: '2026-03-10T20:00:00Z', locale: 'en' },
    );
    expect(en.title).toBe('Lifecycle: Transaction "Hipermaxi"');
    expect(en.incomplete).toMatch(/^Incomplete earlier history/);
    expect(en.rows[1]?.[1]).toBe('Post');
  });
});

describe('ExportLifecycle (docs/31 D52, tarea 9.5)', () => {
  const setup = (loaders: ConstructorParameters<typeof LifecycleExporter>[0]['loaders']) => {
    const mem = new InMemoryAudit();
    mem.ambientContext = { origin: 'ui' };
    const audit = new AuditRecorder({
      env: mem,
      store: mem,
      ipHasher: sha256IpHasher,
      ids: sequentialIds(),
      clock: new FixedClock(Instant.parse('2026-03-10T20:00:00Z')),
      policy: new RedactionPolicy(LIFECYCLE_EXPORT_AUDIT_POLICY),
    });
    const rendered: string[] = [];
    const pdf: LifecyclePdfRenderer = {
      render: async (report) => {
        rendered.push(report.title);
        return new TextEncoder().encode('%PDF-1.7 fake');
      },
    };
    const exporter = new LifecycleExporter({
      loaders,
      timeZones: fixedTimeZones(LA_PAZ),
      uow: mem,
      audit,
      clock: new FixedClock(Instant.parse('2026-03-10T20:00:00Z')),
      pdf,
    });
    return { mem, exporter, rendered };
  };

  it('[TC-AUDIT-LIFECYCLE-021] CSV y PDF con nombre seguro y tipo de contenido; cada exportación queda auditada sin el contenido', async () => {
    const { mem, exporter, rendered } = setup({ Transaction: async () => expenseLifecycle() });
    const csv = await exporter.export({
      userId: U1,
      workspaceId: W1,
      aggregateType: 'Transaction',
      aggregateId: T1,
      format: 'csv',
    });
    expect(csv.contentType).toBe('text/csv; charset=utf-8');
    expect(csv.fileName).toBe(`recorrido-Transaction-${T1}.csv`);
    expect(new TextDecoder().decode(csv.body)).toContain('2026-03-10T10:00:00-04:00');
    const pdf = await exporter.export({
      userId: U1,
      workspaceId: W1,
      aggregateType: 'Transaction',
      aggregateId: T1,
      format: 'pdf',
      locale: 'es',
    });
    expect(pdf.contentType).toBe('application/pdf');
    expect(pdf.fileName).toBe(`recorrido-Transaction-${T1}.pdf`);
    expect(rendered).toEqual(['Recorrido: Transacción "Hipermaxi"']);
    expect(
      mem.rows.map((r) => [
        r.action,
        r.aggregateType,
        r.aggregateId,
        r.changes.map((c) => [c.field, c.after]),
      ]),
    ).toEqual([
      [
        'audit.lifecycle.exported',
        'LifecycleExport',
        T1,
        [
          ['aggregateType', 'Transaction'],
          ['format', 'csv'],
        ],
      ],
      [
        'audit.lifecycle.exported',
        'LifecycleExport',
        T1,
        [
          ['aggregateType', 'Transaction'],
          ['format', 'pdf'],
        ],
      ],
    ]);
    // Exportar no escribe pasos en el recorrido.
    expect(mem.lifecycle).toEqual([]);
  });

  it('[TC-AUDIT-LIFECYCLE-024] un 404 del contexto dueño (otro workspace) se propaga sin auditar; tipo sin carga ⇒ 404', async () => {
    const { mem, exporter } = setup({
      Category: async () => {
        throw new DomainError('RESOURCE_NOT_FOUND', 'category not found');
      },
    });
    const args = { userId: U1, workspaceId: W1, aggregateId: T1, format: 'pdf' as const };
    await expect(exporter.export({ ...args, aggregateType: 'Category' })).rejects.toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
    });
    await expect(exporter.export({ ...args, aggregateType: 'Account' })).rejects.toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
    });
    expect(mem.rows).toEqual([]);
  });

  it('[TC-AUDIT-LIFECYCLE-021] si la auditoría falla no hay descarga', async () => {
    const { mem, exporter } = setup({ Transaction: async () => expenseLifecycle() });
    mem.failInserts = true;
    await expect(
      exporter.export({
        userId: U1,
        workspaceId: W1,
        aggregateType: 'Transaction',
        aggregateId: T1,
        format: 'csv',
      }),
    ).rejects.toThrow(/fault injected/);
  });
});
