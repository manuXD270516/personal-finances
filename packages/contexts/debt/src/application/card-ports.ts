import type { AuditPort } from '@pf/audit/contracts';
import type { RecurringDefinitionPort, RecurringDefinitionQuery } from '@pf/commitments/contracts';
import type { FxValuationPort } from '@pf/fx/contracts';
import type { AccountBalanceHistoryQuery } from '@pf/ledger/contracts';
import type { Clock } from '@pf/shared-kernel';
import type {
  AccountMovementsQuery,
  PendingFlowQuery,
  TransactionLinkQuery,
} from '@pf/transactions/contracts';
import type {
  CardInstallmentPlan,
  CardStatementStatus,
  CreditCard,
  ThresholdState,
} from '../domain/index.js';
import type {
  AccountsPort,
  CalendarPort,
  CurrencyCatalogPort,
  IdGenerator,
  OutboxPort,
  UnitOfWork,
} from './ports/index.js';

/** Estado de cuenta emitido tal como se persiste (cifras congeladas, texto decimal a la escala de la moneda). */
export interface StatementRecord {
  readonly id: string;
  readonly workspaceId: string;
  readonly cardAccountId: string;
  readonly cycleStart: string;
  readonly closingDate: string;
  readonly dueDate: string;
  readonly nominalDueDate: string;
  readonly currency: string;
  readonly previousBalance: string;
  readonly purchases: string;
  readonly refunds: string;
  readonly payments: string;
  readonly otherNet: string;
  readonly closingBalance: string;
  readonly unbilledInstallments: string;
  readonly billedBalance: string;
  readonly minimumDue: string;
  readonly reportedBilledBalance: string | null;
  readonly reportedMinimumDue: string | null;
  readonly status: Exclude<CardStatementStatus, 'OPEN'>;
  readonly issuedAt: string;
  readonly eventId: string | null;
  readonly version: number;
}

export interface CardRepository {
  /** `FOR UPDATE` con `lock: 'update'`. */
  findById(workspaceId: string, id: string, options?: { lock?: 'update' }): Promise<CreditCard | null>;
  insert(card: CreditCard, by: string): Promise<void>;
  /** Control optimista por versión; persiste cabecera, cuentas y las versiones de términos nuevas. */
  save(card: CreditCard, by: string): Promise<boolean>;
  list(workspaceId: string, filter: { status?: string; accountId?: string }): Promise<readonly CreditCard[]>;
  /** Tarjetas ACTIVAS que ya usan alguna de las cuentas. */
  activeCardsOfAccounts(
    workspaceId: string,
    accountIds: readonly string[],
  ): Promise<readonly { accountId: string; cardId: string }[]>;
  /** Índice `accountId → cardId` de las tarjetas activas del workspace (filtro del consumidor). */
  activeAccountIndex(workspaceId: string): Promise<ReadonlyMap<string, string>>;
  /** Id de la tarjeta (activa o archivada) dueña de la cuenta de tarjeta `cardAccountId`. */
  cardIdOfCardAccount(workspaceId: string, cardAccountId: string): Promise<string | null>;
  /** Ids de las tarjetas ACTIVAS del workspace. */
  activeCardIds(workspaceId: string): Promise<readonly string[]>;
}

export interface StatementRepository {
  /** `INSERT … ON CONFLICT (card_account_id, closing_date) DO NOTHING`; `true` si insertó. */
  insertIfAbsent(record: StatementRecord): Promise<boolean>;
  listForAccounts(
    workspaceId: string,
    cardAccountIds: readonly string[],
  ): Promise<readonly StatementRecord[]>;
  find(workspaceId: string, statementId: string): Promise<StatementRecord | null>;
  updateStatus(workspaceId: string, statementId: string, status: StatementRecord['status']): Promise<void>;
  /** Control optimista por versión; `null` borra el monto informado. */
  setReported(
    workspaceId: string,
    statementId: string,
    input: { billed: string | null; minimum: string | null; expectedVersion: number },
  ): Promise<boolean>;
}

export interface InstallmentPlanRepository {
  insert(plan: CardInstallmentPlan, by: string): Promise<void>;
  /** Persiste cabecera y reescribe las cuotas (solo cambian las no facturadas). */
  save(plan: CardInstallmentPlan): Promise<boolean>;
  findById(
    workspaceId: string,
    id: string,
    options?: { lock?: 'update' },
  ): Promise<CardInstallmentPlan | null>;
  /** Plan no cancelado de la compra. */
  findByPurchase(workspaceId: string, purchaseTransactionId: string): Promise<CardInstallmentPlan | null>;
  listForCardAccounts(
    workspaceId: string,
    cardAccountIds: readonly string[],
  ): Promise<readonly CardInstallmentPlan[]>;
}

export interface UtilizationRepository {
  states(cardId: string): Promise<readonly (ThresholdState & { scopeKey: string })[]>;
  upsert(
    workspaceId: string,
    cardId: string,
    scopeKey: string,
    states: readonly ThresholdState[],
  ): Promise<void>;
  /** Elimina los estados de umbrales que ya no existen (o de ámbitos que ya no aplican). */
  prune(
    workspaceId: string,
    cardId: string,
    keep: readonly { scopeKey: string; threshold: string }[],
  ): Promise<void>;
  insertCrossing(input: {
    workspaceId: string;
    cardId: string;
    scopeKey: string;
    threshold: string;
    crossingNo: number;
    utilization: string;
    crossedAt: string;
    eventId: string | null;
  }): Promise<void>;
}

export interface ReminderRepository {
  /** `INSERT … ON CONFLICT DO NOTHING`; `true` si insertó. */
  insertIfAbsent(input: {
    workspaceId: string;
    cardAccountId: string;
    closingDate: string;
    dueDate: string;
    emittedAt: string;
    eventId: string;
  }): Promise<boolean>;
}

/** Saldos presentados (deuda positiva) por cuenta y fecha de corte, del ledger (INV-022). */
export interface CardBalancePort {
  at(workspaceId: string, accountId: string, dates: readonly string[]): Promise<ReadonlyMap<string, string>>;
  today(workspaceId: string, accountIds: readonly string[]): Promise<ReadonlyMap<string, string>>;
}

export interface CardSettings {
  /** Ventana de vigencia de tasas de valoración (`REPORTING_RATE_VALIDITY_WINDOW`, días). */
  readonly rateValidityWindowDays: number;
  /** Ciclos cerrados que se calculan en lectura (pregunta 8: hasta 12). */
  readonly historyCycles: number;
  /** Horizonte de ocurrencias del plan que se mantienen (días). */
  readonly planHorizonDays: number;
}

export interface CardDeps {
  readonly uow: UnitOfWork;
  readonly cards: CardRepository;
  readonly statements: StatementRepository;
  readonly plans: InstallmentPlanRepository;
  readonly utilization: UtilizationRepository;
  readonly reminders: ReminderRepository;
  readonly accounts: AccountsPort;
  readonly balances: CardBalancePort;
  readonly movements: AccountMovementsQuery;
  readonly pending: PendingFlowQuery;
  readonly links: TransactionLinkQuery;
  readonly recurring: RecurringDefinitionPort;
  readonly recurringQuery: RecurringDefinitionQuery;
  readonly rates: Pick<FxValuationPort, 'resolveValuationRates'>;
  readonly calendar: CalendarPort;
  readonly currencies: CurrencyCatalogPort;
  readonly audit: AuditPort;
  readonly outbox: OutboxPort;
  readonly ids: IdGenerator;
  readonly clock: Clock;
  readonly settings: CardSettings;
}

export type { AccountBalanceHistoryQuery };
