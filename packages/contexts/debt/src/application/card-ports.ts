import type { AuditPort } from '@pf/audit/contracts';
import type { RecurringDefinitionPort, RecurringDefinitionQuery } from '@pf/commitments/contracts';
import type { FxValuationPort } from '@pf/fx/contracts';
import type { AccountBalanceHistoryQuery, LedgerOpeningEntriesQuery } from '@pf/ledger/contracts';
import type { Clock } from '@pf/shared-kernel';
import type {
  AccountMovementsQuery,
  CardChargeTransactionsPort,
  PendingFlowQuery,
  TransactionLinkQuery,
} from '@pf/transactions/contracts';
import type {
  CardCharge,
  CardChargeStatus,
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

/** Filtro de la lista de cargos de una tarjeta (openspec add-card-interest-ledger-portions). */
export interface CardChargeFilter {
  readonly cardId: string;
  /** Id de la cuenta de usuario (`accountId`) o de la cuenta de la tarjeta (`cardAccountId`). */
  readonly cardAccountIds?: readonly string[];
  readonly from?: string;
  readonly to?: string;
  readonly status?: CardChargeStatus;
  readonly limit: number;
  /** Cursor opaco de `nextCursor`. */
  readonly after?: string;
}

/** Repositorio de los cargos de tarjeta (`debt.card_charge`). Nunca borra: anular marca `VOIDED`. */
export interface CardChargeRepository {
  insert(charge: CardCharge): Promise<void>;
  /** `FOR UPDATE` con `lock: 'update'`. */
  findById(workspaceId: string, id: string, options?: { lock?: 'update' }): Promise<CardCharge | null>;
  /** Cargo vigente que lleva la transacción (a lo sumo uno). */
  findActiveByTransaction(workspaceId: string, transactionId: string): Promise<CardCharge | null>;
  /** Persiste la anulación con control optimista por versión; `false` si otro cambio ganó. */
  saveVoid(charge: CardCharge): Promise<boolean>;
  /** Del más reciente al más antiguo (fecha, id); `nextCursor` es `null` en la última página. */
  list(
    workspaceId: string,
    filter: CardChargeFilter,
  ): Promise<{ readonly items: readonly CardCharge[]; readonly nextCursor: string | null }>;
  /** Cargos vigentes de las cuentas con fecha en `[from, to]` (detalle del estado de cuenta; una consulta por tarjeta). */
  activeForAccounts(
    workspaceId: string,
    cardAccountIds: readonly string[],
    from: string,
    to: string,
  ): Promise<readonly CardCharge[]>;
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

/** Métricas del motor de tarjetas (contador sin etiquetas de alta cardinalidad). */
export interface CardMetricsPort {
  increment(name: string, labels: Readonly<Record<string, string>>, value?: number): void;
}

/** Ciclos cuyo cálculo no cuadra (`previous + compras − reembolsos − pagos + otros ≠ cierre`); la vista marca `consistent = false`. */
export const CARD_CYCLE_MISMATCH_METRIC = 'debt_card_cycle_mismatch_total';

export interface CardDeps {
  readonly uow: UnitOfWork;
  readonly cards: CardRepository;
  readonly statements: StatementRepository;
  readonly plans: InstallmentPlanRepository;
  readonly utilization: UtilizationRepository;
  readonly reminders: ReminderRepository;
  /** Cargos de tarjeta (add-card-interest-ledger-portions). */
  readonly charges: CardChargeRepository;
  /** Escritura de los cargos en TRANSACTIONS, en la unidad de trabajo del llamador. */
  readonly chargeTransactions: CardChargeTransactionsPort;
  readonly accounts: AccountsPort;
  readonly balances: CardBalancePort;
  readonly movements: AccountMovementsQuery;
  /** Asientos de apertura de las cuentas (el saldo inicial no tiene transacción: entra en "otros movimientos"). */
  readonly openings: LedgerOpeningEntriesQuery;
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
  /** Opcional: sin él (pruebas, CLI) los descuadres solo se marcan en la vista. */
  readonly metrics?: CardMetricsPort;
}

export type { AccountBalanceHistoryQuery };
