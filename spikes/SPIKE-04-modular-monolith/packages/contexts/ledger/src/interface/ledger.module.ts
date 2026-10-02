import { Controller, Get, Inject, Module } from '@nestjs/common';
import { ID_GENERATOR, UNIT_OF_WORK } from '@pf/platform';
import type { InMemoryUnitOfWork } from '@pf/platform/in-memory';
import { LedgerService } from '../application/ledger.service.js';
import { InMemoryJournalEntryRepository } from '../infrastructure/in-memory-journal-entry.repository.js';
import { LEDGER_POSTING_API, LEDGER_QUERY_API, type LedgerQueryApi } from '../contracts/index.js';

const JOURNAL_ENTRY_REPOSITORY = Symbol('ledger.JournalEntryRepository');

@Controller('ledger')
export class LedgerController {
  // @Inject explícito con token: no depende de design:paramtypes (decorator metadata).
  constructor(@Inject(LEDGER_QUERY_API) private readonly ledger: LedgerQueryApi) {}

  @Get('entries')
  list() {
    return this.ledger.listJournalEntries();
  }
}

/**
 * Único lugar donde Nest toca el contexto Ledger: wiring de puertos → adapters con tokens.
 * Requiere que el composition root provea UNIT_OF_WORK e ID_GENERATOR (módulo global).
 */
@Module({
  controllers: [LedgerController],
  providers: [
    {
      provide: JOURNAL_ENTRY_REPOSITORY,
      useFactory: (uow: InMemoryUnitOfWork) => new InMemoryJournalEntryRepository(uow),
      inject: [UNIT_OF_WORK],
    },
    {
      provide: LedgerService,
      useFactory: (uow, repo, ids) => new LedgerService(uow, repo, ids),
      inject: [UNIT_OF_WORK, JOURNAL_ENTRY_REPOSITORY, ID_GENERATOR],
    },
    { provide: LEDGER_POSTING_API, useExisting: LedgerService },
    { provide: LEDGER_QUERY_API, useExisting: LedgerService },
  ],
  exports: [LEDGER_POSTING_API, LEDGER_QUERY_API],
})
export class LedgerModule {}
