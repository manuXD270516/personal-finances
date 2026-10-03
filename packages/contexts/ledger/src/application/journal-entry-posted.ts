import type { JournalEntry } from '../domain/index.js';

/** Payload de `ledger.JournalEntryPosted.v1` (contracts/events/ledger): montos como `Money` JSON a su escala. */
export function journalEntryPostedPayload(entry: JournalEntry): Record<string, unknown> {
  if (entry.sequence === null) throw new Error('el asiento debe estar persistido (sequence)');
  return {
    journalEntryId: entry.id,
    entryDate: entry.entryDate.toString(),
    entryType: entry.entryType,
    sequence: entry.sequence,
    sourceRef: { ...entry.sourceRef },
    reversesEntryId: entry.reversesEntryId,
    postings: entry.postings.map((p) => ({
      postingId: p.id,
      ledgerAccountId: p.account.id,
      accountId: p.account.sourceAccountId,
      systemAccountCode: p.account.sourceAccountId === null ? p.account.code.value : null,
      amount: p.amount.toJSON(),
      splitId: p.splitId,
    })),
  };
}
