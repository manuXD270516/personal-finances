import { Money, type IdGenerator } from '@pf/shared-kernel';
import type { UnitOfWork } from '@pf/platform';
import { JournalEntry, type JournalEntryRepository } from '../domain/journal-entry.js';
import type {
  JournalEntryDto,
  LedgerPostingApi,
  LedgerQueryApi,
  PostJournalEntryCommand,
} from '../contracts/index.js';

/** Implementación de los contratos públicos. Clase TS plana: Nest la instancia vía useFactory. */
export class LedgerService implements LedgerPostingApi, LedgerQueryApi {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly entries: JournalEntryRepository,
    private readonly ids: IdGenerator,
  ) {}

  postJournalEntry(cmd: PostJournalEntryCommand): Promise<{ journalEntryId: string }> {
    // uow.run reutiliza la transacción del llamador (p. ej. Accounts) si existe.
    return this.uow.run(async () => {
      const entry = JournalEntry.post({
        id: this.ids.next(),
        description: cmd.description,
        lines: cmd.lines.map((l) => ({
          ledgerAccountRef: l.ledgerAccountRef,
          amount: Money.ofMinor(BigInt(l.amountMinor), l.currency),
        })),
      });
      await this.entries.save(entry);
      return { journalEntryId: entry.id };
    });
  }

  async listJournalEntries(): Promise<JournalEntryDto[]> {
    const all = await this.entries.list();
    return all.map((e) => ({
      id: e.id,
      description: e.description,
      lines: e.lines.map((l) => ({
        ledgerAccountRef: l.ledgerAccountRef,
        amountMinor: l.amount.minor.toString(),
        currency: l.amount.currency,
      })),
    }));
  }
}
