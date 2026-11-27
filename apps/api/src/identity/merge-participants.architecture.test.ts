import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Test de arquitectura de la fusión (openspec add-category-and-counterparty-merge, tarea 4.4 y design § Riesgos): todo
// contexto con una referencia a categoría o contraparte (lista cerrada de la tabla del Contexto del design) implementa
// `ClassificationMergeParticipant` y se compone, en orden fijo, en la lista que recibe CLASSIFICATION. Los participantes
// dependen de `@pf/classification/contracts`, nunca al revés (eso lo verifica `pnpm arch:check`).
const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

/** Contexto → archivo de su participante (la tabla del design; FORECAST solo lee la historia por `CategoryMergeQuery`). */
const PARTICIPANTS: Record<string, string> = {
  transactions: '../../../../packages/contexts/transactions/src/infrastructure/pg-classification-merge.ts',
  planning: '../../../../packages/contexts/planning/src/infrastructure/pg-classification-merge.ts',
  commitments: '../../../../packages/contexts/commitments/src/infrastructure/pg-classification-merge.ts',
  rules: '../../../../packages/contexts/rules/src/application/classification-merge.participant.ts',
  reporting: '../../../../packages/contexts/reporting/src/infrastructure/pg-classification-merge.ts',
  debt: '../../../../packages/contexts/debt/src/infrastructure/pg-classification-merge.ts',
  imports: '../../../../packages/contexts/imports/src/infrastructure/pg-classification-merge.ts',
};

describe('Participantes de la fusión (design decisión 1)', () => {
  it('[TC-CLASSIFICATION-MERGE-001] cada contexto de la lista cerrada implementa el puerto con su nombre de contexto', () => {
    for (const [context, file] of Object.entries(PARTICIPANTS)) {
      const source = read(file);
      expect(source, context).toMatch(/implements ClassificationMergeParticipant/);
      expect(source, context).toContain(`readonly context = '${context}'`);
      expect(source, context).toContain("from '@pf/classification/contracts'");
    }
  });

  it('[TC-CLASSIFICATION-MERGE-001] la composición los registra todos, de a uno y en orden fijo', () => {
    const wiring = read('./identity-wiring.ts');
    const pushed = /mergeParticipants\.push\(([\s\S]*?)\);/.exec(wiring)?.[1] ?? '';
    const order = [
      'transactionsMergeParticipant',
      'planningMergeParticipant',
      'commitmentsMergeParticipant',
      'rules.mergeParticipant',
      'reportingMergeParticipant',
      'debtMergeParticipant',
      'importsMergeParticipant',
    ];
    const positions = order.map((name) => pushed.indexOf(name));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    // Sin consultas en paralelo sobre el mismo cliente: el servicio los recorre con `for … of` y `await`.
    const service = read('../../../../packages/contexts/classification/src/application/merge.service.ts');
    expect(service).not.toMatch(/Promise\.all/);
  });

  it('[TC-CLASSIFICATION-MERGE-028] FORECAST y RULES leen la historia por CategoryMergeQuery.resolve', () => {
    const wiring = read('./identity-wiring.ts');
    expect(wiring.match(/categoryMerge: classification\.categoryMerge/g)).toHaveLength(2);
  });
});
