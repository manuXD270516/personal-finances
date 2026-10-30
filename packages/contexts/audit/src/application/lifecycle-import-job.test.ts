import { describe, expect, it } from 'vitest';
import type { LifecycleDto, LifecycleExportSource, LifecycleItemDto } from '../contracts/index.js';
import { LIFECYCLE_AGGREGATE_TYPES } from '../contracts/index.js';
import { buildLifecycleReport, type LifecycleReportLocale } from './lifecycle-report.js';

const ANA = '0190a000-0000-7000-8000-0000000000a9';
const SYSTEM = 'imports.persist';
const J1 = '0190a000-0000-7000-8000-0000000000c1';

const base = {
  origin: 'ui' as const,
  aggregateVersion: 1,
  auditLogId: null,
  derived: false,
  events: [] as string[],
  machineVersion: 1,
  reason: null,
  revisionFrom: null,
  revisionTo: null,
  journalEntries: { reversed: null, reversal: null, posted: null },
  detailRefs: {},
};

const step = (
  sequence: number,
  transition: string,
  from: string | null,
  to: string,
  actor: 'USER' | 'SYSTEM',
): LifecycleItemDto => ({
  ...base,
  sequence,
  kind: 'TRANSITION',
  transition,
  fromState: from,
  toState: to,
  occurredAt: `2026-10-20T1${sequence}:00:00.000Z`,
  actor: { type: actor, id: actor === 'USER' ? ANA : SYSTEM, displayName: actor === 'USER' ? 'Ana' : null },
});

/** TC-IMPORTS-PIPELINE-070: importación deshecha con perfil aplicado (anotación). */
function revertedImport(): LifecycleExportSource {
  const lifecycle: LifecycleDto = {
    aggregateType: 'ImportJob',
    aggregateId: J1,
    currentState: 'ROLLED_BACK',
    path: [
      'UPLOADED',
      'PROCESSING',
      'AWAITING_REVIEW',
      'APPROVED',
      'PERSISTING',
      'COMPLETED',
      'REVERTING',
      'ROLLED_BACK',
    ],
    historyComplete: true,
    machine: { aggregateType: 'ImportJob', machineVersion: 1, states: [], transitions: [] },
    items: [
      step(1, 'CREATE_FROM_DOCUMENT', null, 'UPLOADED', 'USER'),
      step(2, 'START', 'UPLOADED', 'PROCESSING', 'SYSTEM'),
      {
        ...base,
        sequence: 3,
        kind: 'ANNOTATION',
        occurredAt: '2026-10-20T13:00:00.000Z',
        actor: { type: 'SYSTEM', id: SYSTEM, displayName: null },
        changedFields: ['mappingProfile'],
      },
      step(4, 'READY_FOR_REVIEW', 'PROCESSING', 'AWAITING_REVIEW', 'SYSTEM'),
      step(5, 'APPROVE', 'AWAITING_REVIEW', 'APPROVED', 'USER'),
      step(6, 'BEGIN_PERSISTING', 'APPROVED', 'PERSISTING', 'SYSTEM'),
      step(7, 'COMPLETE', 'PERSISTING', 'COMPLETED', 'SYSTEM'),
      step(8, 'REVERT', 'COMPLETED', 'REVERTING', 'USER'),
      step(9, 'FINISH_REVERT', 'REVERTING', 'ROLLED_BACK', 'SYSTEM'),
    ],
  };
  return { lifecycle, label: null, revisions: [] };
}

const EXPECTED: Record<LifecycleReportLocale, { states: string[]; transitions: string[] }> = {
  es: {
    states: [
      'Subida',
      'Procesando',
      'En revisión',
      'Aprobada',
      'Persistiendo',
      'Completada',
      'Deshaciendo',
      'Deshecha',
    ],
    transitions: ['Crear desde documento', 'Aprobar', 'Deshacer', 'Terminar de deshacer'],
  },
  en: {
    states: [
      'Uploaded',
      'Processing',
      'In review',
      'Approved',
      'Persisting',
      'Completed',
      'Reverting',
      'Rolled back',
    ],
    transitions: ['Create from document', 'Approve', 'Revert', 'Finish revert'],
  },
  pt: {
    states: [
      'Enviada',
      'Processando',
      'Em revisão',
      'Aprovada',
      'Persistindo',
      'Concluída',
      'Desfazendo',
      'Desfeita',
    ],
    transitions: ['Criar a partir de documento', 'Aprovar', 'Desfazer', 'Terminar de desfazer'],
  },
};

describe('Recorrido de una importación (add-import-pipeline)', () => {
  it('ImportJob es un agregado con recorrido', () => {
    expect(LIFECYCLE_AGGREGATE_TYPES).toContain('ImportJob');
  });

  it.each(['es', 'en', 'pt'] as const)(
    '[TC-IMPORTS-PIPELINE-070] el recorrido de una importación deshecha se etiqueta en %s, en orden y con actor',
    (locale) => {
      const report = buildLifecycleReport(revertedImport(), {
        timeZone: 'America/La_Paz',
        generatedAt: '2026-10-21T10:00:00.000Z',
        locale,
      });
      const text = JSON.stringify([report.headerLines, report.rows]);
      for (const label of [...EXPECTED[locale].states, ...EXPECTED[locale].transitions]) {
        expect(text).toContain(label);
      }
      // Ningún código crudo de la máquina se filtra a la etiqueta.
      expect(text).not.toMatch(/CREATE_FROM_DOCUMENT|FINISH_REVERT|ROLLED_BACK -> |-> UPLOADED/u);
      // El orden es el del recorrido y cada paso lleva a Ana o al sistema como actor.
      expect(report.rows).toHaveLength(9);
      expect(report.rows[0]?.[4]).toContain('Ana');
      expect(report.rows[1]?.[4]).toContain(SYSTEM);
      expect(report.rows[2]?.[2]).toBe('mappingProfile');
    },
  );
});
