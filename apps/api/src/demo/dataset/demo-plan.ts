import {
  addDays,
  addMonthsClamped,
  dayOfMonth,
  daysInMonth,
  epochDay,
  lastBusinessDay,
  monthAt,
  monthStart,
  ymd,
} from './calendar.js';
import type { ModuleOp } from './module-ops.js';
import { buildCommitments, type CommitmentsPlan, type SubscriptionPlan } from './plan-modules/commitments.js';
import {
  cardDue,
  closingsBetween,
  kantutaPlan,
  statementFigures,
  type CardMovement,
} from './plan-modules/cards.js';
import { buildGoals } from './plan-modules/goals.js';
import { loanDefinitions, loanOps } from './plan-modules/loans.js';
import { SeededRandom } from './prng.js';

/**
 * Dataset Demo v2 (docs/29 §2.2; openspec add-demo-data design.md decisión 3 y add-phase-4-demo-data). Personas, instituciones,
 * comercios y contrapartes FICTICIOS con apariencia real (nunca entidades reales); identificadores con prefijo
 * `DEMO-`. Generación determinista: PRNG sembrado, montos como enteros de unidades mínimas (`bigint`) convertidos a
 * strings decimales, fechas calculadas sobre el ancla fija y desplazadas a la ancla pedida (`--anchor=today`), sin
 * leer el reloj.
 */
export const DEMO_MANIFEST = {
  profile: 'demo',
  datasetVersion: '2',
  generatorVersion: '2.0.0',
  prngSeed: 20260930,
  /** Ancla fija del dataset (golden summary). `anchor=today` desplaza todas las fechas. */
  anchorDate: '2026-09-30',
  /** Ventana de 21 meses (docs/29; owner D41): 2025-01-01 → 2026-09-30. */
  windowMonths: 21,
  timezone: 'America/La_Paz',
  modules: [
    'identity',
    'classification',
    'accounts',
    'fx',
    'transactions',
    'commitments',
    'debt',
    'goals',
    'ledger',
  ],
  workspaceName: 'Demo — Finanzas de Valeria',
} as const;

export type DemoCurrency = 'BOB' | 'USD' | 'USDT' | 'BTC';
export const DEMO_SCALES: Readonly<Record<DemoCurrency, number>> = { BOB: 2, USD: 2, USDT: 6, BTC: 8 };

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

export interface DemoInstitution<K extends PlanKeys = DemoKeys> {
  readonly key: K['institution'];
  readonly name: string;
  readonly kind: 'BANK' | 'EXCHANGE' | 'WALLET_PROVIDER';
}

export interface DemoAccount<K extends PlanKeys = DemoKeys> {
  readonly key: K['account'];
  readonly name: string;
  readonly type: 'BANK' | 'SAVINGS' | 'CASH' | 'CRYPTO_WALLET' | 'CREDIT_CARD' | 'LOAN' | 'DIGITAL_WALLET';
  readonly currency: DemoCurrency;
  readonly institution: K['institution'] | null;
  readonly openedOn: string;
  readonly opening: DemoMoney | null;
  /** Identificador ficticio (`DEMO-…`), en las notas de la cuenta. */
  readonly reference: string;
  readonly last4: string | null;
}

export interface DemoCounterparty<K extends PlanKeys = DemoKeys> {
  readonly key: K['counterparty'];
  readonly name: string;
  readonly kind: 'MERCHANT' | 'PERSON' | 'SERVICE_PROVIDER' | 'FINANCIAL_INSTITUTION' | 'EMPLOYER';
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

/** Operación del dataset Demo v2: las comunes (`PlanOp`) más las de módulo (`ModuleOp`, solo de la demo). */
export type DemoOp = PlanOp | ModuleOp;
export type IncomeExpenseOp = Extract<PlanOp, { op: 'income' | 'expense' }>;

export interface DemoMonth<K extends PlanKeys = DemoKeys, O = PlanOp<K>> {
  /** `YYYY-MM` del mes (ya desplazado a la ancla pedida). */
  readonly month: string;
  readonly ops: readonly O[];
}

export interface DemoPlan<K extends PlanKeys = DemoKeys, O = PlanOp<K>> {
  readonly datasetVersion: string;
  readonly anchorDate: string;
  readonly startDate: string;
  readonly institutions: readonly DemoInstitution<K>[];
  readonly accounts: readonly DemoAccount<K>[];
  readonly counterparties: readonly DemoCounterparty<K>[];
  readonly tags: readonly { readonly key: 'reembolsable' | 'hogar'; readonly name: string }[];
  readonly months: readonly DemoMonth<K, O>[];
}

// ------------------------------------------------------------------ helpers de dinero (enteros, nunca `number`)

export const money = (minor: bigint, currency: DemoCurrency): DemoMoney => ({ minor, currency });
const bob = (minor: bigint) => money(minor, 'BOB');
const usd = (minor: bigint) => money(minor, 'USD');
const usdt = (minor: bigint) => money(minor, 'USDT');
const btc = (minor: bigint) => money(minor, 'BTC');

/** Unidades mínimas → string decimal con la escala de la moneda (`123456n`, 2 → `"1234.56"`). */
export function toDecimal(m: DemoMoney): string {
  const scale = DEMO_SCALES[m.currency];
  const negative = m.minor < 0n;
  const digits = (negative ? -m.minor : m.minor).toString().padStart(scale + 1, '0');
  const int = digits.slice(0, digits.length - scale);
  const frac = digits.slice(digits.length - scale);
  return `${negative ? '-' : ''}${int}${scale > 0 ? `.${frac}` : ''}`;
}

/** Escala `minor` por `num/den` con redondeo half-up (enteros). */
const scaleBy = (minor: bigint, num: bigint, den: bigint): bigint => (minor * num * 2n + den) / (den * 2n);

// ------------------------------------------------------------------ catálogo ficticio

const INSTITUTIONS: readonly DemoInstitution[] = [
  { key: 'andino', name: 'Banco Andino Demo', kind: 'BANK' },
  { key: 'p2p', name: 'P2P Exchange Demo', kind: 'EXCHANGE' },
  { key: 'cold', name: 'Cold Wallet Demo', kind: 'WALLET_PROVIDER' },
  { key: 'illimani', name: 'Cooperativa Illimani Demo', kind: 'BANK' },
  { key: 'altiplano', name: 'Billetera Altiplano Demo', kind: 'WALLET_PROVIDER' },
];

const COUNTERPARTIES: readonly DemoCounterparty[] = [
  { key: 'employer', name: 'Andes Software Demo SRL', kind: 'EMPLOYER' },
  { key: 'landlord', name: 'Inmobiliaria Illimani Demo', kind: 'PERSON' },
  { key: 'power', name: 'Luz Altiplano Demo', kind: 'SERVICE_PROVIDER' },
  { key: 'water', name: 'Aguas del Valle Demo', kind: 'SERVICE_PROVIDER' },
  { key: 'gas', name: 'Gas Andino Demo', kind: 'SERVICE_PROVIDER' },
  { key: 'internet', name: 'Fibra Kantuta Demo', kind: 'MERCHANT' },
  { key: 'streaming', name: 'StreamFlix Demo', kind: 'MERCHANT' },
  { key: 'music', name: 'MúsicaYa Demo', kind: 'MERCHANT' },
  { key: 'cloud', name: 'NubeSegura Demo', kind: 'MERCHANT' },
  { key: 'market', name: 'Supermercado Kantuta Demo', kind: 'MERCHANT' },
  { key: 'cafe', name: 'Café Sajama Demo', kind: 'MERCHANT' },
  { key: 'fuel', name: 'Estación Illampu Demo', kind: 'MERCHANT' },
  { key: 'pharmacy', name: 'Farmacia Chacaltaya Demo', kind: 'MERCHANT' },
  { key: 'taxi', name: 'TaxiYa Demo', kind: 'MERCHANT' },
  { key: 'bank', name: 'Banco Andino Demo', kind: 'FINANCIAL_INSTITUTION' },
  { key: 'gym', name: 'Gimnasio Sajama Demo', kind: 'MERCHANT' },
  { key: 'antivirus', name: 'Antivirus Escudo Demo', kind: 'MERCHANT' },
  { key: 'magazine', name: 'Revista Andina Demo', kind: 'MERCHANT' },
  { key: 'course', name: 'Curso Kantuta Demo', kind: 'MERCHANT' },
  { key: 'vpn', name: 'VPN Cóndor Demo', kind: 'MERCHANT' },
  { key: 'insurer', name: 'Seguros Illampu Demo', kind: 'SERVICE_PROVIDER' },
  { key: 'hotel', name: 'Hotel Salar Demo', kind: 'MERCHANT' },
  { key: 'appliances', name: 'Electro Kantuta Demo', kind: 'MERCHANT' },
  { key: 'eduFund', name: 'Fondo Educativo Demo', kind: 'FINANCIAL_INSTITUTION' },
  { key: 'aunt', name: 'Tía Carmen (ficticia)', kind: 'PERSON' },
  { key: 'illimani', name: 'Cooperativa Illimani Demo', kind: 'FINANCIAL_INSTITUTION' },
];

/** Compras con tarjeta: categoría, contraparte y rango de montos (centavos BOB). */
const CARD_SPENDING: readonly {
  readonly category: string;
  readonly counterparty: CounterpartyKey | null;
  readonly min: bigint;
  readonly max: bigint;
  readonly description: string;
}[] = [
  {
    category: 'Supermercado y minimarket',
    counterparty: 'market',
    min: 8_000n,
    max: 42_000n,
    description: 'Compras del súper',
  },
  { category: 'Restaurantes', counterparty: null, min: 6_000n, max: 25_000n, description: 'Almuerzo' },
  { category: 'Combustible', counterparty: 'fuel', min: 15_000n, max: 30_000n, description: 'Gasolina' },
  { category: 'Cafés y snacks', counterparty: 'cafe', min: 1_800n, max: 6_500n, description: 'Café' },
  { category: 'Farmacia', counterparty: 'pharmacy', min: 2_500n, max: 18_000n, description: 'Farmacia' },
  { category: 'Delivery', counterparty: null, min: 4_500n, max: 14_000n, description: 'Delivery' },
  { category: 'Entretenimiento', counterparty: null, min: 5_000n, max: 20_000n, description: 'Cine' },
  { category: 'Ropa y calzado', counterparty: null, min: 12_000n, max: 48_000n, description: 'Ropa' },
];

/**
 * Plan determinista de comandos (mismo `anchorDate` ⇒ mismo plan, bit a bit). `anchorDate` = ancla pedida (por
 * defecto la fija del dataset); las fechas se calculan sobre la ancla fija y se desplazan `anchor − 2026-09-30` días.
 */
export function buildDemoPlan(anchorDate: string = DEMO_MANIFEST.anchorDate): DemoPlan<DemoKeys, DemoOp> {
  return composeDemoPlan(anchorDate).plan;
}

/** Cifras esperadas de los módulos que el plan calculó con sus propios cálculos (oráculo del cargador y de las pruebas). */
export function buildDemoOracle(anchorDate: string = DEMO_MANIFEST.anchorDate): DemoOracle {
  return composeDemoPlan(anchorDate).oracle;
}

export interface AndinaStatement {
  readonly closing: string;
  readonly due: string;
  readonly billed: bigint;
  readonly minimum: bigint;
  /** Monto que el plan paga el día del vencimiento (`null` si el vencimiento es posterior a la ancla). */
  readonly payment: bigint | null;
}

export interface DemoOracle {
  readonly subscriptions: readonly SubscriptionPlan[];
  /** Ocurrencias de definiciones recurrentes sin resolver al llegar a la ancla. */
  readonly unresolved: CommitmentsPlan['unresolved'];
  readonly andina: readonly AndinaStatement[];
  readonly emergencyContributions: readonly string[];
  /** Reservas por meta (unidades mínimas de la moneda de la meta). */
  readonly reserved: Readonly<Record<'travel' | 'laptop' | 'gifts', bigint>>;
}

function composeDemoPlan(anchorDate: string): { plan: DemoPlan<DemoKeys, DemoOp>; oracle: DemoOracle } {
  const shift = epochDay(anchorDate) - epochDay(DEMO_MANIFEST.anchorDate);
  const at = (date: string) => addDays(date, shift);
  const seed = DEMO_MANIFEST.prngSeed;
  const startDate = ymd(2025, 1, 1);

  const kantuta = kantutaPlan(anchorDate);
  const goals = buildGoals(anchorDate);
  const v1Accounts: DemoAccount[] = [
    acc(
      'bank_bob',
      'Banco Andino Demo — Cuenta corriente',
      'BANK',
      'BOB',
      'andino',
      startDate,
      bob(800_000n),
      'DEMO-BAD-0001',
      'D001',
    ),
    acc(
      'bank_usd',
      'Banco Andino Demo — Ahorro USD',
      'SAVINGS',
      'USD',
      'andino',
      startDate,
      usd(120_000n),
      'DEMO-BAD-0002',
      'D002',
    ),
    acc('cash', 'Efectivo', 'CASH', 'BOB', null, startDate, bob(30_000n), 'DEMO-CASH-0001', null),
    acc(
      'usdt',
      'P2P Exchange Demo — Billetera USDT',
      'CRYPTO_WALLET',
      'USDT',
      'p2p',
      startDate,
      usdt(150_000_000n),
      'DEMO-P2P-0001',
      null,
    ),
    acc(
      'btc',
      'Cold Wallet BTC',
      'CRYPTO_WALLET',
      'BTC',
      'cold',
      startDate,
      btc(500_000n),
      'DEMO-COLD-0001',
      null,
    ),
    acc(
      'card',
      'Tarjeta Andina Demo',
      'CREDIT_CARD',
      'BOB',
      'andino',
      startDate,
      null,
      'DEMO-TAD-0001',
      'D777',
    ),
    acc(
      'savings_bob',
      'Banco Andino Demo — Caja de ahorro BOB',
      'SAVINGS',
      'BOB',
      'andino',
      startDate,
      null,
      'DEMO-BAD-0003',
      'D003',
    ),
  ].map((a) => ({ ...a, openedOn: at(a.openedOn) }));
  // Cuentas de Phases 3 y 4, fechadas respecto de la ancla (design.md decisión 4).
  const accounts: DemoAccount[] = [
    ...v1Accounts,
    acc(
      'kantuta_bob',
      'Tarjeta Kantuta Demo BOB',
      'CREDIT_CARD',
      'BOB',
      'illimani',
      kantuta.openedOn,
      null,
      'DEMO-TKD-0001',
      'K777',
    ),
    acc(
      'kantuta_usd',
      'Tarjeta Kantuta Demo USD',
      'CREDIT_CARD',
      'USD',
      'illimani',
      kantuta.openedOn,
      null,
      'DEMO-TKD-0002',
      'K778',
    ),
    acc(
      'wallet',
      'Billetera Altiplano Demo',
      'DIGITAL_WALLET',
      'BOB',
      'altiplano',
      goals.dates.walletOpenedOn,
      bob(60_000n),
      'DEMO-BAL-0001',
      null,
    ),
  ];

  const rates = SeededRandom.derive(seed, 'fx');
  const salary = SeededRandom.derive(seed, 'income');
  const utilities = SeededRandom.derive(seed, 'utilities');
  const card = SeededRandom.derive(seed, 'card');
  const cash = SeededRandom.derive(seed, 'cash');
  const conv = SeededRandom.derive(seed, 'conversions');

  const flat: DemoOp[] = [];
  let usdBob = 696; // centésimos de BOB por USD (paralelo)
  let usdtBob = 694;
  let btcUsd = 62_000; // USD por BTC

  for (let i = 0; i < DEMO_MANIFEST.windowMonths; i += 1) {
    const { y, m } = monthAt(2025, 1, i);
    const d = (day: number) => ymd(y, m, Math.min(day, daysInMonth(y, m)));
    const ops: DemoOp[] = [];
    const k = (name: string) => `${y}-${String(m).padStart(2, '0')}:${name}`;
    const expense = (
      key: string,
      date: string,
      account: AccountKey,
      amount: DemoMoney,
      category: CategoryRef,
      counterparty: CounterpartyKey | null,
      paymentMethod: PaymentMethod,
      description: string,
      extra: { splits?: readonly DemoSplit[]; pending?: boolean } = {},
    ): IncomeExpenseOp => ({
      op: 'expense',
      key: k(key),
      date,
      account,
      amount,
      splits: extra.splits ?? [{ category, amount }],
      counterparty,
      paymentMethod,
      description,
      ...(extra.pending ? { pending: true } : {}),
    });

    // ── Tasas manuales "Demo" (FX): paralelo semanal USD/BOB y USDT/BOB, oficial y BTC/USD mensual.
    ops.push({ op: 'rate', date: d(1), base: 'USD', quote: 'BOB', value: '6.96', rateType: 'OFFICIAL' });
    for (const day of [1, 8, 15, 22]) {
      usdBob = clamp(usdBob + rates.int(-3, 3), 688, 712);
      usdtBob = clamp(usdtBob + rates.int(-3, 3), 688, 705);
      ops.push({
        op: 'rate',
        date: d(day),
        base: 'USD',
        quote: 'BOB',
        value: cents(usdBob),
        rateType: 'PARALLEL',
      });
      ops.push({
        op: 'rate',
        date: d(day),
        base: 'USDT',
        quote: 'BOB',
        value: cents(usdtBob),
        rateType: 'PARALLEL',
      });
    }
    btcUsd = clamp(btcUsd + rates.int(-4_000, 5_000), 48_000, 98_000);
    ops.push({
      op: 'rate',
      date: d(1),
      base: 'BTC',
      quote: 'USD',
      value: String(btcUsd),
      rateType: 'PARALLEL',
    });

    // ── Efectivo: retiro mensual y gastos menudos (mercado, minibús).
    ops.push({
      op: 'transfer',
      date: d(2),
      from: 'bank_bob',
      to: 'cash',
      amount: bob(60_000n),
      paymentMethod: 'BANK_TRANSFER',
      description: 'Retiro de efectivo',
    });
    const cashCount = cash.int(2, 3);
    for (let c = 0; c < cashCount; c += 1) {
      const isMarket = cash.int(0, 1) === 0;
      ops.push(
        expense(
          `cash-${c}`,
          d(cash.int(3, 27)),
          'cash',
          bob(cash.bigint(2_000n, 12_000n)),
          { name: isMarket ? 'Mercado' : 'Minibús y micro' },
          null,
          'CASH',
          isMarket ? 'Mercado Rodríguez' : 'Pasajes',
        ),
      );
    }

    // ── Vivienda: alquiler (3 500.00 → 3 700.00 desde 2026-02) y servicios por QR con estacionalidad de invierno.
    const rent = y > 2026 || (y === 2026 && m >= 2) ? 370_000n : 350_000n;
    ops.push(
      expense(
        'rent',
        d(5),
        'bank_bob',
        bob(rent),
        { name: 'Alquiler' },
        'landlord',
        'BANK_TRANSFER',
        'Alquiler departamento',
      ),
    );
    const winter = m >= 6 && m <= 8;
    const season = (base: bigint) => (winter ? scaleBy(base, 125n, 100n) : base);
    ops.push(
      expense(
        'power',
        d(12),
        'bank_bob',
        bob(season(utilities.bigint(16_000n, 21_000n))),
        { name: 'Luz' },
        'power',
        'QR',
        'Factura de luz',
      ),
    );
    ops.push(
      expense(
        'water',
        d(12),
        'bank_bob',
        bob(utilities.bigint(7_500n, 9_500n)),
        { name: 'Agua' },
        'water',
        'QR',
        'Factura de agua',
      ),
    );
    ops.push(
      expense(
        'gas',
        d(13),
        'bank_bob',
        bob(season(utilities.bigint(5_000n, 7_000n))),
        { name: 'Gas domiciliario' },
        'gas',
        'QR',
        'Gas domiciliario',
      ),
    );
    ops.push(
      expense(
        'internet',
        d(14),
        'bank_bob',
        bob(29_900n),
        { name: 'Internet' },
        'internet',
        'QR',
        'Internet hogar 300 Mbps',
      ),
    );

    // ── Tarjeta de crédito: sus pagos son ocurrencias del pago administrado (se calculan tras generar las compras).
    const last = i === DEMO_MANIFEST.windowMonths - 1;
    const purchases = card.int(8, 11);
    const cardOps: IncomeExpenseOp[] = [];
    for (let p = 0; p < purchases; p += 1) {
      const spend = card.pick(CARD_SPENDING);
      const amount = card.bigint(spend.min, spend.max);
      cardOps.push(
        expense(
          `card-${p}`,
          d(card.int(1, last ? 26 : 28)),
          'card',
          bob(amount),
          { name: spend.category },
          spend.counterparty,
          'CREDIT_CARD',
          spend.description,
        ) as IncomeExpenseOp,
      );
    }
    if (i === 6) {
      // Split: compra del súper con artículos de limpieza (etiqueta "Hogar").
      cardOps.push(
        expense(
          'card-split',
          d(18),
          'card',
          bob(45_000n),
          { name: 'Supermercado y minimarket' },
          'market',
          'CREDIT_CARD',
          'Súper + limpieza',
          {
            splits: [
              { category: { name: 'Supermercado y minimarket' }, amount: bob(30_000n) },
              { category: { name: 'Artículos de limpieza' }, amount: bob(15_000n), tag: 'hogar' },
            ],
          },
        ) as IncomeExpenseOp,
      );
    }
    if (i === 13) {
      // Cargo duplicado que luego se anula.
      cardOps.push(
        expense(
          'card-dup',
          d(16),
          'card',
          bob(18_990n),
          { name: 'Restaurantes' },
          null,
          'CREDIT_CARD',
          'Cena (cargo duplicado)',
        ) as IncomeExpenseOp,
      );
    }
    cardOps.sort((a, b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key));
    ops.push(...cardOps);
    if (last) {
      // Dos compras pendientes al final de la ventana (no afectan saldos).
      ops.push(
        expense(
          'card-pending-0',
          d(29),
          'card',
          bob(8_450n),
          { name: 'Delivery' },
          null,
          'CREDIT_CARD',
          'Delivery (pendiente)',
          { pending: true },
        ),
      );
      ops.push(
        expense(
          'card-pending-1',
          d(30),
          'card',
          bob(23_900n),
          { name: 'Combustible' },
          'fuel',
          'CREDIT_CARD',
          'Gasolina (pendiente)',
          { pending: true },
        ),
      );
    }

    // ── Reembolsos (uno total, uno parcial), ajuste, ediciones y anulación (recorridos de add-lifecycle-timeline).
    if (i === 4 && cardOps[0]) {
      const original = cardOps[0];
      ops.push({
        op: 'refund',
        key: k('refund'),
        date: d(25),
        of: original.key,
        account: 'card',
        amount: original.amount,
        description: 'Reembolso compra devuelta',
      });
    }
    if (i === 12 && cardOps[1]) {
      const original = cardOps[1];
      const half = bob(original.amount.minor / 2n);
      ops.push({
        op: 'refund',
        key: k('refund'),
        date: d(26),
        of: original.key,
        account: 'card',
        amount: half,
        description: 'Reembolso parcial',
      });
    }
    if (i === 9) {
      ops.push({
        op: 'adjustment',
        date: d(28),
        account: 'cash',
        amount: bob(2_350n),
        direction: 'DECREASE',
        reason: 'Diferencia de arqueo de caja',
      });
    }
    if (i === 11 && cardOps[2]) {
      const original = cardOps[2];
      const amount = bob(original.amount.minor + 1_500n);
      ops.push({ op: 'edit', date: d(28), of: original.key, amount, category: original.splits[0]!.category });
    }
    if (i === 15) {
      ops.push({
        op: 'edit',
        date: d(20),
        of: k('internet'),
        amount: bob(27_900n),
        category: { name: 'Internet' },
      });
    }
    if (i === 13) {
      ops.push({ op: 'void', date: d(17), of: k('card-dup'), reason: 'Cargo duplicado' });
    }

    // ── Conversiones P2P: compra mensual de USDT con BOB (fee del proveedor en USDT), BTC trimestral con fee de
    //    red, dos ventas de USDT a BOB y ahorro trimestral BOB → USD.
    const sourceBob = BigInt(conv.int(10, 25)) * 10_000n; // 1 000.00 … 2 500.00 BOB
    const p2p = conv.int(688, 705); // centésimos de BOB por USDT
    const feeUsdt = BigInt(conv.int(5, 10)) * 100_000n; // 0.500000 … 1.000000 USDT
    const grossUsdt = (sourceBob * 1_000_000n) / BigInt(p2p);
    ops.push({
      op: 'conversion',
      date: d(20),
      from: 'bank_bob',
      to: 'usdt',
      source: bob(sourceBob),
      target: usdt(grossUsdt - feeUsdt),
      quoted: { base: 'USDT', quote: 'BOB', value: cents(p2p) },
      fee: { type: 'PROVIDER', amount: usdt(feeUsdt) },
      description: 'Compra P2P de USDT',
    });
    if ([3, 8, 13, 18].includes(i)) {
      const gross = (10_000_000_000n * 100n) / BigInt(btcUsd) / 100n; // 100 USDT → BTC (escala 8)
      const network = 2_000n; // 0.00002000 BTC
      ops.push({
        op: 'conversion',
        date: d(21),
        from: 'usdt',
        to: 'btc',
        source: usdt(100_000_000n),
        target: btc(gross - network),
        quoted: { base: 'BTC', quote: 'USDT', value: String(btcUsd) },
        fee: { type: 'NETWORK', amount: btc(network) },
        description: 'Compra de BTC',
      });
    }
    if (i === 10 || i === 16) {
      ops.push({
        op: 'conversion',
        date: d(23),
        from: 'usdt',
        to: 'bank_bob',
        source: usdt(200_000_000n),
        target: bob(200n * BigInt(usdtBob)),
        quoted: { base: 'USDT', quote: 'BOB', value: cents(usdtBob) },
        fee: null,
        description: 'Venta P2P de USDT',
      });
    }
    if (i % 3 === 2) {
      const savings = 140_000n; // 1 400.00 BOB
      ops.push({
        op: 'conversion',
        date: d(24),
        from: 'bank_bob',
        to: 'bank_usd',
        source: bob(savings),
        target: usd((savings * 100n) / BigInt(usdBob)),
        quoted: { base: 'USD', quote: 'BOB', value: cents(usdBob) },
        fee: null,
        description: 'Ahorro mensual en USD',
      });
    }

    // ── Ingresos: salario el último día hábil (+5 % desde 2026-01) y aguinaldo en diciembre.
    const pay = y >= 2026 ? 1_260_000n : 1_200_000n;
    ops.push({
      op: 'income',
      key: k('salary'),
      date: lastBusinessDay(y, m),
      account: 'bank_bob',
      amount: bob(pay),
      splits: [{ category: { name: 'Sueldo' }, amount: bob(pay) }],
      counterparty: 'employer',
      paymentMethod: 'BANK_TRANSFER',
      description: 'Sueldo',
    });
    if (m === 12) {
      ops.push({
        op: 'income',
        key: k('bonus'),
        date: d(20),
        account: 'bank_bob',
        amount: bob(1_200_000n),
        splits: [{ category: { name: 'Aguinaldo' }, amount: bob(1_200_000n) }],
        counterparty: 'employer',
        paymentMethod: 'BANK_TRANSFER',
        description: 'Aguinaldo',
      });
    }
    // Una variación aleatoria de bonos (determinista) en meses impares.
    if (m % 2 === 1 && salary.int(0, 2) === 0) {
      const bonus = salary.bigint(30_000n, 90_000n);
      ops.push({
        op: 'income',
        key: k('extra'),
        date: d(16),
        account: 'bank_bob',
        amount: bob(bonus),
        splits: [{ category: { name: 'Honorarios y freelance' }, amount: bob(bonus) }],
        counterparty: null,
        paymentMethod: 'BANK_TRANSFER',
        description: 'Proyecto freelance',
      });
    }

    flat.push(...ops.map((op) => ({ ...op, date: at(op.date) }) as DemoOp));
  }

  // ── Dataset v2: los flujos que ahora crean los casos de uso de COMMITMENTS y DEBT reemplazan a los gastos sueltos
  //    de los últimos 6 meses (sueldo, alquiler, internet y retiro de efectivo).
  const replaceFrom = monthStart(addMonthsClamped(anchorDate, -5));
  const dropped = new Set<string>();
  const kept = flat.filter((op) => {
    if (op.date < replaceFrom) return true;
    const isReplaced =
      ((op.op === 'income' || op.op === 'expense') && /:(rent|salary|internet)$/.test(op.key)) ||
      (op.op === 'transfer' && op.description === 'Retiro de efectivo');
    if (isReplaced && (op.op === 'income' || op.op === 'expense')) dropped.add(op.key);
    return !isReplaced;
  });
  const flows = kept.filter(
    (op) =>
      !(
        (op.op === 'edit' || op.op === 'void' || op.op === 'refund') &&
        'of' in op &&
        dropped.has((op as { of: string }).of)
      ),
  );
  const powerExpenseByMonth = new Map<string, string>();
  for (const op of flows) {
    if (op.op === 'expense' && op.key.endsWith(':power') && !powerExpenseByMonth.has(op.date.slice(0, 7))) {
      powerExpenseByMonth.set(op.date.slice(0, 7), op.key);
    }
  }
  const windowStart = at(startDate);
  const commitments = buildCommitments({
    anchor: anchorDate,
    shift,
    startDate: windowStart,
    powerExpenseByMonth,
  });
  const loans = loanDefinitions(anchorDate);
  const extra: DemoOp[] = [
    { op: 'notificationPrefs', date: windowStart },
    ...commitments.ops,
    ...loans.flatMap((l) => loanOps(l)),
    ...goals.ops,
    ...goals.flows,
    ...kantuta.flows,
    kantuta.card,
    kantuta.installments,
    ...kantuta.closings.map((c): ModuleOp => ({ op: 'tick', date: addDays(c, 1), runner: 'cards' })),
    // Tasas de cierre en A − 1 (decisión 7): la valoración de "hoy" queda completa y verificable a mano.
    {
      op: 'rate',
      date: addDays(anchorDate, -1),
      base: 'USD',
      quote: 'BOB',
      value: '7.00',
      rateType: 'PARALLEL',
    },
    {
      op: 'rate',
      date: addDays(anchorDate, -1),
      base: 'USDT',
      quote: 'BOB',
      value: '6.95',
      rateType: 'PARALLEL',
    },
    {
      op: 'rate',
      date: addDays(anchorDate, -1),
      base: 'BTC',
      quote: 'USD',
      value: '60000.00',
      rateType: 'PARALLEL',
    },
  ];
  const andina = andinaCard({ anchorDate, windowStart, ops: [...flows, ...extra] });
  extra.push(...andina.ops);

  // Ticks de los runners de tiempo (decisión 3): generación al empezar cada mes y en cada fecha de creación automática.
  const tickDates = new Set<string>();
  let cursor = monthStart(windowStart);
  while (cursor <= anchorDate) {
    tickDates.add(cursor > windowStart ? cursor : windowStart);
    cursor = addMonthsClamped(cursor, 1);
  }
  for (const op of extra) if (op.op === 'occurrence' && op.action === 'auto') tickDates.add(op.date);
  for (const date of tickDates) extra.push({ op: 'tick', date, runner: 'occurrences' });
  for (const runner of ['occurrences', 'subscriptions', 'cards', 'goals'] as const) {
    extra.push({ op: 'tick', date: anchorDate, runner, late: true });
  }

  const all = [...flows, ...extra]
    .map((op, index) => ({ op, index }))
    .sort((x, y) => x.op.date.localeCompare(y.op.date) || rank(x.op) - rank(y.op) || x.index - y.index)
    .map(({ op }) => op);
  const byMonth = new Map<string, DemoOp[]>();
  for (const op of all) {
    const key = op.date.slice(0, 7);
    byMonth.set(key, [...(byMonth.get(key) ?? []), op]);
  }
  const months: DemoMonth<DemoKeys, DemoOp>[] = [...byMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, ops]) => ({ month, ops }));

  const reservedBy = (goal: 'travel' | 'laptop' | 'gifts') =>
    all.reduce((sum, op) => (op.op === 'goalMovement' && op.goal === goal ? sum + op.amount.minor : sum), 0n);
  return {
    plan: {
      datasetVersion: DEMO_MANIFEST.datasetVersion,
      anchorDate,
      startDate: at(startDate),
      institutions: INSTITUTIONS,
      accounts,
      counterparties: COUNTERPARTIES,
      tags: [
        { key: 'reembolsable', name: 'Reembolsable' },
        { key: 'hogar', name: 'Hogar compartido' },
      ],
      months,
    },
    oracle: {
      subscriptions: commitments.subscriptions,
      unresolved: commitments.unresolved,
      andina: andina.statements,
      emergencyContributions: goals.emergencyContributions,
      reserved: { travel: reservedBy('travel'), laptop: reservedBy('laptop'), gifts: reservedBy('gifts') },
    },
  };
}

/**
 * Orden estable dentro de un día: preferencias y tasas primero; altas de módulo; generación de ocurrencias; flujos
 * comunes; resoluciones de módulo; emisión de tarjetas y evaluación de metas; ediciones/anulaciones; y al final los
 * ticks tardíos de la ancla.
 */
function rank(op: DemoOp): number {
  switch (op.op) {
    case 'notificationPrefs':
      return -1;
    case 'rate':
      return 0;
    case 'subscription':
    case 'recurring':
    case 'card':
    case 'loan':
    case 'goal':
    case 'goalPlan':
      return 1;
    case 'tick':
      return op.late ? 9 : op.runner === 'occurrences' ? 2 : 5;
    case 'income':
    case 'expense':
    case 'refund':
    case 'adjustment':
    case 'transfer':
    case 'conversion':
      return 3;
    case 'edit':
    case 'void':
      return 6;
    default:
      return 4;
  }
}

/**
 * "Tarjeta Andina Demo" (design.md decisión 5): perfil con límite separado, mínimo 5.00 % con piso 50.00 BOB y pago
 * administrado desde la cuenta corriente. Cierre = día de A − 5, vencimiento = día de A + 15. El plan calcula con sus
 * propias compras el total facturado de cada estado de cuenta (congelado al emitirse, el día siguiente al cierre) y
 * paga ese total el día del vencimiento; el mes 9 de la ventana paga el 60 %. El cargador compara estos montos con
 * la expectativa del motor.
 */
function andinaCard(input: {
  readonly anchorDate: string;
  readonly windowStart: string;
  readonly ops: readonly DemoOp[];
}): { ops: DemoOp[]; statements: AndinaStatement[] } {
  const { anchorDate, windowStart } = input;
  const statementDay = dayOfMonth(addDays(anchorDate, -5));
  const dueDay = dayOfMonth(addDays(anchorDate, 15));
  const registeredOn = addDays(windowStart, 15);
  const rule = { percent: '5.00', floor: 5_000n, scale: 2 };
  const ordered = input.ops
    .map((op, index) => ({ op, index }))
    .sort((x, y) => x.op.date.localeCompare(y.op.date) || rank(x.op) - rank(y.op) || x.index - y.index)
    .map(({ op }) => op);

  // Movimientos de la cuenta (pasivo: la compra suma deuda) en el orden en que el plan los ejecuta.
  const movements: CardMovement[] = [];
  const known = new Map<string, { date: string; amount: bigint; voided: boolean }>();
  for (const op of ordered) {
    if (op.op === 'expense' && op.account === 'card' && !op.pending) {
      known.set(op.key, { date: op.date, amount: op.amount.minor, voided: false });
      movements.push({ date: op.date, execDate: op.date, delta: op.amount.minor, kind: 'purchase' });
    } else if (op.op === 'refund' && op.account === 'card') {
      movements.push({ date: op.date, execDate: op.date, delta: -op.amount.minor, kind: 'refund' });
    } else if (op.op === 'edit') {
      const prev = known.get(op.of);
      if (prev && !prev.voided) {
        movements.push({
          date: prev.date,
          execDate: op.date,
          delta: op.amount.minor - prev.amount,
          kind: 'purchase',
        });
        known.set(op.of, { ...prev, amount: op.amount.minor });
      }
    } else if (op.op === 'void') {
      const prev = known.get(op.of);
      if (prev && !prev.voided) {
        movements.push({ date: prev.date, execDate: op.date, delta: -prev.amount, kind: 'purchase' });
        known.set(op.of, { ...prev, voided: true });
      }
    } else if (
      op.op === 'occurrence' &&
      op.effect?.kind === 'expense' &&
      op.effect.account === 'card' &&
      op.action !== 'leave'
    ) {
      movements.push({ date: op.date, execDate: op.date, delta: op.effect.amount.minor, kind: 'purchase' });
    }
  }

  const partialMonth = addDays('2025-09-15', epochDay(anchorDate) - epochDay(DEMO_MANIFEST.anchorDate)).slice(
    0,
    7,
  );
  const out: DemoOp[] = [
    {
      op: 'card',
      date: registeredOn,
      key: 'andina',
      name: 'Tarjeta Andina Demo',
      accounts: [
        {
          account: 'card',
          limit: bob(1_500_000n),
          minPercent: '5.00',
          minFloor: bob(5_000n),
          payment: { from: 'bank_bob', policy: 'NO_INTEREST' },
        },
      ],
      sharedLimit: null,
      statementDay,
      dueDay,
    },
  ];
  const statements: AndinaStatement[] = [];
  for (const closing of closingsBetween(statementDay, addDays(registeredOn, -1), anchorDate)) {
    const tick = addDays(closing, 1);
    if (tick > anchorDate) break;
    out.push({ op: 'tick', date: tick, runner: 'cards' });
    const previous = addMonthsClamped(closing, -1);
    const figures = statementFigures({
      movements,
      closing,
      previousClosing: previous,
      dueDay,
      asOf: tick,
      unbilledInstallments: 0n,
      rule,
    });
    const due = cardDue(closing, dueDay);
    if (due > anchorDate || figures.billed <= 0n) {
      statements.push({ closing, due, billed: figures.billed, minimum: figures.minimum, payment: null });
      continue;
    }
    const partial = due.slice(0, 7) === partialMonth;
    const amount = partial ? scaleBy(figures.billed, 60n, 100n) : figures.billed;
    movements.push({ date: due, execDate: due, delta: -amount, kind: 'payment' });
    statements.push({ closing, due, billed: figures.billed, minimum: figures.minimum, payment: amount });
    out.push({
      op: 'occurrence',
      date: due,
      target: { type: 'cardPayment', key: 'andina', account: 'card' },
      occurrenceDate: due,
      action: 'approve',
      ...(partial ? { amount: bob(amount) } : {}),
      expectedFromPlan: bob(figures.billed),
      effect: { kind: 'transfer', from: 'bank_bob', to: 'card', amount: bob(amount) },
    });
  }
  return { ops: out, statements };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Centésimos enteros → `"6.96"`. */
function cents(hundredths: number): string {
  return `${Math.trunc(hundredths / 100)}.${String(hundredths % 100).padStart(2, '0')}`;
}

function acc(
  key: AccountKey,
  name: string,
  type: DemoAccount['type'],
  currency: DemoCurrency,
  institution: InstitutionKey | null,
  openedOn: string,
  opening: DemoMoney | null,
  reference: string,
  last4: string | null,
): DemoAccount {
  return { key, name, type, currency, institution, openedOn, opening, reference, last4 };
}

// ------------------------------------------------------------------ resumen de referencia (golden summary)

const LIABILITY: ReadonlySet<AccountKey> = new Set(['card', 'kantuta_bob', 'kantuta_usd']);

export interface PlanSummary<A extends string = string> {
  readonly datasetVersion: string;
  /** Saldo PRESENTADO por cuenta (pasivo positivo = adeudado), string decimal en la escala de su moneda. */
  readonly balances: Readonly<Record<A, string>>;
  readonly counts: {
    readonly accounts: number;
    readonly transactions: number;
    readonly pending: number;
    readonly transfers: number;
    readonly conversions: number;
    readonly rates: number;
    readonly edits: number;
    readonly voids: number;
  };
}

export type DemoSummary = PlanSummary<BalanceKey>;

/**
 * Resumen esperado del plan (oráculo del golden summary): aplica cada operación a los saldos presentados con aritmética
 * entera. Las pendientes no afectan saldos; una edición reemplaza el monto; una anulación lo revierte. Las operaciones
 * de módulo (v2) aportan su efecto en el ledger: ocurrencias resueltas, desembolsos, pagos y pagos extraordinarios.
 */
export function summarizeDemoPlan(plan: DemoPlan<DemoKeys, DemoOp>): DemoSummary {
  const loans = new Map<string, { balance: bigint; currency: DemoCurrency }>();
  const summary = summarizePlan(
    plan,
    (key) => LIABILITY.has(key as AccountKey),
    (op, ctx) => {
      switch (op.op) {
        case 'occurrence': {
          const e = op.effect;
          if (!e) return;
          ctx.counts.transactions += 1;
          if (e.kind === 'transfer') {
            ctx.counts.transfers += 1;
            ctx.add(e.from, -e.amount.minor);
            ctx.add(e.to, e.amount.minor);
          } else if (e.kind === 'expense') ctx.add(e.account, -e.amount.minor);
          else ctx.add(e.account, e.amount.minor);
          return;
        }
        case 'loan':
          ctx.counts.transactions += 1;
          ctx.add(op.account, op.principal.minor);
          loans.set(op.key, { balance: op.principal.minor, currency: op.principal.currency });
          return;
        case 'loanPayment': {
          ctx.counts.transactions += 1;
          ctx.add(op.account, -op.total.minor);
          const loan = loans.get(op.loan);
          if (loan) loan.balance -= op.principal.minor;
          return;
        }
        case 'loanPrepayment': {
          ctx.counts.transactions += 1;
          ctx.add(op.account, -op.amount.minor);
          const loan = loans.get(op.loan);
          if (loan) loan.balance -= op.amount.minor;
          return;
        }
        default:
          return;
      }
    },
  );
  const balances = { ...summary.balances } as Record<string, string>;
  for (const [key, loan] of loans) {
    balances[`loan_${key}`] = toDecimal(money(loan.balance, loan.currency));
  }
  return { ...summary, balances: balances as Record<BalanceKey, string> };
}

export interface SummaryContext<A extends string> {
  readonly add: (key: A, assetDelta: bigint) => void;
  readonly counts: {
    transactions: number;
    pending: number;
    transfers: number;
    conversions: number;
    rates: number;
    edits: number;
    voids: number;
  };
}

/** Igual que `summarizeDemoPlan` para cualquier plan; `isLiability` decide el signo del saldo presentado. */
export function summarizePlan<K extends PlanKeys, O = PlanOp<K>>(
  plan: DemoPlan<K, O>,
  isLiability: (key: K['account']) => boolean,
  extra?: (op: Exclude<O, PlanOp<K>>, ctx: SummaryContext<K['account']>) => void,
): PlanSummary<K['account']> {
  type A = K['account'];
  const balance = new Map<A, bigint>(plan.accounts.map((a) => [a.key, a.opening?.minor ?? 0n]));
  const sign = (key: A, assetDelta: bigint) => (isLiability(key) ? -assetDelta : assetDelta);
  const add = (key: A, assetDelta: bigint) =>
    balance.set(key, (balance.get(key) ?? 0n) + sign(key, assetDelta));
  const recorded = new Map<string, { account: A; delta: bigint }>();
  const counts = {
    accounts: plan.accounts.length,
    transactions: 0,
    pending: 0,
    transfers: 0,
    conversions: 0,
    rates: 0,
    edits: 0,
    voids: 0,
  };
  for (const month of plan.months) {
    for (const raw of month.ops) {
      const op = raw as unknown as PlanOp<K>;
      switch (op.op) {
        case 'rate':
          counts.rates += 1;
          break;
        case 'income':
        case 'expense': {
          counts.transactions += 1;
          if (op.pending) {
            counts.pending += 1;
            break;
          }
          const delta = op.op === 'income' ? op.amount.minor : -op.amount.minor;
          add(op.account, delta);
          recorded.set(op.key, { account: op.account, delta });
          break;
        }
        case 'refund':
          counts.transactions += 1;
          add(op.account, op.amount.minor);
          recorded.set(op.key, { account: op.account, delta: op.amount.minor });
          break;
        case 'adjustment':
          counts.transactions += 1;
          // INCREASE/DECREASE sobre el saldo presentado.
          balance.set(
            op.account,
            (balance.get(op.account) ?? 0n) +
              (op.direction === 'INCREASE' ? op.amount.minor : -op.amount.minor),
          );
          break;
        case 'transfer':
          counts.transactions += 1;
          counts.transfers += 1;
          add(op.from, -op.amount.minor);
          add(op.to, op.amount.minor);
          break;
        case 'conversion':
          counts.transactions += 1;
          counts.conversions += 1;
          add(op.from, -op.source.minor);
          add(op.to, op.target.minor);
          break;
        case 'edit': {
          counts.edits += 1;
          const prev = recorded.get(op.of);
          if (!prev) throw new Error(`edición de una operación inexistente: ${op.of}`);
          const delta = prev.delta < 0n ? -op.amount.minor : op.amount.minor;
          add(prev.account, delta - prev.delta);
          recorded.set(op.of, { account: prev.account, delta });
          break;
        }
        case 'void': {
          counts.voids += 1;
          const prev = recorded.get(op.of);
          if (!prev) throw new Error(`anulación de una operación inexistente: ${op.of}`);
          add(prev.account, -prev.delta);
          recorded.delete(op.of);
          break;
        }
        default:
          extra?.(raw as Exclude<O, PlanOp<K>>, { add, counts });
      }
    }
  }
  const currencyOf = new Map(plan.accounts.map((a) => [a.key, a.currency]));
  const balances = Object.fromEntries(
    plan.accounts.map((a) => [
      a.key,
      toDecimal(money(balance.get(a.key) ?? 0n, currencyOf.get(a.key) ?? 'BOB')),
    ]),
  ) as Record<A, string>;
  return { datasetVersion: plan.datasetVersion, balances, counts };
}
