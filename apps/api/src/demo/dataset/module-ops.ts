import type { AccountKey, CategoryRef, CounterpartyKey, DemoMoney } from './plan-types.js';

/**
 * Operaciones del dataset Demo v2 (openspec add-phase-4-demo-data, design.md decisión 2): unión cerrada, solo de la
 * demo. Cada una la ejecuta `DemoModuleExecutor` con el caso de uso público del contexto dueño; ninguna escribe tablas.
 * `PlanOp`/`applyPlanOp` del seed `large` no cambian.
 */

export type SubscriptionKey =
  'stream' | 'music' | 'cloud' | 'antivirus' | 'vpn' | 'gym' | 'magazine' | 'course';
export type DefinitionKey = 'salary' | 'rent' | 'internet' | 'power' | 'cashWithdrawal' | 'insurance';
export type LoanKey = 'vehicular' | 'consumo' | 'familiar' | 'educativo';
export type CardKey = 'andina' | 'kantuta';
export type GoalKey = 'emergency' | 'travel' | 'laptop' | 'gifts';

/** Quién genera la ocurrencia que se resuelve: una suscripción, una definición, el plan de una meta o el pago de una tarjeta. */
export type OccurrenceTarget =
  | { readonly type: 'subscription'; readonly key: SubscriptionKey }
  | { readonly type: 'definition'; readonly key: DefinitionKey }
  | { readonly type: 'goalPlan'; readonly key: GoalKey }
  | { readonly type: 'cardPayment'; readonly key: CardKey; readonly account: AccountKey };

/** Efecto en el ledger de resolver una ocurrencia (oráculo de saldos del plan). */
export type OccurrenceEffect =
  | { readonly kind: 'expense' | 'income'; readonly account: AccountKey; readonly amount: DemoMoney }
  | {
      readonly kind: 'transfer';
      readonly from: AccountKey;
      readonly to: AccountKey;
      readonly amount: DemoMoney;
    };

export interface SubscriptionCreateOp {
  readonly op: 'subscription';
  readonly date: string;
  readonly key: SubscriptionKey;
  readonly name: string;
  readonly counterparty: CounterpartyKey;
  readonly account: AccountKey;
  readonly price: DemoMoney;
  readonly cadence: 'MONTHLY' | 'ANNUAL';
  readonly firstRenewalOn: string;
  readonly category: CategoryRef;
  readonly trialEndsOn?: string;
}

export interface SubscriptionPriceOp {
  readonly op: 'subscriptionPrice';
  readonly date: string;
  readonly sub: SubscriptionKey;
  readonly price: DemoMoney;
  readonly effectiveFrom: string;
}

export interface SubscriptionStatusOp {
  readonly op: 'subscriptionStatus';
  readonly date: string;
  readonly sub: SubscriptionKey;
  readonly action: 'pause' | 'cancel';
  readonly reason?: string;
}

export interface RecurringCreateOp {
  readonly op: 'recurring';
  readonly date: string;
  readonly key: DefinitionKey;
  readonly name: string;
  readonly kind: 'INCOME' | 'EXPENSE' | 'TRANSFER';
  readonly account: AccountKey;
  readonly toAccount?: AccountKey;
  readonly amount: DemoMoney;
  readonly amountType: 'FIXED' | 'ESTIMATED';
  readonly counterparty: CounterpartyKey | null;
  readonly category: CategoryRef | null;
  readonly monthDays: readonly number[];
  readonly cadence: 'MONTHLY' | 'QUARTERLY';
  readonly startDate: string;
  readonly weekendAdjustment: 'NONE' | 'PREVIOUS';
  readonly mode: 'PENDING_APPROVAL' | 'AUTO_CREATE' | 'NOTIFY_ONLY';
}

export interface OccurrenceOp {
  readonly op: 'occurrence';
  readonly date: string;
  readonly target: OccurrenceTarget;
  /** Fecha nominal de la ocurrencia que se resuelve. */
  readonly occurrenceDate: string;
  /**
   * `approve`: aprobar (opcionalmente con otro monto); `auto`: la crea el runner (no hay llamada, solo el efecto);
   * `link`: vincular una transacción existente del plan; `leave`: queda sin resolver (atrasada).
   */
  readonly action: 'approve' | 'auto' | 'link' | 'leave';
  readonly amount?: DemoMoney;
  readonly linkTo?: string;
  readonly effect: OccurrenceEffect | null;
  /** Solo `cardPayment`: monto del pago que el plan calculó con sus propias compras (se compara con el motor). */
  readonly expectedFromPlan?: DemoMoney;
}

export interface CardCreateOp {
  readonly op: 'card';
  readonly date: string;
  readonly key: CardKey;
  readonly name: string;
  readonly accounts: readonly {
    readonly account: AccountKey;
    readonly limit: DemoMoney | null;
    readonly minPercent: string;
    readonly minFloor: DemoMoney;
    readonly payment?: { readonly from: AccountKey; readonly policy: 'NO_INTEREST' | 'MINIMUM' };
  }[];
  readonly sharedLimit: DemoMoney | null;
  readonly statementDay: number;
  readonly dueDay: number;
}

export interface InstallmentsOp {
  readonly op: 'installments';
  readonly date: string;
  readonly card: CardKey;
  /** Clave de la compra (op `expense` del plan). */
  readonly purchase: string;
  readonly count: number;
}

export interface LoanCreateOp {
  readonly op: 'loan';
  readonly date: string;
  readonly key: LoanKey;
  readonly name: string;
  readonly method: 'FRENCH' | 'GERMAN';
  readonly principal: DemoMoney;
  /** Tasa anual como fracción decimal (`0.09`). */
  readonly annualRate: string;
  readonly term: number;
  readonly disbursementDate: string;
  readonly firstDueDate: string;
  readonly account: AccountKey;
  readonly lender: CounterpartyKey;
  readonly institution: 'andino' | 'illimani' | null;
  readonly reference: string;
}

export interface LoanPaymentOp {
  readonly op: 'loanPayment';
  readonly date: string;
  readonly loan: LoanKey;
  readonly installmentNo: number;
  readonly total: DemoMoney;
  readonly principal: DemoMoney;
  readonly interest: DemoMoney;
  readonly account: AccountKey;
}

export interface LoanPrepaymentOp {
  readonly op: 'loanPrepayment';
  readonly date: string;
  readonly loan: LoanKey;
  readonly amount: DemoMoney;
  readonly account: AccountKey;
}

export interface GoalCreateOp {
  readonly op: 'goal';
  readonly date: string;
  readonly key: GoalKey;
  readonly name: string;
  readonly type: 'EMERGENCY_FUND' | 'TRAVEL' | 'PURCHASE' | 'CUSTOM';
  readonly target: DemoMoney;
  readonly startDate: string;
  readonly targetDate: string | null;
  readonly linked: readonly AccountKey[];
  readonly priority: number;
}

export interface GoalPlanOp {
  readonly op: 'goalPlan';
  readonly date: string;
  readonly goal: GoalKey;
  readonly monthly: DemoMoney;
  readonly fund: 'REAL' | 'EARMARK';
  readonly source: AccountKey;
  readonly destination: AccountKey | null;
  readonly dayOfMonth: number | null;
  readonly automation: 'NONE' | 'RECURRING';
}

export interface GoalMovementOp {
  readonly op: 'goalMovement';
  readonly date: string;
  readonly goal: GoalKey;
  /** Reserva (EARMARK) sobre una cuenta. */
  readonly kind: 'reserve';
  readonly account: AccountKey;
  readonly amount: DemoMoney;
}

export interface NotificationPrefsOp {
  readonly op: 'notificationPrefs';
  readonly date: string;
}

export type TickRunner = 'occurrences' | 'subscriptions' | 'cards' | 'goals';

export interface TickOp {
  readonly op: 'tick';
  readonly date: string;
  readonly runner: TickRunner;
  /** Tick de la ancla: corre al final del día A, después de todas las operaciones. */
  readonly late?: boolean;
}

export type ModuleOp =
  | SubscriptionCreateOp
  | SubscriptionPriceOp
  | SubscriptionStatusOp
  | RecurringCreateOp
  | OccurrenceOp
  | CardCreateOp
  | InstallmentsOp
  | LoanCreateOp
  | LoanPaymentOp
  | LoanPrepaymentOp
  | GoalCreateOp
  | GoalPlanOp
  | GoalMovementOp
  | NotificationPrefsOp
  | TickOp;

export type ModuleOpName = ModuleOp['op'];
