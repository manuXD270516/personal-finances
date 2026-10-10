import { DomainError } from '@pf/shared-kernel';
import {
  Subscription,
  type PriceChangeProposal,
  type PriceEntry,
  type SubscriptionCharge,
  type SubscriptionState,
} from '../../domain/index.js';
import { DefinitionsService } from '../definitions.service.js';
import { EngineManagedDefinitions } from '../managed-definitions.js';
import type {
  ChargeRepository,
  CounterpartyNames,
  ProposalRepository,
  ReminderRepository,
  SubscriptionListRow,
  SubscriptionRepository,
  SubscriptionsDeps,
} from '../ports/subscriptions.js';
import { InMemoryCommitments } from './in-memory.js';

export const STREAMLY = '0190a000-0000-7000-8000-0000000c0001';
export const MUSICBOX = '0190a000-0000-7000-8000-0000000c0002';
export const CLOUDDRIVE = '0190a000-0000-7000-8000-0000000c0003';
export const VPN_PRO = '0190a000-0000-7000-8000-0000000c0004';
export const GYM = '0190a000-0000-7000-8000-0000000c0005';
export const OLDTV = '0190a000-0000-7000-8000-0000000c0006';
export const PHOTOLAB = '0190a000-0000-7000-8000-0000000c0007';
export const DIARIO = '0190a000-0000-7000-8000-0000000c0008';

interface StoredSubscription {
  state: SubscriptionState;
  prices: PriceEntry[];
}

/** Dobles en memoria de COMMITMENTS + SUBSCRIPTIONS (misma semántica que las tablas: estados persistidos). */
export class InMemorySubscriptions extends InMemoryCommitments {
  readonly counterparties = new Map<string, { name: string; archived: boolean }>([
    [STREAMLY, { name: 'Streamly', archived: false }],
    [MUSICBOX, { name: 'MusicBox', archived: false }],
    [CLOUDDRIVE, { name: 'CloudDrive', archived: false }],
    [VPN_PRO, { name: 'VPN Pro', archived: false }],
    [GYM, { name: 'Gimnasio Centro', archived: false }],
    [OLDTV, { name: 'OldTV', archived: true }],
    [PHOTOLAB, { name: 'PhotoLab', archived: false }],
    [DIARIO, { name: 'Diario Digital', archived: false }],
  ]);
  protected subs = new Map<string, StoredSubscription>();
  protected proposalList: PriceChangeProposal[] = [];
  protected chargeList: SubscriptionCharge[] = [];
  readonly reminderKeys = new Set<string>();
  /** Instante en que se emitió cada recordatorio (para pruebas de idempotencia). */
  readonly reminderLog: { subscriptionId: string; kind: string; targetDate: string }[] = [];

  override readonly classification = {
    validate: async (input: {
      categoryIds?: readonly { categoryId: string; splitKind: string }[];
      counterpartyId?: string | null;
    }) => {
      for (const ref of input.categoryIds ?? []) {
        if (this.archivedCategories.has(ref.categoryId)) {
          throw new DomainError('CATEGORY_ARCHIVED', 'the category is archived').at('/categoryId');
        }
      }
      if (input.counterpartyId) {
        const found = this.counterparties.get(input.counterpartyId);
        if (!found) throw new DomainError('REFERENCE_NOT_FOUND', 'counterparty not found');
        if (found.archived) throw new DomainError('COUNTERPARTY_ARCHIVED', 'the counterparty is archived');
      }
    },
    validateCustomFieldValues: async () => [],
  };

  constructor() {
    super();
    // Las unidades de trabajo que fallan revierten también el estado de las suscripciones.
    this.extensions.push(() => {
      const subs = new Map<string, StoredSubscription>(
        [...this.subs].map(([k, v]) => [k, { state: v.state, prices: [...v.prices] }]),
      );
      const proposals = [...this.proposalList];
      const charges = [...this.chargeList];
      const reminders = new Set(this.reminderKeys);
      const reminderLog = [...this.reminderLog];
      return () => {
        this.subs = subs;
        this.proposalList = proposals;
        this.chargeList = charges;
        this.reminderKeys.clear();
        for (const k of reminders) this.reminderKeys.add(k);
        this.reminderLog.length = 0;
        this.reminderLog.push(...reminderLog);
      };
    });
  }

  readonly counterpartyNames: CounterpartyNames = {
    namesOf: async ({ counterpartyIds }) =>
      new Map(
        counterpartyIds
          .map((id) => [id, this.counterparties.get(id)?.name] as const)
          .filter((e): e is readonly [string, string] => e[1] !== undefined),
      ),
  };

  readonly subscriptionRepo: SubscriptionRepository = {
    insert: async (sub) => {
      this.subs.set(sub.id, { state: sub.snapshot, prices: [...sub.addedPrices] });
      sub.markPersisted();
    },
    findById: async (workspaceId, id) => this.hydrate(this.subs.get(id), workspaceId),
    findByDefinition: async (workspaceId, definitionId) =>
      this.hydrate(
        [...this.subs.values()].find((s) => s.state.definitionId === definitionId),
        workspaceId,
      ),
    save: async (sub) => {
      const row = this.subs.get(sub.id);
      if (!row || row.state.version !== sub.persistedVersion) return false;
      row.state = sub.snapshot;
      row.prices.push(...sub.addedPrices);
      sub.markPersisted();
      return true;
    },
    updateNextRenewal: async (_ws, id, on) => {
      const row = this.subs.get(id);
      if (row) row.state = { ...row.state, nextRenewalOn: on };
    },
    list: async (workspaceId, filter) => {
      const rows: SubscriptionListRow[] = [];
      for (const row of this.subs.values()) {
        const s = row.state;
        if (s.workspaceId !== workspaceId) continue;
        if (filter.statuses ? !filter.statuses.includes(s.status) : s.status === 'CANCELLED') continue;
        if (filter.counterpartyId && s.counterpartyId !== filter.counterpartyId) continue;
        const def = this.definitionsMap.get(s.definitionId);
        if (!def) continue;
        const v = def.versions.find((x) => x.versionNo === def.state.currentVersionNo);
        if (!v) continue;
        if (filter.paymentAccountId && v.accountId !== filter.paymentAccountId) continue;
        rows.push({
          subscription: Subscription.restore(s, row.prices),
          paymentAccountId: v.accountId,
          accountCurrency: v.currency,
          cadence: v.schedule.cadence,
          interval: v.schedule.interval,
          monthDays: v.schedule.monthDays,
          rrule: v.schedule.rrule,
        });
      }
      const key = (r: SubscriptionListRow) =>
        `${r.subscription.snapshot.nextRenewalOn ?? '9999-12-31'}|${r.subscription.id}`;
      rows.sort((a, b) => (key(a) < key(b) ? -1 : 1));
      return filter.limit ? rows.slice(0, filter.limit) : rows;
    },
    idsOpen: async (workspaceId) =>
      [...this.subs.values()]
        .filter((s) => s.state.workspaceId === workspaceId && s.state.status !== 'CANCELLED')
        .map((s) => s.state.id),
  };

  readonly proposalRepo: ProposalRepository = {
    insert: async (p) => {
      if (
        this.proposalList.some(
          (x) => x.subscriptionId === p.subscriptionId && x.effectiveFrom === p.effectiveFrom,
        )
      ) {
        throw new Error('duplicated proposal (subscription, effectiveFrom)');
      }
      if (
        p.status === 'PENDING' &&
        this.proposalList.some((x) => x.subscriptionId === p.subscriptionId && x.status === 'PENDING')
      ) {
        throw new Error('more than one pending proposal');
      }
      this.proposalList.push(p);
    },
    findById: async (_ws, subscriptionId, id) =>
      this.proposalList.find((p) => p.id === id && p.subscriptionId === subscriptionId) ?? null,
    listForSubscription: async (_ws, subscriptionId) =>
      this.proposalList.filter((p) => p.subscriptionId === subscriptionId),
    update: async (_ws, p) => {
      const i = this.proposalList.findIndex((x) => x.id === p.id);
      if (i < 0) throw new Error('no proposal');
      this.proposalList[i] = p;
    },
  };

  readonly chargeRepo: ChargeRepository = {
    insertIfAbsent: async (c) => {
      const taken = this.chargeList.some(
        (x) =>
          x.subscriptionId === c.subscriptionId &&
          x.occurrenceId === c.occurrenceId &&
          x.outcome !== 'VOIDED',
      );
      if (taken) return false;
      this.chargeList.push(c);
      return true;
    },
    findById: async (_ws, subscriptionId, id) =>
      this.chargeList.find((c) => c.id === id && c.subscriptionId === subscriptionId) ?? null,
    findActiveByOccurrence: async (_ws, subscriptionId, occurrenceId) =>
      this.chargeList.find(
        (c) =>
          c.subscriptionId === subscriptionId && c.occurrenceId === occurrenceId && c.outcome !== 'VOIDED',
      ) ?? null,
    list: async (_ws, subscriptionId, limit) =>
      this.chargeList
        .filter((c) => c.subscriptionId === subscriptionId && c.outcome !== 'VOIDED')
        .sort((a, b) => (a.occurrenceDate < b.occurrenceDate ? 1 : -1))
        .slice(0, limit),
    update: async (_ws, c) => {
      const i = this.chargeList.findIndex((x) => x.id === c.id);
      if (i < 0) throw new Error('no charge');
      this.chargeList[i] = c;
    },
  };

  readonly reminderRepo: ReminderRepository = {
    insertIfAbsent: async (input) => {
      const key = `${input.subscriptionId}|${input.kind}|${input.targetDate}`;
      if (this.reminderKeys.has(key)) return false;
      this.reminderKeys.add(key);
      this.reminderLog.push({
        subscriptionId: input.subscriptionId,
        kind: input.kind,
        targetDate: input.targetDate,
      });
      return true;
    },
  };

  subscriptionDeps(overrides: Partial<SubscriptionsDeps> = {}): SubscriptionsDeps {
    const base = this.deps();
    return {
      ...base,
      subscriptions: this.subscriptionRepo,
      proposals: this.proposalRepo,
      charges: this.chargeRepo,
      reminders: this.reminderRepo,
      managed: new EngineManagedDefinitions(base, new DefinitionsService(base)),
      counterpartyNames: this.counterpartyNames,
      ...overrides,
    };
  }

  // ─────────────────────────────────────────────── helpers de prueba

  subscription(id: string): SubscriptionState {
    const row = this.subs.get(id);
    if (!row) throw new Error(`no subscription ${id}`);
    return row.state;
  }

  pricesOf(id: string): readonly PriceEntry[] {
    return this.subs.get(id)?.prices ?? [];
  }

  proposalsOf(id: string): PriceChangeProposal[] {
    return this.proposalList.filter((p) => p.subscriptionId === id);
  }

  chargesOf(id: string): SubscriptionCharge[] {
    return this.chargeList.filter((c) => c.subscriptionId === id);
  }

  private hydrate(row: StoredSubscription | undefined, workspaceId: string): Subscription | null {
    if (!row || row.state.workspaceId !== workspaceId) return null;
    return Subscription.restore(row.state, row.prices);
  }
}
