/**
 * Tipos compartidos del dataset Demo (claves, dinero y operaciones comunes del plan). Hoja sin dependencias: la usan
 * `demo-plan.ts`, `module-ops.ts` y los generadores de `plan-modules/` sin crear ciclos de importación.
 */

export type DemoCurrency = 'BOB' | 'USD' | 'USDT' | 'BTC';

export type AccountKey =
  | 'bank_bob'
  | 'bank_usd'
  | 'cash'
  | 'usdt'
  | 'btc'
  | 'card'
  | 'savings_bob'
  | 'kantuta_bob'
  | 'kantuta_usd'
  | 'wallet';
/** Préstamos: sus cuentas las crea DEBT al registrarlos (no están en `plan.accounts`). */
export type BalanceKey = AccountKey | `loan_${'vehicular' | 'consumo' | 'familiar' | 'educativo'}`;
export type InstitutionKey = 'andino' | 'p2p' | 'cold' | 'illimani' | 'altiplano';
export type CounterpartyKey =
  | 'employer'
  | 'landlord'
  | 'power'
  | 'water'
  | 'gas'
  | 'internet'
  | 'streaming'
  | 'music'
  | 'cloud'
  | 'market'
  | 'cafe'
  | 'fuel'
  | 'pharmacy'
  | 'taxi'
  | 'bank'
  | 'gym'
  | 'antivirus'
  | 'magazine'
  | 'course'
  | 'vpn'
  | 'insurer'
  | 'hotel'
  | 'appliances'
  | 'eduFund'
  | 'aunt'
  | 'illimani';

/** Categoría por nombre del catálogo es-BO.v1 o por código de sistema (CLASSIFICATION). */
export type CategoryRef = { readonly name: string } | { readonly system: 'INTEREST' | 'FX_FEES' };

export interface DemoMoney {
  /** Unidades mínimas de la moneda (escala de `DEMO_SCALES`). */
  readonly minor: bigint;
  readonly currency: DemoCurrency;
}

/**
 * Claves de un plan: el dataset Demo usa uniones cerradas; otros datasets deterministas (`large`, docs/29 §2.3)
 * reutilizan los mismos tipos de operación con claves `string`.
 */
export interface PlanKeys {
  readonly account: string;
  readonly counterparty: string;
  readonly institution: string;
}
export interface DemoKeys extends PlanKeys {
  readonly account: AccountKey;
  readonly counterparty: CounterpartyKey;
  readonly institution: InstitutionKey;
}

export interface DemoSplit {
  readonly category: CategoryRef;
  readonly amount: DemoMoney;
  readonly tag?: 'reembolsable' | 'hogar';
}

export type PaymentMethod = 'CASH' | 'QR' | 'DEBIT_CARD' | 'CREDIT_CARD' | 'BANK_TRANSFER';

export type PlanOp<K extends PlanKeys = DemoKeys> =
  | {
      readonly op: 'rate';
      readonly date: string;
      readonly base: DemoCurrency;
      readonly quote: DemoCurrency;
      readonly value: string;
      readonly rateType: 'PARALLEL' | 'OFFICIAL';
    }
  | {
      readonly op: 'income' | 'expense';
      readonly key: string;
      readonly date: string;
      readonly account: K['account'];
      readonly amount: DemoMoney;
      readonly splits: readonly DemoSplit[];
      readonly counterparty: K['counterparty'] | null;
      readonly paymentMethod: PaymentMethod;
      readonly description: string;
      readonly pending?: boolean;
    }
  | {
      readonly op: 'refund';
      readonly key: string;
      readonly date: string;
      readonly of: string;
      readonly account: K['account'];
      readonly amount: DemoMoney;
      readonly description: string;
    }
  | {
      readonly op: 'adjustment';
      readonly date: string;
      readonly account: K['account'];
      readonly amount: DemoMoney;
      readonly direction: 'INCREASE' | 'DECREASE';
      readonly reason: string;
    }
  | {
      readonly op: 'transfer';
      readonly date: string;
      readonly from: K['account'];
      readonly to: K['account'];
      readonly amount: DemoMoney;
      readonly paymentMethod: PaymentMethod;
      readonly description: string;
    }
  | {
      readonly op: 'conversion';
      readonly date: string;
      readonly from: K['account'];
      readonly to: K['account'];
      readonly source: DemoMoney;
      readonly target: DemoMoney;
      /** 1 base = value quote (orientación de la cotización P2P). */
      readonly quoted: { readonly base: DemoCurrency; readonly quote: DemoCurrency; readonly value: string };
      readonly fee: { readonly type: 'PROVIDER' | 'NETWORK'; readonly amount: DemoMoney } | null;
      readonly description: string;
    }
  | {
      /** Edición financiera (cambio de monto) de una transacción ya registrada. */
      readonly op: 'edit';
      readonly date: string;
      readonly of: string;
      readonly amount: DemoMoney;
      readonly category: CategoryRef;
    }
  | { readonly op: 'void'; readonly date: string; readonly of: string; readonly reason: string };
