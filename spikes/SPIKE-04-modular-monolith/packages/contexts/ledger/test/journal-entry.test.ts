import { describe, expect, it } from 'vitest';
import { Money } from '@pf/shared-kernel';
import { JournalEntry } from '../src/domain/journal-entry.js';

const eur = (n: bigint) => Money.ofMinor(n, 'EUR');

describe('JournalEntry (dominio puro, sin Nest)', () => {
  it('acepta un asiento balanceado', () => {
    const e = JournalEntry.post({
      id: 'je-1',
      description: 'ok',
      lines: [
        { ledgerAccountRef: 'a', amount: eur(100n) },
        { ledgerAccountRef: 'b', amount: eur(-100n) },
      ],
    });
    expect(e.lines).toHaveLength(2);
  });

  it('rechaza un asiento desbalanceado', () => {
    expect(() =>
      JournalEntry.post({
        id: 'je-2',
        description: 'ko',
        lines: [
          { ledgerAccountRef: 'a', amount: eur(100n) },
          { ledgerAccountRef: 'b', amount: eur(-99n) },
        ],
      }),
    ).toThrowError(expect.objectContaining({ code: 'LEDGER_UNBALANCED' }));
  });

  it('el dominio se carga sin reflect-metadata ni @nestjs/* en el proceso', () => {
    expect((Reflect as unknown as Record<string, unknown>)['getMetadata']).toBeUndefined();
  });
});
