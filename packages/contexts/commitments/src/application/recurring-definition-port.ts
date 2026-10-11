import { DomainError, LocalDate, currency as makeCurrency, type Currency } from '@pf/shared-kernel';
import {
  COMMITMENTS_EVENTS,
  type CreateManagedMonthlyInput,
  type ManagedOccurrenceDto,
  type MoneyDto,
  type OccurrencesGeneratedV1,
  type RecurringDefinitionPort,
  type RecurringKindDto,
  type RecurringOccurrenceMaterializedV1,
} from '../contracts/index.js';
import {
  RecurringOccurrence,
  buildAmountSpec,
  candidates,
  explicitItemsOf,
  type AmountSpec,
  type ExplicitScheduleItem,
  type RecurringDefinition,
} from '../domain/index.js';
import type { DefinitionsService, TemplateChanges } from './definitions.service.js';
import { generateOccurrences } from './generation.js';
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

/** Cadencia de una regla mensual: un día ⇒ `MONTHLY`, dos ⇒ `SEMIMONTHLY` (cualquier otra cantidad se rechaza). */
function monthlySchedule(
  monthDays: readonly number[],
  pointer: string,
): { cadence: 'MONTHLY' | 'SEMIMONTHLY'; monthDays: readonly number[] } {
  const days = [...new Set(monthDays)];
  if (days.length < 1 || days.length > 2 || !days.every((d) => Number.isInteger(d) && d >= 1 && d <= 31)) {
    throw new DomainError(
      'RECURRING_INVALID_SCHEDULE',
      'a monthly rule needs one or two days of the month between 1 and 31',
    ).at(pointer);
  }
  return { cadence: days.length === 1 ? 'MONTHLY' : 'SEMIMONTHLY', monthDays: days };
}

/** Modo de materialización de la regla: el estado de `AUTO_CREATE` solo aplica a ese modo (`PENDING` por omisión). */
function materializationOf(input: CreateManagedMonthlyInput['materialization'], fallbackLeadDays?: number) {
  return {
    mode: input.mode,
    autoCreateStatus: input.mode === 'AUTO_CREATE' ? (input.autoCreateStatus ?? 'PENDING') : null,
    ...(input.leadDays !== undefined
      ? { leadDays: input.leadDays }
      : fallbackLeadDays !== undefined
        ? { leadDays: fallbackLeadDays }
        : {}),
  };
}

const NOMINAL_KEY = /^\d{4}-\d{2}-\d{2}$/;

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
    if ('monthlyRule' in input) return this.createMonthly(input);
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

  /**
   * Regla mensual (add-credit-cards, decisión 7): `CARD_PAYMENT` de `accountId` a `toAccountId`, de monto `VARIABLE`
   * hasta que el administrador fije el esperado. La clave de cada ocurrencia es su fecha nominal.
   */
  private async createMonthly(input: CreateManagedMonthlyInput): Promise<{ readonly definitionId: string }> {
    const rule = input.monthlyRule;
    const schedule = monthlySchedule(rule.monthDays, '/monthlyRule/monthDays');
    // La moneda de la regla es la de la cuenta de pago (la de la tarjeta se valida como transferencia de una moneda).
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
        toAccountId: input.toAccountId,
        counterpartyId: input.counterpartyId ?? null,
        amount: { type: 'VARIABLE' },
        schedule: { ...schedule, startDate: rule.startDate, weekendAdjustment: rule.weekendAdjustment },
        materialization: materializationOf(input.materialization),
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
    // Definición regida por una regla (CARD_PAYMENT): la clave es la fecha nominal.
    if (def.current.schedule.cadence !== 'EXPLICIT') return this.ensureNominal(def, keys, userId, at);
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

  /**
   * Ocurrencias de una definición con regla, por fecha nominal. Las que ya existen se usan tal cual; una fecha futura
   * que la regla produce y el horizonte aún no generó se genera ahora (INV-013: única por fecha nominal). Una fecha que
   * la regla no produce, o que quedó atrás sin ocurrencia (anterior a la primera ventana), es `RESOURCE_NOT_FOUND`.
   */
  private async ensureNominal(
    def: RecurringDefinition,
    keys: readonly string[],
    userId: string,
    at: string,
  ): Promise<Map<string, RecurringOccurrence>> {
    const { deps } = this;
    for (const key of keys) {
      if (!NOMINAL_KEY.test(key)) {
        throw new DomainError(
          'VALIDATION_FAILED',
          'the key of a rule-based definition is its nominal date',
        ).at('/key');
      }
    }
    const existing = await deps.occurrences.listForDefinition(def.workspaceId, def.id);
    const byKey = new Map(existing.map((o) => [o.occurrenceDate, o] as const));
    const missing = keys.filter((k) => !byKey.has(k));
    if (missing.length === 0) return byKey;
    const through = def.snapshot.generatedThrough;
    const rows = missing.map((key) => {
      const date = LocalDate.parse(key);
      const candidate =
        def.status === 'ACTIVE' && (through === null || key > through)
          ? candidates(def, { from: date, to: date })[0]
          : undefined;
      if (!candidate)
        throw new DomainError('RESOURCE_NOT_FOUND', `the rule has no occurrence on ${key}`).at('/key');
      return RecurringOccurrence.generate({
        id: deps.ids.next(),
        workspaceId: def.workspaceId,
        definitionId: def.id,
        occurrenceDate: candidate.occurrenceDate.toString(),
        dueDate: candidate.dueDate.toString(),
        definitionVersionNo: candidate.versionNo,
        expected: candidate.expected,
        currency: candidate.currency,
        at,
      });
    });
    const inserted = await deps.occurrences.insertIfAbsent(rows);
    if (inserted.length !== rows.length) {
      throw new DomainError('CONCURRENCY_CONFLICT', 'an occurrence already exists for that date');
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
    for (const o of inserted) byKey.set(o.occurrenceDate, o);
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
    reason: string | null = null,
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
        reason,
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

  /**
   * `amount` (legado de préstamos): monto exacto de una cuota; marca la ocurrencia como ajustada y rechaza una ya
   * resuelta. `expectation` (add-credit-cards): `FIXED`, `ESTIMATED` o `NONE` fijado por el administrador; no marca la
   * ocurrencia como editada por el usuario y una ocurrencia resuelta (o cancelada) no cambia, sin error ni hecho.
   */
  async setExpected(input: Parameters<RecurringDefinitionPort['setExpected']>[0]): Promise<void> {
    const { deps } = this;
    const { workspaceId } = input;
    if ((input.amount === undefined) === (input.expectation === undefined)) {
      throw new DomainError('VALIDATION_FAILED', 'give either amount or expectation').at('/expectation');
    }
    const { at } = await this.clockOf(workspaceId);
    await deps.uow.run(workspaceId, async () => {
      const def = await this.locked(workspaceId, input.definitionId);
      const occurrences = await this.ensure(def, [input.key], input.userId, at);
      const occ = occurrences.get(input.key) as RecurringOccurrence;
      const before = occ.snapshot;
      const currency = await this.currencyOf(workspaceId, before.currency);
      let spec: AmountSpec;
      if (input.expectation !== undefined) {
        const { type, amount } = input.expectation;
        if (type === 'NONE') {
          if (amount !== undefined) {
            throw new DomainError('RECURRING_INVALID_AMOUNT', 'an occurrence without amount takes none').at(
              '/expectation/amount',
            );
          }
          spec = buildAmountSpec({ type: 'VARIABLE' }, currency, '/expectation');
        } else if (type === 'FIXED' || type === 'ESTIMATED') {
          spec = buildAmountSpec({ type, amount }, currency, '/expectation');
        } else {
          throw new DomainError('RECURRING_INVALID_AMOUNT', `unknown expectation type ${String(type)}`).at(
            '/expectation/type',
          );
        }
        if (!occ.unresolved) return;
        occ.edit({ expected: spec }, { byManager: true });
      } else {
        spec = buildAmountSpec({ type: 'FIXED', amount: input.amount }, currency, '/amount');
        occ.edit({ expected: spec });
      }
      if (occ.changedFields.length === 0) return;
      await this.persist(occ);
      const event = await this.publishChanged(def, occ, 'EDIT', null);
      await deps.lifecycle.record(
        occurrenceEntry(occ, 'updated', occurrenceChanges(before, occ.snapshot)),
        occurrenceSteps(occ, [event]),
      );
    });
  }

  /** Omite una ocurrencia no resuelta con un motivo (conserva su fecha nominal); una resuelta no cambia. */
  async skip(input: Parameters<RecurringDefinitionPort['skip']>[0]): Promise<void> {
    const { deps } = this;
    const { workspaceId } = input;
    const reason = input.reason.trim();
    if (reason === '') throw new DomainError('VALIDATION_FAILED', 'a reason is required').at('/reason');
    const { at } = await this.clockOf(workspaceId);
    await deps.uow.run(workspaceId, async () => {
      const def = await this.locked(workspaceId, input.definitionId);
      const occurrences = await this.ensure(def, [input.key], input.userId, at);
      const occ = occurrences.get(input.key) as RecurringOccurrence;
      if (!occ.unresolved) return;
      const before = occ.snapshot;
      occ.skip({ reason, at, by: input.userId });
      await this.persist(occ);
      const expired = await deps.matching.expireForOccurrences(workspaceId, [occ.id], 'OCCURRENCE_RESOLVED');
      deps.metrics?.increment('commitments_match_suggestions_total', { outcome: 'expired' }, expired.length);
      const after = occ.snapshot;
      const event = await this.publishChanged(def, occ, 'SKIP', null, after.skipReason);
      await deps.lifecycle.record(
        occurrenceEntry(occ, 'skipped', occurrenceChanges(before, after), { reason: after.skipReason }),
        occurrenceSteps(occ, [event], { reason: after.skipReason }),
      );
    });
  }

  /**
   * Ocurrencias con fecha nominal en `[from, to]`. En una definición con regla activa genera antes las del horizonte
   * que aún falten, así el administrador ve (y puede fijar) las próximas sin esperar al job.
   */
  async listOccurrences(
    input: Parameters<RecurringDefinitionPort['listOccurrences']>[0],
  ): Promise<readonly ManagedOccurrenceDto[]> {
    const { deps } = this;
    const { workspaceId } = input;
    const { today } = await this.clockOf(workspaceId);
    return deps.uow.run(workspaceId, async () => {
      const def = await this.locked(workspaceId, input.definitionId);
      if (def.status === 'ACTIVE' && def.current.schedule.cadence !== 'EXPLICIT') {
        const throughBefore = def.snapshot.generatedThrough;
        const generated = await generateOccurrences(deps, def, { today, by: null });
        if (generated.inserted.length > 0 || def.snapshot.generatedThrough !== throughBefore) {
          if (!(await deps.definitions.save(def))) {
            throw new DomainError('CONCURRENCY_CONFLICT', `definition ${def.id} changed concurrently`);
          }
        }
      }
      const rows = await deps.occurrences.listForDefinition(workspaceId, def.id, { from: input.from });
      return rows
        .filter((o) => o.occurrenceDate <= input.to)
        .map((o): ManagedOccurrenceDto => {
          const s = o.snapshot;
          return {
            occurrenceId: s.id,
            key: s.scheduleKey ?? s.occurrenceDate,
            occurrenceDate: s.occurrenceDate,
            dueDate: s.dueDate,
            status: s.status,
            expected: { ...expectedOf(o), currency: s.currency },
            transactionId: s.transactionId,
            editedByUser: s.amountOverridden,
            skipReason: s.skipReason,
          };
        });
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
      const changes: {
        accountId?: string;
        counterpartyId?: string | null;
        schedule?: { cadence?: string; monthDays?: readonly number[]; weekendAdjustment?: string };
        materialization?: {
          mode: string;
          autoCreateStatus: string | null;
          leadDays?: number;
        };
      } = {};
      if (input.accountId !== undefined && input.accountId !== cur.accountId)
        changes.accountId = input.accountId;
      if (input.counterpartyId !== undefined && input.counterpartyId !== cur.counterpartyId) {
        changes.counterpartyId = input.counterpartyId;
      }
      // Regla mensual (add-credit-cards): días del mes, ajuste de fin de semana y modo de materialización.
      if (input.monthDays !== undefined) {
        const rule = monthlySchedule(input.monthDays, '/monthDays');
        const same =
          rule.cadence === cur.schedule.cadence &&
          rule.monthDays.length === cur.schedule.monthDays.length &&
          rule.monthDays.every((d) => cur.schedule.monthDays.includes(d));
        if (!same) changes.schedule = { cadence: rule.cadence, monthDays: rule.monthDays };
      }
      if (
        input.weekendAdjustment !== undefined &&
        input.weekendAdjustment !== cur.schedule.weekendAdjustment
      ) {
        changes.schedule = { ...changes.schedule, weekendAdjustment: input.weekendAdjustment };
      }
      if (input.materialization !== undefined) {
        const next = materializationOf(input.materialization, cur.materialization.leadDays);
        if (
          next.mode !== cur.materialization.mode ||
          next.autoCreateStatus !== cur.materialization.autoCreateStatus ||
          next.leadDays !== cur.materialization.leadDays
        ) {
          changes.materialization = next;
        }
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
