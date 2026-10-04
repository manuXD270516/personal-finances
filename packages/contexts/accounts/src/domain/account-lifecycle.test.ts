import { DomainError, type StateTransition } from '@pf/shared-kernel';
import { describe, expect, it } from 'vitest';
import {
  ACCOUNT_LIFECYCLE,
  type AccountLifecycleStatus,
  type AccountTransition,
} from './account-lifecycle.js';
import { Account } from './account.js';

const code = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (err) {
    if (err instanceof DomainError) return err.code;
    throw err;
  }
  return undefined;
};

const open = () =>
  Account.open({
    id: 'c1',
    workspaceId: 'w1',
    name: 'Bank C',
    type: 'BANK',
    currency: 'BOB',
    currencyKind: 'FIAT',
    displayOrder: 0,
    openedOn: '2026-01-01',
  });
const reload = (a: Account) => Account.restore(a.snapshot);

describe('Máquina de estados Account (add-lifecycle-timeline)', () => {
  it('[TC-AUDIT-LIFECYCLE-001] la definición declara ACTIVE/CLOSED/ARCHIVED y OPEN, CLOSE, ARCHIVE, REACTIVATE; archivar dos veces se rechaza', () => {
    const d = ACCOUNT_LIFECYCLE.definition;
    expect(d.states.map((s) => s.code)).toEqual(['ACTIVE', 'CLOSED', 'ARCHIVED']);
    expect(d.transitions.map((t) => [t.code, t.from, t.to])).toEqual([
      ['OPEN', [], ['ACTIVE']],
      ['CLOSE', ['ACTIVE'], ['CLOSED']],
      ['ARCHIVE', ['ACTIVE', 'CLOSED'], ['ARCHIVED']],
      ['REACTIVATE', ['ARCHIVED', 'CLOSED'], ['ACTIVE']],
    ]);
    const a = reload(open());
    a.archive('2026-03-01T12:00:00Z', 'sin uso');
    const again = reload(a);
    expect(code(() => again.archive('2026-03-02T12:00:00Z', null))).toBe('INVALID_STATUS_TRANSITION');
    expect(again.lastTransition).toBeNull();
  });

  it('[TC-AUDIT-LIFECYCLE-009] abrir, archivar ("sin uso"), reactivar y cerrar dejan OPEN, ARCHIVE, REACTIVATE y CLOSE', () => {
    const a = open();
    expect(a.lastTransition).toEqual({ transition: 'OPEN', from: null, to: 'ACTIVE' });
    const b = reload(a);
    b.archive('2026-03-01T12:00:00Z', 'sin uso');
    expect(b.lastTransition).toEqual({ transition: 'ARCHIVE', from: 'ACTIVE', to: 'ARCHIVED' });
    const c = reload(b);
    expect(c.reactivate()).toBe('ARCHIVED');
    expect(c.lastTransition).toEqual({ transition: 'REACTIVATE', from: 'ARCHIVED', to: 'ACTIVE' });
    const d = reload(c);
    d.close('2026-03-31', null, { balanceIsZero: true });
    expect(d.lastTransition).toEqual({ transition: 'CLOSE', from: 'ACTIVE', to: 'CLOSED' });
    expect(d.status).toBe('CLOSED');
  });

  it('[TC-AUDIT-LIFECYCLE-001] exhaustivo (≤ 6 comandos): toda secuencia deja un recorrido reproducible que termina en su estado', () => {
    type Op = 'archive' | 'close' | 'reactivate' | 'rename';
    const all: Op[] = ['archive', 'close', 'reactivate', 'rename'];
    let sequences: Op[][] = [[]];
    for (let n = 0; n < 6; n += 1)
      sequences = [
        ...sequences,
        ...sequences.filter((s) => s.length === n).flatMap((s) => all.map((o) => [...s, o])),
      ];
    expect(sequences).toHaveLength(1 + 4 + 16 + 64 + 256 + 1024 + 4096);
    for (const ops of sequences) {
      let a = open();
      const path: StateTransition<AccountLifecycleStatus, AccountTransition>[] = [a.lastTransition!];
      for (const [i, op] of ops.entries()) {
        a = reload(a);
        try {
          if (op === 'archive') a.archive('2026-03-01T12:00:00Z', null);
          else if (op === 'close') a.close('2026-03-31', null, { balanceIsZero: true });
          else if (op === 'reactivate') a.reactivate();
          else a.update({ name: `Bank ${i}` }, { hasPostings: false });
        } catch (err) {
          expect(err).toBeInstanceOf(DomainError);
          expect(a.lastTransition).toBeNull();
          continue;
        }
        if (a.lastTransition) path.push(a.lastTransition);
      }
      expect(ACCOUNT_LIFECYCLE.replay(path)).toBe(a.status);
    }
  });
});
