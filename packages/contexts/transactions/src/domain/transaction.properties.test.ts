import { DomainError, Money } from '@pf/shared-kernel';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { BOB, BANK_A, expense, nextId } from './fixtures.test-support.js';
import { toJournalEntryDraft } from './posting-translator.js';
import { hasActiveEntry, TRANSACTION_STATUSES } from './transaction-status.js';
import type { Transaction, TransactionKind } from './transaction.js';

const units = fc.bigInt({ min: 1n, max: 10_000_000n });
const money = (u: bigint) => Money.ofMinorUnits(u, BOB);
const kinds = fc.constantFrom<TransactionKind>('INCOME', 'EXPENSE', 'REFUND', 'ADJUSTMENT');

/** Σ postings por moneda = 0 (INV-004) y legs = postings sobre cuentas del usuario (INV-024). */
function assertBalancedAndLegs(tx: Transaction): void {
  const draft = toJournalEntryDraft(tx.snapshot);
  const sum = Money.sum(
    draft.postings.map((p) => p.amount),
    BOB,
  );
  expect(sum.isZero()).toBe(true);
  expect(draft.postings.every((p) => !p.amount.isZero())).toBe(true);
  const user = draft.postings.filter((p) => p.target.kind === 'USER_ACCOUNT').map((p) => p.amount.toFixed());
  expect(user).toEqual(tx.snapshot.legs.map((l) => l.amount.toFixed()));
}

describe('Propiedades del agregado Transaction', () => {
  it('[TC-TRANSACTIONS-SPLIT-001] INV-021: splits aleatorios se aceptan si y solo si suman exacto', () => {
    fc.assert(
      fc.property(
        fc.array(units, { minLength: 1, maxLength: 8 }),
        fc.bigInt({ min: -3n, max: 3n }),
        (parts, delta) => {
          const total = parts.reduce((a, b) => a + b, 0n) + delta;
          fc.pre(total > 0n);
          const splits = parts.map((u) => ({ id: nextId(), amount: money(u), categoryId: nextId() }));
          try {
            const tx = expense({ amount: money(total), splits });
            expect(delta).toBe(0n);
            assertBalancedAndLegs(tx);
          } catch (err) {
            expect(delta).not.toBe(0n);
            expect((err as DomainError).code).toBe('SPLITS_DO_NOT_SUM');
          }
        },
      ),
    );
  });

  it('[TC-TRANSACTIONS-SPLIT-003] reparto con Money.allocate siempre suma el total y produce un asiento cuadrado', () => {
    fc.assert(
      fc.property(
        units,
        fc.array(fc.integer({ min: 1, max: 100 }), { minLength: 1, maxLength: 6 }),
        (u, weights) => {
          fc.pre(u >= BigInt(weights.length));
          const parts = money(u).allocate(weights);
          fc.pre(parts.every((p) => p.isPositive()));
          const tx = expense({
            amount: money(u),
            splits: parts.map((amount) => ({ id: nextId(), amount, categoryId: nextId() })),
          });
          assertBalancedAndLegs(tx);
        },
      ),
    );
  });

  it('INV-004/INV-024: todo kind y naturaleza de cuenta produce un asiento balanceado cuyos legs son los postings de usuario', () => {
    fc.assert(
      fc.property(
        kinds,
        fc.constantFrom('ASSET', 'LIABILITY' as const),
        units,
        fc.boolean(),
        (kind, nature, u, inc) => {
          const tx = expense({
            kind,
            accountNature: nature,
            amount: money(u),
            ...(kind === 'ADJUSTMENT' ? { direction: inc ? 'INCREASE' : 'DECREASE', reason: 'ajuste' } : {}),
          });
          assertBalancedAndLegs(tx);
        },
      ),
    );
  });

  it('reversa: el asiento de una revisión y su negación suman cero por cuenta (edición = reversa + nuevo asiento)', () => {
    fc.assert(
      fc.property(units, units, (a, b) => {
        fc.pre(a !== b);
        const tx = expense({ amount: money(a) });
        tx.attachEntry('e1');
        const before = toJournalEntryDraft(tx.snapshot);
        tx.amend({ amount: money(b) });
        const after = toJournalEntryDraft(tx.snapshot);
        expect(after.sourceRef.revision).toBe(2);
        const net = new Map<string, Money>();
        const key = (p: (typeof before.postings)[number]) =>
          p.target.kind === 'USER_ACCOUNT' ? p.target.accountId : p.target.systemKind;
        for (const p of before.postings)
          net.set(key(p), (net.get(key(p)) ?? Money.zero(BOB)).add(p.amount.negate()));
        for (const p of after.postings) net.set(key(p), (net.get(key(p)) ?? Money.zero(BOB)).add(p.amount));
        // Saldo neto de la cuenta = efecto de la diferencia de montos (−(b − a) para un gasto).
        expect(net.get(BANK_A)?.equals(money(a).subtract(money(b)))).toBe(true);
      }),
    );
  });

  it('[TC-TRANSACTIONS-STATUS-001] INV-023: secuencias aleatorias de comandos nunca dejan PENDING/VOIDED con asiento activo', () => {
    const command = fc.constantFrom('post', 'clear', 'unclear', 'reconcile', 'unreconcile', 'void', 'amend');
    fc.assert(
      fc.property(
        fc.constantFrom('PENDING', 'POSTED', 'CLEARED' as const),
        fc.array(command, { maxLength: 12 }),
        (start, cmds) => {
          const tx = expense({ status: start });
          if (tx.needsEntry) tx.attachEntry(nextId());
          for (const c of cmds) {
            try {
              if (c === 'post') {
                tx.post();
                tx.attachEntry(nextId());
              } else if (c === 'clear') tx.changeStatus('CLEARED');
              else if (c === 'unclear') tx.changeStatus('POSTED');
              else if (c === 'reconcile') tx.changeStatus('RECONCILED');
              else if (c === 'unreconcile') tx.unreconcile('motivo');
              else if (c === 'void') tx.void('motivo', '2026-10-01T00:00:00Z');
              else {
                const r = tx.amend({ amount: money(BigInt(tx.version) * 100n + 1n) });
                if (r.ledgerImpact) tx.attachEntry(nextId());
              }
            } catch (err) {
              expect(err).toBeInstanceOf(DomainError);
            }
            const s = tx.snapshot;
            expect(TRANSACTION_STATUSES).toContain(s.status);
            expect(s.activeEntryId !== null).toBe(hasActiveEntry(s.status));
            if (s.status === 'VOIDED') expect(s.voidedAt).not.toBeNull();
          }
        },
      ),
    );
  });
});
