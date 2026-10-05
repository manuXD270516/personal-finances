import { isDomainError, type StateTransition } from '@pf/shared-kernel';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { Category, CategoryGroup } from './category.js';
import {
  CATEGORY_LIFECYCLE,
  COUNTERPARTY_LIFECYCLE,
  type ClassificationStatus,
  type ClassificationTransition,
} from './classification-lifecycle.js';
import { Counterparty } from './counterparty.js';

const WS = '0190c000-0000-7000-8000-000000000001';
const AT = '2026-03-10T14:00:00Z';
const codeOf = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (err) {
    if (isDomainError(err)) return err.code;
    throw err;
  }
  return undefined;
};
let seq = 0;
const id = () => `0190c000-0000-7000-8000-${(++seq).toString(16).padStart(12, '0')}`;
const group = () => CategoryGroup.create({ id: id(), workspaceId: WS, kind: 'EXPENSE', name: `G${seq}` });
type Step = StateTransition<ClassificationStatus, ClassificationTransition>;

describe('Máquinas Category y Counterparty (docs/31 D52, tarea 9.1)', () => {
  it('[TC-AUDIT-LIFECYCLE-014] ACTIVE/ARCHIVED sin terminales; CREATE, ARCHIVE y UNARCHIVE con guarda; sin MERGE', () => {
    for (const machine of [CATEGORY_LIFECYCLE, COUNTERPARTY_LIFECYCLE]) {
      const d = machine.definition;
      expect(d.machineVersion).toBe(1);
      expect(d.states).toEqual([
        { code: 'ACTIVE', terminal: false },
        { code: 'ARCHIVED', terminal: false },
      ]);
      expect(d.transitions.map((t) => [t.code, t.from, t.to])).toEqual([
        ['CREATE', [], ['ACTIVE']],
        ['ARCHIVE', ['ACTIVE'], ['ARCHIVED']],
        ['UNARCHIVE', ['ARCHIVED'], ['ACTIVE']],
      ]);
      expect(d.transitions.every((t) => t.guard.length > 0)).toBe(true);
      expect(d.transitions.some((t) => t.code === ('MERGE' as string))).toBe(false);
      expect(codeOf(() => machine.transition('ARCHIVE', 'ARCHIVED'))).toBe('INVALID_STATUS_TRANSITION');
      expect(codeOf(() => machine.transition('UNARCHIVE', 'ACTIVE'))).toBe('INVALID_STATUS_TRANSITION');
      expect(codeOf(() => machine.transition('CREATE', 'ACTIVE'))).toBe('INVALID_STATUS_TRANSITION');
    }
    expect(CATEGORY_LIFECYCLE.definition.transitions.find((t) => t.code === 'ARCHIVE')?.events).toEqual([
      'classification.CategoryArchived.v1',
    ]);
    expect(COUNTERPARTY_LIFECYCLE.definition.transitions.flatMap((t) => t.events)).toEqual([]);
  });

  it('[TC-AUDIT-LIFECYCLE-014] los agregados marcan CREATE al crearse y rechazan archivar dos veces o desarchivar una activa', () => {
    const cat = Category.create({ id: id(), group: group(), name: 'Super' });
    expect(cat.lastTransition).toEqual({ transition: 'CREATE', from: null, to: 'ACTIVE' });
    const reloaded = Category.restore(cat.snapshot());
    expect(reloaded.lastTransition).toBeNull();
    expect(codeOf(() => reloaded.unarchive(group(), null))).toBe('INVALID_STATUS_TRANSITION');
    reloaded.archive(AT);
    expect(reloaded.lastTransition).toEqual({ transition: 'ARCHIVE', from: 'ACTIVE', to: 'ARCHIVED' });
    expect(codeOf(() => Category.restore(reloaded.snapshot()).archive(AT))).toBe('INVALID_STATUS_TRANSITION');

    const cp = Counterparty.create({ id: id(), workspaceId: WS, name: 'Entel' });
    expect(cp.lastTransition).toEqual({ transition: 'CREATE', from: null, to: 'ACTIVE' });
    const cp2 = Counterparty.restore(cp.snapshot());
    expect(codeOf(() => cp2.unarchive())).toBe('INVALID_STATUS_TRANSITION');
    expect(cp2.lastTransition).toBeNull();
    // Un cambio descriptivo no es transición (anotación).
    expect(cp2.update({ aliases: ['ENTEL S.A.'] })).toBe(true);
    expect(cp2.lastTransition).toBeNull();
  });

  it('[TC-AUDIT-LIFECYCLE-017] archivar una categoría de sistema se rechaza sin marcar transición', () => {
    const fees = Category.restore({
      ...Category.create({ id: id(), group: group(), name: 'Comisiones', systemCode: 'FEES' }).snapshot(),
    });
    expect(codeOf(() => fees.archive(AT))).toBe('SYSTEM_CATEGORY_IMMUTABLE');
    expect(fees.lastTransition).toBeNull();
    expect(fees.status).toBe('ACTIVE');
  });

  it('[TC-AUDIT-LIFECYCLE-014] PBT: toda secuencia de comandos deja un recorrido reproducible por la máquina que termina en su estado', () => {
    const op = fc.constantFrom('archive', 'unarchive', 'rename');
    fc.assert(
      fc.property(fc.array(op, { maxLength: 25 }), fc.boolean(), (ops, isCounterparty) => {
        const g = group();
        let agg: Category | Counterparty = isCounterparty
          ? Counterparty.create({ id: id(), workspaceId: WS, name: 'X' })
          : Category.create({ id: id(), group: g, name: 'X' });
        const path: Step[] = [agg.lastTransition as Step];
        for (const [i, o] of ops.entries()) {
          agg =
            agg instanceof Category ? Category.restore(agg.snapshot()) : Counterparty.restore(agg.snapshot());
          const before = agg.status;
          let rejected = false;
          try {
            if (o === 'archive') agg.archive(AT);
            else if (o === 'unarchive') {
              if (agg instanceof Category) agg.unarchive(g, null);
              else agg.unarchive();
            } else agg.update({ name: `X${i}` });
          } catch (err) {
            if (!isDomainError(err) || err.code !== 'INVALID_STATUS_TRANSITION') throw err;
            rejected = true;
          }
          if (rejected) {
            expect(agg.status).toBe(before);
            expect(agg.lastTransition).toBeNull();
          } else if (agg.lastTransition) {
            path.push(agg.lastTransition);
          } else {
            expect(agg.status).toBe(before); // anotación: sin cambio de estado
          }
        }
        const machine = agg instanceof Category ? CATEGORY_LIFECYCLE : COUNTERPARTY_LIFECYCLE;
        expect(machine.replay(path)).toBe(agg.status);
      }),
    );
  });
});
