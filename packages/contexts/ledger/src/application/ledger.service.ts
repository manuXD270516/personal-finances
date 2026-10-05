import type { AuditPort } from '@pf/audit/contracts';
import { DomainError, LocalDate, Money } from '@pf/shared-kernel';
import type {
  LedgerPeriodLockPort,
  LedgerPostingPort,
  PostedEntryDto,
  PostJournalEntryCommand,
  PostingLineDto,
  ReverseJournalEntryCommand,
} from '../contracts/index.js';
import { JOURNAL_ENTRY_POSTED } from '../contracts/index.js';
import {
  JournalEntry,
  ReversalFactory,
  YearMonth,
  type LedgerAccount,
  type PostingInput,
  type SourceRef,
} from '../domain/index.js';
import { journalEntryPostedPayload } from './journal-entry-posted.js';
import type { LedgerDeps } from './ports/index.js';

/**
 * Casos de uso de escritura del ledger (design.md §Decisiones 1–6, 11): `PostJournalEntry`, `ReverseJournalEntry`,
 * `LockPeriod`/`UnlockPeriod` y el get-or-create de la cuenta contable de una cuenta del usuario. Cada mutación,
 * dentro de UNA unidad de trabajo: valida en dominio → persiste (append-only) → evento por outbox → auditoría
 * (AuditPort, INV-029). Un asiento rechazado no deja asiento, postings, evento ni auditoría.
 */
export class LedgerService implements LedgerPostingPort, LedgerPeriodLockPort {
  constructor(
    private readonly deps: LedgerDeps,
    private readonly audit: AuditPort,
  ) {}

  postJournalEntry(command: PostJournalEntryCommand): Promise<PostedEntryDto> {
    return this.deps.uow.run(command.workspaceId, async () => {
      const { entries, periods, ids, context } = this.deps;
      const sourceRef: SourceRef = {
        context: 'TRANSACTIONS',
        type: command.sourceRef.type,
        id: command.sourceRef.id,
        revision: command.sourceRef.revision,
      };
      const existing = await entries.findBySource(command.workspaceId, sourceRef, command.entryType);
      if (existing) return { journalEntryId: existing.id, sequence: existing.sequence ?? '', created: false };

      const entryDate = LocalDate.parse(command.entryDate);
      const postings: PostingInput[] = [];
      for (const [i, line] of command.postings.entries()) {
        try {
          postings.push(await this.posting(command.workspaceId, line));
        } catch (err) {
          throw err instanceof DomainError ? err.at(`/postings/${i}`) : err;
        }
      }
      const entry = JournalEntry.post(
        {
          id: ids.newId(),
          workspaceId: command.workspaceId,
          entryDate,
          entryType: command.entryType,
          sourceRef,
          reversesEntryId: null,
          memo: command.memo ?? null,
          correlationId: context.correlationId(),
          createdBy: context.actorUserId(),
          postings,
        },
        { periodLocked: await periods.isLocked(command.workspaceId, YearMonth.of(entryDate)) },
      );
      const saved = await entries.append(entry);
      await this.publish(saved);
      await this.audit.append({
        workspaceId: saved.workspaceId,
        action: 'ledger.journal_entry.posted',
        aggregateType: 'JournalEntry',
        aggregateId: saved.id,
        aggregateVersion: 1,
      });
      return { journalEntryId: saved.id, sequence: saved.sequence ?? '', created: true };
    });
  }

  reverseJournalEntry(command: ReverseJournalEntryCommand): Promise<PostedEntryDto> {
    return this.deps.uow.run(command.workspaceId, async () => {
      const { entries, periods, ids, context } = this.deps;
      const original = await entries.findById(command.workspaceId, command.journalEntryId);
      if (!original) {
        throw new DomainError('REFERENCE_NOT_FOUND', `journal entry ${command.journalEntryId} not found`);
      }
      if (original.entryType === 'REVERSAL') {
        throw new DomainError('LEDGER_ENTRY_NOT_REVERSIBLE', `entry ${original.id} is a reversal`);
      }
      if (await entries.isReversed(command.workspaceId, original.id)) {
        throw new DomainError('LEDGER_ENTRY_ALREADY_REVERSED', `entry ${original.id} was already reversed`);
      }
      const entryDate = LocalDate.parse(command.reverseDate);
      const reversal = ReversalFactory.reverse(
        original,
        {
          id: ids.newId(),
          entryDate,
          postingIds: original.postings.map(() => ids.newId()),
          memo: command.reason,
          correlationId: context.correlationId(),
          createdBy: context.actorUserId(),
        },
        { periodLocked: await periods.isLocked(command.workspaceId, YearMonth.of(entryDate)) },
      );
      const saved = await entries.append(reversal);
      await entries.recordReversal(command.workspaceId, original.id, saved.id);
      await this.publish(saved);
      await this.audit.append({
        workspaceId: saved.workspaceId,
        action: 'ledger.journal_entry.reversed',
        aggregateType: 'JournalEntry',
        aggregateId: original.id,
        aggregateVersion: null,
        reason: command.reason,
        changes: [{ field: 'reversedByEntryId', before: null, after: saved.id }],
      });
      return { journalEntryId: saved.id, sequence: saved.sequence ?? '', created: true };
    });
  }

  ledgerAccountForUserAccount(input: {
    readonly workspaceId: string;
    readonly accountId: string;
    readonly nature: 'ASSET' | 'LIABILITY';
    readonly currency: string;
  }): Promise<{ readonly ledgerAccountId: string; readonly code: string }> {
    return this.deps.uow.run(input.workspaceId, async () => {
      const account = await this.deps.accounts.getOrCreateForUserAccount({
        workspaceId: input.workspaceId,
        sourceAccountId: input.accountId,
        nature: input.nature,
        currency: await this.deps.currencies.currencyOf(input.currency),
      });
      return { ledgerAccountId: account.id, code: account.code.value };
    });
  }

  assertPeriodOpen(input: { readonly workspaceId: string; readonly date: string }): Promise<void> {
    return this.deps.uow.run(input.workspaceId, async () => {
      const date = LocalDate.parse(input.date);
      if (await this.deps.periods.isLocked(input.workspaceId, YearMonth.of(date))) {
        throw new DomainError('PERIOD_CLOSED', `${date.toString()} is in a closed period`);
      }
    });
  }

  lockPeriod(input: {
    readonly workspaceId: string;
    readonly yearMonth: string;
    readonly periodId?: string | null;
  }): Promise<void> {
    return this.deps.uow.run(input.workspaceId, async () => {
      const yearMonth = YearMonth.parse(input.yearMonth);
      const changed = await this.deps.periods.lock(
        { workspaceId: input.workspaceId, yearMonth, periodId: input.periodId ?? null },
        this.deps.context.actorUserId(),
      );
      if (changed)
        await this.auditPeriod(input.workspaceId, input.periodId ?? null, yearMonth, 'locked', null);
    });
  }

  unlockPeriod(input: {
    readonly workspaceId: string;
    readonly yearMonth: string;
    readonly reason: string;
  }): Promise<void> {
    return this.deps.uow.run(input.workspaceId, async () => {
      const yearMonth = YearMonth.parse(input.yearMonth);
      const changed = await this.deps.periods.unlock(input.workspaceId, yearMonth);
      if (changed) await this.auditPeriod(input.workspaceId, null, yearMonth, 'unlocked', input.reason);
    });
  }

  private async posting(workspaceId: string, line: PostingLineDto): Promise<PostingInput> {
    const { accounts, currencies, ids } = this.deps;
    const currency = await currencies.currencyOf(line.amount.currency);
    const amount = Money.parse(line.amount.amount, currency);
    let account: LedgerAccount | null;
    switch (line.target.kind) {
      case 'USER_ACCOUNT':
        account = await accounts.getOrCreateForUserAccount({
          workspaceId,
          sourceAccountId: line.target.accountId,
          nature: line.target.nature,
          currency,
        });
        break;
      case 'SYSTEM':
        account = await accounts.getOrCreateSystem({ workspaceId, kind: line.target.systemKind, currency });
        break;
      case 'LEDGER_ACCOUNT':
        account = await accounts.findById(workspaceId, line.target.ledgerAccountId);
        break;
    }
    if (!account) throw new DomainError('REFERENCE_NOT_FOUND', 'ledger account not found');
    return { id: ids.newId(), account, amount, splitId: line.splitId ?? null };
  }

  private async publish(entry: JournalEntry): Promise<void> {
    const actorId = this.deps.context.actorUserId();
    await this.deps.outbox.append({
      eventId: this.deps.ids.newId(),
      eventType: JOURNAL_ENTRY_POSTED.eventType,
      eventVersion: JOURNAL_ENTRY_POSTED.eventVersion,
      occurredAt: this.deps.clock.now().toString(),
      workspaceId: entry.workspaceId,
      aggregateType: 'JournalEntry',
      aggregateId: entry.id,
      aggregateVersion: 1,
      payload: journalEntryPostedPayload(entry),
      ...(entry.correlationId ? { correlationId: entry.correlationId } : {}),
      actor: actorId ? { type: 'USER', id: actorId } : { type: 'SYSTEM', id: null },
    });
  }

  private auditPeriod(
    workspaceId: string,
    periodId: string | null,
    yearMonth: YearMonth,
    verb: 'locked' | 'unlocked',
    reason: string | null,
  ): Promise<void> {
    return this.audit.append({
      workspaceId,
      action: `ledger.period_lock.${verb}`,
      aggregateType: 'PeriodLock',
      aggregateId: periodId ?? this.deps.ids.newId(),
      aggregateVersion: null,
      reason,
      changes: [
        {
          field: 'yearMonth',
          before: verb === 'locked' ? null : yearMonth.value,
          after: verb === 'locked' ? yearMonth.value : null,
        },
      ],
    });
  }
}
