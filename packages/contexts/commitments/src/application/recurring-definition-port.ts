import { DomainError, LocalDate, currency as makeCurrency, type Currency } from '@pf/shared-kernel';
import {
  COMMITMENTS_EVENTS,
  type MoneyDto,
  type OccurrencesGeneratedV1,
  type RecurringDefinitionPort,
  type RecurringKindDto,
  type RecurringOccurrenceMaterializedV1,
} from '../contracts/index.js';
import {
  RecurringOccurrence,
  buildAmountSpec,
  explicitItemsOf,
  type ExplicitScheduleItem,
  type RecurringDefinition,
} from '../domain/index.js';
import type { DefinitionsService, TemplateChanges } from './definitions.service.js';
import type { CommitmentsDeps } from './ports/index.js';
import {
  DEFINITION_AGGREGATE,
  OCCURRENCE_AGGREGATE,
  occurrenceChanges,
  occurrenceEntry,
  occurrenceSteps,
  publishEvent,
  recordOccurrences,
} from './recorder.js';

const MANAGERS = ['SUBSCRIPTION', 'DEBT'] as const;
type Manager = (typeof MANAGERS)[number];

const expectedOf = (o: RecurringOccurrence) => {
  const e = o.snapshot.expected;
  return { type: e.type, amount: e.amount, min: e.min, max: e.max };
};

/**
 * Implementación pública del `RecurringDefinitionPort` (openspec add-loans, N1-N9; genérico por `managedBy`). Corre en
 * la unidad de trabajo del llamador: la definición, las ocurrencias, la auditoría, el recorrido y el outbox de
 * COMMITMENTS se confirman junto con el cambio del administrador. Lee la definición con `FOR UPDATE`, así que
 * `settle`/`unsettle`/`end` concurrentes sobre una misma definición se serializan. Las guardas y filtros específicos de
 * cuotas dependen de `kind = LOAN_PAYMENT`, no del administrador.
 */
export class EngineRecurringDefinitionPort implements RecurringDefinitionPort {
  constructor(
    private readonly deps: CommitmentsDeps,
    private readonly definitions: DefinitionsService,
  ) {}

  private async clockOf(workspaceId: string): Promise<{ today: LocalDate; at: string }> {
    const calendar = await this.deps.calendar.calendarOf(workspaceId);
    const now = this.deps.clock.now();
    return { today: LocalDate.ofInstant(now, calendar.timeZone), at: now.toString() };
  }

  /** Carga con `FOR UPDATE`; solo definiciones administradas (las de usuario no se operan por este puerto). */
  private async locked(workspaceId: string, definitionId: string): Promise<RecurringDefinition> {
    const def = await this.deps.definitions.findById(workspaceId, definitionId, { lock: 'update' });
    const managedBy = def?.snapshot.managedBy;
    if (!def || managedBy === undefined || !(MANAGERS as readonly string[]).includes(managedBy)) {
      throw new DomainError('RESOURCE_NOT_FOUND', `managed recurring definition ${definitionId} not found`);
    }
    return def;
  }

  // ───────────────────────────────────────────────────────────── N1/N3: crear

  async createManaged(
    input: Parameters<RecurringDefinitionPort['createManaged']>[0],
  ): Promise<{ readonly definitionId: string }> {
    if (input.materialization !== 'NOTIFY_ONLY') {
      throw new DomainError(
        'RECURRING_MODE_NOT_ALLOWED',
        'an explicit schedule only supports NOTIFY_ONLY',
      ).at('/materialization');
    }
    const dates = input.explicitSchedule.map((i) => i.dueDate).sort();
    const startDate = dates[0];
    if (startDate === undefined) {
      throw new DomainError('RECURRING_INVALID_SCHEDULE', 'the schedule needs at least one item').at(
        '/explicitSchedule',
      );
    }
    // La moneda del calendario es la de la cuenta de pago.
    await this.deps.accounts.assertCanPost({
      workspaceId: input.workspaceId,
      accounts: [{ accountId: input.accountId, currency: input.currency }],
    });
    const created = await this.definitions.create({
      workspaceId: input.workspaceId,
      userId: input.userId,
      name: input.name,
      kind: input.kind,
      managedBy: input.managedBy,
      managedRef: input.managedRef,
      template: {
        accountId: input.accountId,
        counterpartyId: input.counterpartyId ?? null,
        amount: { type: 'VARIABLE' },
        schedule: {
          cadence: 'EXPLICIT',
          startDate,
          explicit: input.explicitSchedule.map((i) => ({ key: i.key, dueDate: i.dueDate, amount: i.amount })),
        },
        materialization: { mode: 'NOTIFY_ONLY', leadDays: 3 },
      },
    });
    return { definitionId: created.id };
  }

  // ───────────────────────────────────────────────────────────── ocurrencias por clave

  /** Ítems del calendario por clave: gana la versión más reciente que contiene la clave. */
  private itemsByKey(def: RecurringDefinition): Map<string, ExplicitScheduleItem> {
    const out = new Map<string, ExplicitScheduleItem>();
    for (const v of [...def.versions].sort((a, b) => a.versionNo - b.versionNo)) {
      for (const item of explicitItemsOf(v.schedule)) out.set(item.key, item);
    }
    return out;
  }

  /**
   * Ocurrencias de las claves (N5): las que existen y las que aún no están dentro del horizonte se generan ahora con el
   * calendario (fecha nominal = vencimiento del ítem, INV-013) y se anuncian como cualquier generación.
   */
  private async ensure(
    def: RecurringDefinition,
    keys: readonly string[],
    userId: string,
    at: string,
  ): Promise<Map<string, RecurringOccurrence>> {
    const { deps } = this;
    const items = this.itemsByKey(def);
    for (const key of keys) {
      if (!items.has(key)) {
        throw new DomainError('RESOURCE_NOT_FOUND', `the schedule has no item ${key}`).at('/keys');
      }
    }
    const existing = await deps.occurrences.listForDefinition(def.workspaceId, def.id);
    const byKey = new Map<string, RecurringOccurrence>();
    for (const o of existing) {
      const key = o.snapshot.scheduleKey;
      if (key !== null) byKey.set(key, o);
    }
    const missing = keys.filter((k) => !byKey.has(k));
    if (missing.length === 0) return byKey;
    const rows = missing.map((key) => {
      const item = items.get(key) as ExplicitScheduleItem;
      const date = LocalDate.parse(item.dueDate);
      const version = def.versionAt(date);
      return RecurringOccurrence.generate({
        id: deps.ids.next(),
        workspaceId: def.workspaceId,
        definitionId: def.id,
        occurrenceDate: item.dueDate,
        dueDate: item.dueDate,
        definitionVersionNo: version.versionNo,
        // El monto del ítem ya está normalizado a la escala de la moneda al crear la versión.
        expected: { type: 'FIXED', amount: item.amount, min: null, max: null },
        currency: version.currency,
        at,
        scheduleKey: key,
        sharesTransaction: def.kind === 'LOAN_PAYMENT',
      });
    });
    const inserted = await deps.occurrences.insertIfAbsent(rows);
    if (inserted.length !== rows.length) {
      throw new DomainError('CONCURRENCY_CONFLICT', 'a schedule occurrence already exists for that date');
    }
    def.touch(at, userId);
    const dv = def.snapshot;
    const dates = inserted.map((o) => o.occurrenceDate).sort();
    const payload: OccurrencesGeneratedV1 = {
      workspaceId: dv.workspaceId,
      definitionId: dv.id,
      definitionVersionNo: dv.currentVersionNo,
      window: { from: dates[0] as string, to: dates.at(-1) as string },
      occurrences: inserted.map((o) => {
        const s = o.snapshot;
        return {
          occurrenceId: s.id,
          occurrenceDate: s.occurrenceDate,
          dueDate: s.dueDate,
          expected: {
            type: s.expected.type,
            amount: s.expected.amount,
            min: s.expected.min,
            max: s.expected.max,
          },
          currency: s.currency,
          kind: dv.kind as RecurringKindDto,
        };
      }) as OccurrencesGeneratedV1['occurrences'],
    };
    const event = await publishEvent(
      deps,
      {
        workspaceId: dv.workspaceId,
        aggregateType: DEFINITION_AGGREGATE,
        aggregateId: dv.id,
        aggregateVersion: dv.version,
      },
      COMMITMENTS_EVENTS.occurrencesGenerated,
      payload,
    );
    if (!(await deps.definitions.save(def))) {
      throw new DomainError('CONCURRENCY_CONFLICT', `definition ${def.id} changed concurrently`);
    }
    await recordOccurrences(
      deps,
      inserted.map((o) => ({
        entry: occurrenceEntry(o, 'generated', occurrenceChanges(null, o.snapshot)),
        steps: occurrenceSteps(o, [event]),
      })),
    );
    for (const o of inserted) {
      const key = o.snapshot.scheduleKey;
      if (key !== null) byKey.set(key, o);
    }
    return byKey;
  }

  private async currencyOf(workspaceId: string, code: string): Promise<Currency> {
    const catalog = await this.deps.rates.workspaceCurrencies(workspaceId);
    const found = catalog.find((c) => c.code === code);
    if (!found) throw new DomainError('CURRENCY_NOT_ENABLED', `currency ${code} is not in the catalog`);
    return makeCurrency(found.code, found.scale);
  }

  private async persist(occ: RecurringOccurrence): Promise<void> {
    if (!(await this.deps.occurrences.save(occ))) {
      throw new DomainError('CONCURRENCY_CONFLICT', `occurrence ${occ.id} changed concurrently`);
    }
  }

  private async publishChanged(
    def: RecurringDefinition,
    occ: RecurringOccurrence,
    transition: string,
    releasedTransactionId: string | null,
  ) {
    const after = occ.snapshot;
    return publishEvent(
      this.deps,
      {
        workspaceId: after.workspaceId,
        aggregateType: OCCURRENCE_AGGREGATE,
        aggregateId: after.id,
        aggregateVersion: after.version,
      },
      COMMITMENTS_EVENTS.occurrenceChanged,
      {
        workspaceId: after.workspaceId,
        occurrenceId: after.id,
        definitionId: after.definitionId,
        managedBy: def.snapshot.managedBy,
        transition,
        status: after.status,
        dueDate: after.dueDate,
        expected: expectedOf(occ),
        currency: after.currency,
        releasedTransactionId,
        reason: null,
      },
    );
  }

  // ───────────────────────────────────────────────────────────── N5: resolver

  async settle(input: Parameters<RecurringDefinitionPort['settle']>[0]): Promise<void> {
    const { deps } = this;
    const { workspaceId } = input;
    const keys = [...new Set(input.keys)];
    if (keys.length === 0) return;
    const { at } = await this.clockOf(workspaceId);
    await deps.uow.run(workspaceId, async () => {
      const def = await this.locked(workspaceId, input.definitionId);
      const txn = await deps.links.getForLink({ workspaceId, transactionId: input.transactionId });
      if (!txn) throw new DomainError('REFERENCE_NOT_FOUND', 'transaction not found').at('/transactionId');
      if (txn.status === 'VOIDED') {
        throw new DomainError('OCCURRENCE_LINK_MISMATCH', 'the transaction is voided', {
          details: { reasons: ['VOIDED'] },
        }).at('/transactionId');
      }
      if (txn.amount.currency !== def.current.currency) {
        throw new DomainError('CURRENCY_MISMATCH', `the payment must be in ${def.current.currency}`).at(
          '/transactionId',
        );
      }
      // Una transacción puede resolver varias ocurrencias de la MISMA definición (1:N solo para LOAN_PAYMENT).
      const taken = await deps.occurrences.findByTransaction(workspaceId, input.transactionId);
      if (taken && (taken.snapshot.definitionId !== def.id || !taken.snapshot.sharesTransaction)) {
        throw new DomainError(
          'TRANSACTION_ALREADY_LINKED',
          'the transaction already resolves another occurrence',
        ).at('/transactionId');
      }
      const occurrences = await this.ensure(def, keys, input.userId, at);
      const items: Parameters<typeof recordOccurrences>[1][number][] = [];
      for (const key of keys) {
        const occ = occurrences.get(key) as RecurringOccurrence;
        if (occ.snapshot.transactionId === input.transactionId && !occ.unresolved) continue;
        const before = occ.snapshot;
        occ.settle({ transactionId: input.transactionId, at, by: input.userId });
        await this.persist(occ);
        const after = occ.snapshot;
        const payload: RecurringOccurrenceMaterializedV1 = {
          workspaceId,
          occurrenceId: after.id,
          definitionId: def.id,
          occurrenceDate: after.occurrenceDate,
          managedBy: def.snapshot.managedBy,
          transactionId: input.transactionId,
          mode: 'MATCHED',
          matchedBy: null,
          amount: txn.amount as MoneyDto,
          businessDate: txn.businessDate,
        };
        const event = await publishEvent(
          deps,
          {
            workspaceId,
            aggregateType: OCCURRENCE_AGGREGATE,
            aggregateId: after.id,
            aggregateVersion: after.version,
          },
          COMMITMENTS_EVENTS.occurrenceMaterialized,
          payload,
        );
        items.push({
          entry: occurrenceEntry(occ, 'matched', [
            ...occurrenceChanges(before, after),
            { field: 'amount', before: null, after: txn.amount },
            { field: 'businessDate', before: null, after: txn.businessDate },
          ]),
          steps: occurrenceSteps(occ, [event], { detailRefs: { transactionId: input.transactionId } }),
        });
      }
      await recordOccurrences(deps, items);
    });
  }

  // ───────────────────────────────────────────────────────────── N6: devolver y ajustar

  async unsettle(input: Parameters<RecurringDefinitionPort['unsettle']>[0]): Promise<void> {
    const { deps } = this;
    const { workspaceId } = input;
    const keys = [...new Set(input.keys)];
    if (keys.length === 0) return;
    const { today, at } = await this.clockOf(workspaceId);
    await deps.uow.run(workspaceId, async () => {
      const def = await this.locked(workspaceId, input.definitionId);
      const items = this.itemsByKey(def);
      const occurrences = await this.ensure(def, keys, input.userId, at);
      const restore = new Map((input.restoreExpected ?? []).map((r) => [r.key, r.amount] as const));
      const recorded: Parameters<typeof recordOccurrences>[1][number][] = [];
      for (const key of keys) {
        const occ = occurrences.get(key) as RecurringOccurrence;
        const state = occ.snapshot;
        if (state.status !== 'MATERIALIZED' && state.status !== 'MATCHED') continue;
        const original = (items.get(key) as ExplicitScheduleItem).amount;
        const requested = restore.get(key);
        const amount = requested ?? original;
        const version = def.versionNo(state.definitionVersionNo);
        const spec = buildAmountSpec(
          { type: 'FIXED', amount },
          await this.currencyOf(workspaceId, state.currency),
          '/restoreExpected',
        );
        const before = state;
        const released = occ.unsettle({
          today,
          leadDays: version.materialization.leadDays,
          expected: spec,
          overridden: requested !== undefined && requested !== original,
        });
        await this.persist(occ);
        const event = await this.publishChanged(def, occ, 'RELEASE', released);
        recorded.push({
          entry: occurrenceEntry(occ, 'released', occurrenceChanges(before, occ.snapshot)),
          steps: occurrenceSteps(occ, [event], { detailRefs: { releasedTransactionId: released } }),
        });
      }
      await recordOccurrences(deps, recorded);
    });
  }

  async setExpected(input: Parameters<RecurringDefinitionPort['setExpected']>[0]): Promise<void> {
    const { deps } = this;
    const { workspaceId } = input;
    const { at } = await this.clockOf(workspaceId);
    await deps.uow.run(workspaceId, async () => {
      const def = await this.locked(workspaceId, input.definitionId);
      const occurrences = await this.ensure(def, [input.key], input.userId, at);
      const occ = occurrences.get(input.key) as RecurringOccurrence;
      const before = occ.snapshot;
      const spec = buildAmountSpec(
        { type: 'FIXED', amount: input.amount },
        await this.currencyOf(workspaceId, before.currency),
        '/amount',
      );
      occ.edit({ expected: spec });
      if (occ.changedFields.length === 0) return;
      await this.persist(occ);
      const event = await this.publishChanged(def, occ, 'EDIT', null);
      await deps.lifecycle.record(
        occurrenceEntry(occ, 'updated', occurrenceChanges(before, occ.snapshot)),
        occurrenceSteps(occ, [event]),
      );
    });
  }

  // ───────────────────────────────────────────────────────────── N9: terminar

  async end(input: Parameters<RecurringDefinitionPort['end']>[0]): Promise<void> {
    const { deps } = this;
    const { workspaceId } = input;
    let from: LocalDate;
    try {
      from = LocalDate.parse(input.from);
    } catch {
      throw new DomainError('VALIDATION_FAILED', 'from must be YYYY-MM-DD').at('/from');
    }
    await deps.uow.run(workspaceId, async () => {
      const def = await this.locked(workspaceId, input.definitionId);
      if (def.status === 'ENDED') return;
      // Cancela las no resueltas con vencimiento >= from: la serie cierra el día anterior.
      await this.definitions.end({
        workspaceId,
        userId: input.userId,
        definitionId: input.definitionId,
        expectedVersion: def.version,
        manager: def.snapshot.managedBy as Manager,
        endDate: from.plusDays(-1).toString(),
        closeNow: true,
      });
    });
  }

  // ───────────────────────────────────────────────────────────── revisar plantilla

  async revise(input: Parameters<RecurringDefinitionPort['revise']>[0]): Promise<void> {
    const { deps } = this;
    const { workspaceId } = input;
    await deps.uow.run(workspaceId, async () => {
      let def = await this.locked(workspaceId, input.definitionId);
      const manager = def.snapshot.managedBy as Manager;
      if (input.name !== undefined && input.name !== def.name) {
        await this.definitions.updateDetails({
          workspaceId,
          userId: input.userId,
          definitionId: def.id,
          expectedVersion: def.version,
          name: input.name,
          manager,
        });
        def = await this.locked(workspaceId, input.definitionId);
      }
      const cur = def.current;
      const changes: { accountId?: string; counterpartyId?: string | null } = {};
      if (input.accountId !== undefined && input.accountId !== cur.accountId)
        changes.accountId = input.accountId;
      if (input.counterpartyId !== undefined && input.counterpartyId !== cur.counterpartyId) {
        changes.counterpartyId = input.counterpartyId;
      }
      if (Object.keys(changes).length === 0) return;
      if (changes.accountId) {
        await deps.accounts.assertCanPost({
          workspaceId,
          accounts: [{ accountId: changes.accountId, currency: cur.currency }],
        });
      }
      // La fecha efectiva se adelanta hasta después de la última ocurrencia resuelta y de la versión vigente.
      const lastResolved = await deps.occurrences.lastResolvedNominal(workspaceId, def.id);
      const options = [input.effectiveFrom, cur.effectiveFrom];
      if (lastResolved !== null) options.push(LocalDate.parse(lastResolved).plusDays(1).toString());
      const effectiveFrom = options.sort().at(-1) as string;
      // La revisión reescribe las no resueltas desde la fecha (descarta ediciones): se restituye el monto ajustado
      // por un pago parcial (N6).
      const adjusted = (
        await deps.occurrences.listForDefinition(workspaceId, def.id, { from: effectiveFrom })
      )
        .filter((o) => o.unresolved && o.snapshot.amountOverridden)
        .map((o) => ({ id: o.id, expected: o.snapshot.expected }));
      await this.definitions.revise({
        workspaceId,
        userId: input.userId,
        definitionId: def.id,
        expectedVersion: def.version,
        effectiveFrom,
        changes: changes as TemplateChanges,
        manager,
      });
      for (const a of adjusted) {
        const occ = await deps.occurrences.findById(workspaceId, a.id, { lock: 'update' });
        if (!occ || !occ.unresolved) continue;
        const before = occ.snapshot;
        occ.edit({ expected: a.expected });
        if (occ.changedFields.length === 0) continue;
        await this.persist(occ);
        const event = await this.publishChanged(def, occ, 'EDIT', null);
        await deps.lifecycle.record(
          occurrenceEntry(occ, 'updated', occurrenceChanges(before, occ.snapshot)),
          occurrenceSteps(occ, [event]),
        );
      }
    });
  }
}
