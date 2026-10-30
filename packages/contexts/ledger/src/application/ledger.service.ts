import type { AuditPort } from '@pf/audit/contracts';
import { DomainError, LocalDate, Money, type Currency } from '@pf/shared-kernel';
import type {
  LedgerPeriodLockPort,
  LedgerPostingPort,
  PostedEntryDto,
  PostJournalEntryCommand,
  PostingLineDto,
  ReverseJournalEntryCommand,
} from '../contracts/index.js';
import { JOURNAL_ENTRY_POSTED, MAX_POST_BATCH } from '../contracts/index.js';
import {
  JournalEntry,
  ReversalFactory,
  newPeriodLock,
  YearMonth,
  type LedgerAccount,
  type PeriodLock,
  type PostingInput,
  type SourceRef,
} from '../domain/index.js';
import { journalEntryPostedPayload } from './journal-entry-posted.js';
import type { LedgerDeps, LedgerOutboxDraft } from './ports/index.js';

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
        { periodLocked: await periods.isLocked(command.workspaceId, entryDate) },
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

  /**
   * `PostJournalEntry` por conjunto (openspec add-bulk-imported-transactions decisión 3): mismas reglas que
   * `postJournalEntry` por comando, con una consulta por conjunto para la idempotencia por origen, los periodos
   * cerrados (fechas distintas) y las cuentas contables (cada una se resuelve una vez), y escrituras multi-fila de
   * asientos, postings, eventos y auditoría. Un comando inválido revierte el conjunto (unidad de trabajo del llamador).
   */
  postJournalEntries(commands: readonly PostJournalEntryCommand[]): Promise<readonly PostedEntryDto[]> {
    const first = commands[0];
    if (!first) return Promise.resolve([]);
    if (commands.length > MAX_POST_BATCH) {
      return Promise.reject(
        new DomainError('VALIDATION_FAILED', `a batch has at most ${MAX_POST_BATCH} journal entries`),
      );
    }
    const workspaceId = first.workspaceId;
    return this.deps.uow.run(workspaceId, async () => {
      const { entries, periods, ids, context } = this.deps;
      if (commands.some((c) => c.workspaceId !== workspaceId)) {
        throw new DomainError('VALIDATION_FAILED', 'a batch belongs to a single workspace');
      }
      const sourceOf = (c: PostJournalEntryCommand): SourceRef => ({
        context: 'TRANSACTIONS',
        type: c.sourceRef.type,
        id: c.sourceRef.id,
        revision: c.sourceRef.revision,
      });
      const keyOf = (type: string, id: string, revision: number) => `${type}|${id}|${revision}`;
      // Idempotencia por origen: una consulta por tipo de asiento del conjunto.
      const existing = new Map<string, { readonly id: string; readonly sequence: string }>();
      for (const type of new Set(commands.map((c) => c.entryType))) {
        const own = commands.filter((c) => c.entryType === type);
        const found = await entries.existingBySources(workspaceId, own.map(sourceOf), type);
        for (const c of own) {
          const hit = found.get(`${c.sourceRef.id}|${c.sourceRef.revision}`);
          if (hit) existing.set(keyOf(type, c.sourceRef.id, c.sourceRef.revision), hit);
        }
      }
      // Un origen repetido dentro del conjunto se comporta como en llamadas sucesivas: el primero crea, el resto es existente.
      const seen = new Set<string>();
      const fresh = commands.filter((c) => {
        const key = keyOf(c.entryType, c.sourceRef.id, c.sourceRef.revision);
        if (existing.has(key) || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      const dates = new Map(fresh.map((c) => [c.entryDate, LocalDate.parse(c.entryDate)] as const));
      const locked =
        fresh.length > 0 ? await periods.lockedDates(workspaceId, [...dates.values()]) : new Set<string>();
      const resolve = this.accountResolver(workspaceId, true);
      const built: JournalEntry[] = [];
      for (const command of fresh) {
        const postings: PostingInput[] = [];
        for (const [i, line] of command.postings.entries()) {
          try {
            postings.push(await resolve(line));
          } catch (err) {
            throw err instanceof DomainError ? err.at(`/postings/${i}`) : err;
          }
        }
        built.push(
          JournalEntry.post(
            {
              id: ids.newId(),
              workspaceId,
              entryDate: dates.get(command.entryDate) as LocalDate,
              entryType: command.entryType,
              sourceRef: sourceOf(command),
              reversesEntryId: null,
              memo: command.memo ?? null,
              correlationId: context.correlationId(),
              createdBy: context.actorUserId(),
              postings,
            },
            { periodLocked: locked.has(command.entryDate) },
          ),
        );
      }
      const saved = built.length > 0 ? await entries.appendMany(built) : [];
      await this.publishMany(saved);
      if (saved.length > 0) {
        const auditEntries = saved.map((entry) => ({
          workspaceId: entry.workspaceId,
          action: 'ledger.journal_entry.posted',
          aggregateType: 'JournalEntry',
          aggregateId: entry.id,
          aggregateVersion: 1,
        }));
        if (this.audit.appendMany) await this.audit.appendMany(auditEntries);
        else for (const e of auditEntries) await this.audit.append(e);
      }
      const bySource = new Map(
        saved.map((e) => [keyOf(e.entryType, e.sourceRef.id, e.sourceRef.revision), e] as const),
      );
      const reported = new Set<string>();
      return commands.map((c): PostedEntryDto => {
        const key = keyOf(c.entryType, c.sourceRef.id, c.sourceRef.revision);
        const hit = existing.get(key);
        if (hit) return { journalEntryId: hit.id, sequence: hit.sequence, created: false };
        const entry = bySource.get(key) as JournalEntry;
        const created = !reported.has(key);
        reported.add(key);
        return { journalEntryId: entry.id, sequence: entry.sequence ?? '', created };
      });
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
        { periodLocked: await periods.isLocked(command.workspaceId, entryDate) },
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

  /**
   * `ReverseJournalEntry` por conjunto (openspec add-import-pipeline, decisión 15): carga los originales, las reversas
   * existentes y los periodos cerrados con una consulta cada una y escribe asientos, postings, vínculos, eventos y
   * auditoría con sentencias multi-fila. Mismas reglas de dominio que `reverseJournalEntry` (ReversalFactory).
   */
  reverseJournalEntries(commands: readonly ReverseJournalEntryCommand[]): Promise<readonly PostedEntryDto[]> {
    const first = commands[0];
    if (!first) return Promise.resolve([]);
    if (commands.length > MAX_POST_BATCH) {
      return Promise.reject(
        new DomainError('VALIDATION_FAILED', `a batch has at most ${MAX_POST_BATCH} journal entries`),
      );
    }
    const workspaceId = first.workspaceId;
    return this.deps.uow.run(workspaceId, async () => {
      const { entries, periods, ids, context } = this.deps;
      if (commands.some((c) => c.workspaceId !== workspaceId)) {
        throw new DomainError('VALIDATION_FAILED', 'a batch belongs to a single workspace');
      }
      const distinct = new Set(commands.map((c) => c.journalEntryId));
      if (distinct.size !== commands.length) {
        throw new DomainError('LEDGER_ENTRY_ALREADY_REVERSED', 'an entry appears twice in the batch');
      }
      const originals = new Map(
        (await entries.findManyById(workspaceId, [...distinct])).map((e) => [e.id, e] as const),
      );
      const reversed = await entries.reversedAmong(workspaceId, [...distinct]);
      const dates = new Map(commands.map((c) => [c.reverseDate, LocalDate.parse(c.reverseDate)] as const));
      const locked = await periods.lockedDates(workspaceId, [...dates.values()]);
      const built: JournalEntry[] = [];
      for (const command of commands) {
        const original = originals.get(command.journalEntryId);
        if (!original) {
          throw new DomainError('REFERENCE_NOT_FOUND', `journal entry ${command.journalEntryId} not found`);
        }
        if (original.entryType === 'REVERSAL') {
          throw new DomainError('LEDGER_ENTRY_NOT_REVERSIBLE', `entry ${original.id} is a reversal`);
        }
        if (reversed.has(original.id)) {
          throw new DomainError('LEDGER_ENTRY_ALREADY_REVERSED', `entry ${original.id} was already reversed`);
        }
        built.push(
          ReversalFactory.reverse(
            original,
            {
              id: ids.newId(),
              entryDate: dates.get(command.reverseDate) as LocalDate,
              postingIds: original.postings.map(() => ids.newId()),
              memo: command.reason,
              correlationId: context.correlationId(),
              createdBy: context.actorUserId(),
            },
            { periodLocked: locked.has(command.reverseDate) },
          ),
        );
      }
      const saved = await entries.appendMany(built);
      await entries.recordReversals(
        workspaceId,
        saved.map((r, i) => ({
          originalId: (commands[i] as ReverseJournalEntryCommand).journalEntryId,
          reversalId: r.id,
        })),
      );
      await this.publishMany(saved);
      const auditEntries = saved.map((entry, i) => ({
        workspaceId,
        action: 'ledger.journal_entry.reversed',
        aggregateType: 'JournalEntry',
        aggregateId: (commands[i] as ReverseJournalEntryCommand).journalEntryId,
        aggregateVersion: null,
        reason: (commands[i] as ReverseJournalEntryCommand).reason,
        changes: [{ field: 'reversedByEntryId', before: null, after: entry.id }],
      }));
      if (this.audit.appendMany) await this.audit.appendMany(auditEntries);
      else for (const e of auditEntries) await this.audit.append(e);
      return saved.map((e) => ({ journalEntryId: e.id, sequence: e.sequence ?? '', created: true }));
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
      if (await this.deps.periods.isLocked(input.workspaceId, date)) {
        throw new DomainError('PERIOD_CLOSED', `${date.toString()} is in a closed period`);
      }
    });
  }

  firstOpenDateOnOrAfter(input: { readonly workspaceId: string; readonly date: string }): Promise<string> {
    return this.deps.uow.run(input.workspaceId, async () =>
      (
        await this.deps.periods.firstOpenDateOnOrAfter(input.workspaceId, LocalDate.parse(input.date))
      ).toString(),
    );
  }

  lockPeriod(input: {
    readonly workspaceId: string;
    readonly yearMonth: string;
    readonly periodId?: string | null;
    readonly periodStart?: string | null;
    readonly periodEnd?: string | null;
    readonly openStart?: boolean;
  }): Promise<void> {
    return this.deps.uow.run(input.workspaceId, async () => {
      const yearMonth = YearMonth.parse(input.yearMonth);
      const lock = newPeriodLock({
        workspaceId: input.workspaceId,
        yearMonth,
        periodId: input.periodId ?? null,
        periodStart: input.periodStart ? LocalDate.parse(input.periodStart) : null,
        periodEnd: input.periodEnd ? LocalDate.parse(input.periodEnd) : null,
        openStart: input.openStart === true,
      });
      // Candado EXCLUSIVO del workspace ANTES de insertar el lock: espera a los posteos en vuelo (que lo toman
      // compartido) y bloquea los nuevos hasta el commit del llamador (ADR-0028).
      await this.deps.periods.acquireExclusiveWorkspaceLock(input.workspaceId);
      const changed = await this.deps.periods.lock(lock, this.deps.context.actorUserId());
      if (changed) await this.auditPeriod(input.workspaceId, input.periodId ?? null, lock, 'locked', null);
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
      if (changed) {
        await this.auditPeriod(
          input.workspaceId,
          null,
          newPeriodLock({ workspaceId: input.workspaceId, yearMonth }),
          'unlocked',
          input.reason,
        );
      }
    });
  }

  private async posting(workspaceId: string, line: PostingLineDto): Promise<PostingInput> {
    return this.accountResolver(workspaceId, false)(line);
  }

  /**
   * Resuelve la cuenta contable de cada línea. Con `cache` (escritura por conjunto) cada cuenta y moneda se consulta
   * una sola vez; sin él (un asiento) cada línea consulta, como siempre.
   */
  private accountResolver(
    workspaceId: string,
    cache: boolean,
  ): (line: PostingLineDto) => Promise<PostingInput> {
    const { accounts, currencies, ids } = this.deps;
    const currencyCache = new Map<string, Promise<Currency>>();
    const accountCache = new Map<string, Promise<LedgerAccount | null>>();
    const once = <T>(map: Map<string, Promise<T>>, key: string, load: () => Promise<T>): Promise<T> => {
      if (!cache) return load();
      let hit = map.get(key);
      if (!hit) {
        hit = load();
        map.set(key, hit);
      }
      return hit;
    };
    return async (line) => {
      const currency = await once(currencyCache, line.amount.currency, () =>
        currencies.currencyOf(line.amount.currency),
      );
      const amount = Money.parse(line.amount.amount, currency);
      let account: LedgerAccount | null;
      switch (line.target.kind) {
        case 'USER_ACCOUNT': {
          const target = line.target;
          account = await once(accountCache, `U|${target.accountId}|${target.nature}|${currency.code}`, () =>
            accounts.getOrCreateForUserAccount({
              workspaceId,
              sourceAccountId: target.accountId,
              nature: target.nature,
              currency,
            }),
          );
          break;
        }
        case 'SYSTEM': {
          const target = line.target;
          account = await once(accountCache, `S|${target.systemKind}|${currency.code}`, () =>
            accounts.getOrCreateSystem({ workspaceId, kind: target.systemKind, currency }),
          );
          break;
        }
        case 'LEDGER_ACCOUNT': {
          const target = line.target;
          account = await once(accountCache, `L|${target.ledgerAccountId}`, () =>
            accounts.findById(workspaceId, target.ledgerAccountId),
          );
          break;
        }
      }
      if (!account) throw new DomainError('REFERENCE_NOT_FOUND', 'ledger account not found');
      return { id: ids.newId(), account, amount, splitId: line.splitId ?? null };
    };
  }

  private async publishMany(entries: readonly JournalEntry[]): Promise<void> {
    if (entries.length === 0) return;
    const actorId = this.deps.context.actorUserId();
    const drafts: LedgerOutboxDraft[] = entries.map((entry) => ({
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
      actor: actorId ? { type: 'USER' as const, id: actorId } : { type: 'SYSTEM' as const, id: null },
    }));
    const { outbox } = this.deps;
    if (outbox.appendMany) await outbox.appendMany(drafts);
    else for (const d of drafts) await outbox.append(d);
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
    lock: PeriodLock,
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
          before: verb === 'locked' ? null : lock.yearMonth.value,
          after: verb === 'locked' ? lock.yearMonth.value : null,
        },
        // Rango como texto (valores compuestos de auditoría como texto; `-infinity` = abierto hacia atrás).
        ...(verb === 'locked'
          ? [
              {
                field: 'range',
                before: null,
                after: `${lock.periodStart?.toString() ?? '-infinity'}..${lock.periodEnd.toString()}`,
              },
            ]
          : []),
      ],
    });
  }
}
