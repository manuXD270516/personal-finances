import type { InMemoryUnitOfWork } from '@pf/platform/in-memory';
import type { JournalEntry, JournalEntryRepository } from '../domain/journal-entry.js';

/** Adapter: en producción sería Kysely sobre el schema `ledger`. */
export class InMemoryJournalEntryRepository implements JournalEntryRepository {
  constructor(private readonly uow: InMemoryUnitOfWork) {}

  async save(entry: JournalEntry): Promise<void> {
    this.uow.table<JournalEntry>('ledger.journal_entry').set(entry.id, entry);
  }

  async list(): Promise<JournalEntry[]> {
    return [...this.uow.table<JournalEntry>('ledger.journal_entry').values()];
  }
}
