import type {
  PriceChangeProposal,
  ProposalStatus,
  Subscription,
  SubscriptionCharge,
  SubscriptionStatus,
} from '../../domain/index.js';
import type { DefinitionDto } from '../views.js';
import type { CommitmentsDeps } from './index.js';
import type { MoneyDto } from '../../contracts/index.js';
import type { ApiTemplate, AmountInput } from '../template-resolver.js';
import type { TemplateChanges } from '../definitions.service.js';

/** Nombre del provider (contraparte) por id; incluye archivadas. Puerto de lectura de CLASSIFICATION. */
export interface CounterpartyNames {
  namesOf(input: {
    readonly workspaceId: string;
    readonly counterpartyIds: readonly string[];
  }): Promise<ReadonlyMap<string, string>>;
}

/** Fila de lista de suscripciones: la suscripción con los datos de su definición vigente. */
export interface SubscriptionListRow {
  readonly subscription: Subscription;
  readonly paymentAccountId: string;
  readonly accountCurrency: string;
  readonly cadence: string;
  readonly interval: number;
  readonly monthDays: readonly number[];
  readonly rrule: string | null;
}

export interface SubscriptionFilter {
  /** Sin estados ⇒ excluye las canceladas. */
  readonly statuses?: readonly SubscriptionStatus[] | undefined;
  readonly counterpartyId?: string | undefined;
  readonly paymentAccountId?: string | undefined;
  /** Posición del cursor (keyset): `[nextRenewalOn|'', id]` del último elemento de la página anterior. */
  readonly after?: readonly [string, string] | undefined;
  readonly limit?: number | undefined;
}

export interface SubscriptionRepository {
  /** Inserta la cabecera y sus entradas de precio nuevas (la definición ya existe: FK). */
  insert(subscription: Subscription): Promise<void>;
  /** `lock: 'update'` = `SELECT … FOR UPDATE` (serializa comandos, consumidor y job de la suscripción). */
  findById(
    workspaceId: string,
    id: string,
    options?: { readonly lock?: 'update' },
  ): Promise<Subscription | null>;
  findByDefinition(
    workspaceId: string,
    definitionId: string,
    options?: { readonly lock?: 'update' },
  ): Promise<Subscription | null>;
  /** Control optimista por `persistedVersion`; inserta las entradas de precio nuevas. `false` si cambió. */
  save(subscription: Subscription): Promise<boolean>;
  /** Proyección de la próxima renovación (no versiona el agregado). */
  updateNextRenewal(workspaceId: string, id: string, on: string | null): Promise<void>;
  list(workspaceId: string, filter: SubscriptionFilter): Promise<SubscriptionListRow[]>;
  /** Ids de las no canceladas (las procesa el job diario, cada una en su unidad de trabajo). */
  idsOpen(workspaceId: string): Promise<string[]>;
}

export interface ProposalRepository {
  insert(proposal: PriceChangeProposal): Promise<void>;
  findById(
    workspaceId: string,
    subscriptionId: string,
    id: string,
    options?: { readonly lock?: 'update' },
  ): Promise<PriceChangeProposal | null>;
  listForSubscription(workspaceId: string, subscriptionId: string): Promise<PriceChangeProposal[]>;
  /** Cambia estado (y, al revivir, el cargo y los montos); `decidedAt/By` solo al aceptar o rechazar. */
  update(
    workspaceId: string,
    proposal: PriceChangeProposal & { readonly status: ProposalStatus },
  ): Promise<void>;
}

export interface ChargeRepository {
  /** `INSERT … ON CONFLICT DO NOTHING` sobre el único parcial; `false` si ya había un cargo vigente de la ocurrencia. */
  insertIfAbsent(charge: SubscriptionCharge): Promise<boolean>;
  findById(workspaceId: string, subscriptionId: string, id: string): Promise<SubscriptionCharge | null>;
  findActiveByOccurrence(
    workspaceId: string,
    subscriptionId: string,
    occurrenceId: string,
  ): Promise<SubscriptionCharge | null>;
  /** Orden descendente por `[occurrenceDate, id]`; `after` = posición del último de la página anterior. */
  list(
    workspaceId: string,
    subscriptionId: string,
    limit: number,
    after?: readonly [string, string],
  ): Promise<SubscriptionCharge[]>;
  update(workspaceId: string, charge: SubscriptionCharge): Promise<void>;
}

export interface ReminderRepository {
  /** `true` si lo insertó (primera vez para la suscripción, el tipo y la fecha). */
  insertIfAbsent(input: {
    readonly workspaceId: string;
    readonly subscriptionId: string;
    readonly kind: 'RENEWAL' | 'TRIAL_END';
    readonly targetDate: string;
    readonly eventId: string;
    readonly emittedAt: string;
  }): Promise<boolean>;
}

/** Ocurrencia próxima de la definición administrada, para recordatorios y listas. */
export interface ManagedOccurrenceInfo {
  readonly occurrenceDate: string;
  readonly projected: MoneyDto | null;
}

/** Estado de la definición administrada que necesita la suscripción. */
export interface ManagedDefinitionInfo {
  readonly definitionId: string;
  readonly status: 'ACTIVE' | 'PAUSED' | 'ENDED';
  readonly version: number;
  readonly endDate: string | null;
  readonly accountId: string;
  readonly accountCurrency: string;
  readonly categoryId: string | null;
  readonly cadence: string;
  readonly interval: number;
  readonly monthDays: readonly number[];
  readonly rrule: string | null;
  readonly startDate: string;
  readonly materialization: {
    readonly mode: string;
    readonly autoCreateStatus: string | null;
    readonly leadDays: number;
  };
  readonly indexed: boolean;
  readonly currentEffectiveFrom: string;
}

/**
 * Operaciones que la suscripción necesita del motor de recurrencia sobre SU definición (`managedBy = SUBSCRIPTION`),
 * dentro de la unidad de trabajo del llamador (openspec add-subscriptions § Dependencias N1–N12). Es la
 * implementación del `RecurringDefinitionPort` reservado por `add-recurrence-engine`.
 */
export interface ManagedDefinitionPort {
  create(input: {
    readonly workspaceId: string;
    readonly userId: string;
    readonly subscriptionId: string;
    readonly name: string;
    readonly description: string | null;
    readonly template: ApiTemplate;
  }): Promise<DefinitionDto>;
  info(workspaceId: string, definitionId: string): Promise<ManagedDefinitionInfo>;
  rename(input: {
    readonly workspaceId: string;
    readonly userId: string;
    readonly definitionId: string;
    readonly name?: string;
    readonly description?: string | null;
  }): Promise<void>;
  pause(input: {
    readonly workspaceId: string;
    readonly userId: string | null;
    readonly definitionId: string;
  }): Promise<void>;
  resume(input: {
    readonly workspaceId: string;
    readonly userId: string | null;
    readonly definitionId: string;
  }): Promise<void>;
  /** Fecha de fin: la serie no produce fechas posteriores y las no resueltas posteriores se cancelan (`ENDED`). */
  end(input: {
    readonly workspaceId: string;
    readonly userId: string | null;
    readonly definitionId: string;
    /** Última fecha nominal que aún puede producirse. */
    readonly endDate: string;
    /** Fija el cierre sin pasar a `ENDED` (cancelación programada). */
    readonly deferClose: boolean;
  }): Promise<void>;
  unscheduleEnd(input: {
    readonly workspaceId: string;
    readonly userId: string;
    readonly definitionId: string;
  }): Promise<void>;
  /** "Esta y las siguientes" (FR-COMMITMENTS-009): cambios desde `effectiveFrom` (se ajusta a una fecha válida). */
  revise(input: {
    readonly workspaceId: string;
    readonly userId: string;
    readonly definitionId: string;
    readonly effectiveFrom: string;
    readonly changes: TemplateChanges;
  }): Promise<void>;
  /** Primera fecha válida para una revisión pedida desde `requested` (posterior a la última resuelta y a la versión). */
  revisionFrom(input: {
    readonly workspaceId: string;
    readonly definitionId: string;
    readonly requested: string;
  }): Promise<string>;
  /** Próxima renovación: primera fecha nominal ≥ `today` sin resolver ni cancelar (N5). */
  nextRenewal(input: {
    readonly workspaceId: string;
    readonly definitionId: string;
    readonly today: string;
  }): Promise<string | null>;
  /** Ocurrencia de una fecha nominal, si ya fue generada. */
  occurrenceOn(input: {
    readonly workspaceId: string;
    readonly definitionId: string;
    readonly occurrenceDate: string;
  }): Promise<ManagedOccurrenceInfo | null>;
}

export type { AmountInput };

/** Dependencias de los casos de uso de suscripciones (extienden las del motor). */
export interface SubscriptionsDeps extends CommitmentsDeps {
  readonly subscriptions: SubscriptionRepository;
  readonly proposals: ProposalRepository;
  readonly charges: ChargeRepository;
  readonly reminders: ReminderRepository;
  readonly managed: ManagedDefinitionPort;
  readonly counterpartyNames: CounterpartyNames;
}
