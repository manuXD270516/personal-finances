import { DomainError, type LocalDate } from '@pf/shared-kernel';
import { JournalEntry, type ValidationContext } from './journal-entry.js';

export interface ReversalInput {
  readonly id: string;
  readonly entryDate: LocalDate;
  /** Un id por posting del original, en el mismo orden. */
  readonly postingIds: readonly string[];
  readonly memo: string | null;
  readonly correlationId: string | null;
  readonly createdBy: string | null;
}

/**
 * DS `ReversalFactory` (docs/09 §5, design.md §Decisiones 4; INV-008): copia cuentas, splits y orden de líneas del
 * original y niega cada monto EXACTAMENTE (`Money.negate`). Rechaza revertir una reversa
 * (`LEDGER_ENTRY_NOT_REVERSIBLE`); la unicidad de la reversa la garantizan el caso de uso y la PK de
 * `ledger.entry_reversal` (`LEDGER_ENTRY_ALREADY_REVERSED`). La fecha la decide el llamador; el periodo se valida.
 */
export const ReversalFactory = {
  reverse(original: JournalEntry, input: ReversalInput, ctx: ValidationContext): JournalEntry {
    if (original.entryType === 'REVERSAL') {
      throw new DomainError('LEDGER_ENTRY_NOT_REVERSIBLE', `entry ${original.id} is a reversal`);
    }
    if (input.postingIds.length !== original.postings.length) {
      throw new DomainError('INTERNAL_ERROR', 'one posting id per original posting is required');
    }
    return JournalEntry.post(
      {
        id: input.id,
        workspaceId: original.workspaceId,
        entryDate: input.entryDate,
        entryType: 'REVERSAL',
        sourceRef: original.sourceRef,
        reversesEntryId: original.id,
        memo: input.memo,
        correlationId: input.correlationId,
        createdBy: input.createdBy,
        postings: original.postings.map((p, i) => ({
          id: input.postingIds[i]!,
          account: p.account,
          amount: p.amount.negate(),
          splitId: p.splitId,
        })),
      },
      ctx,
    );
  },
};
