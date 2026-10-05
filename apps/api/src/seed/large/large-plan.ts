import {
  daysInMonth,
  epochDay,
  lastBusinessDay,
  monthAt,
  weekday,
  ymd,
} from '../../demo/dataset/calendar.js';
import {
  money,
  summarizePlan,
  type CategoryRef,
  type DemoAccount,
  type DemoCounterparty,
  type DemoCurrency,
  type DemoInstitution,
  type DemoMoney,
  type DemoPlan,
  type PaymentMethod,
  type PlanKeys,
  type PlanOp,
  type PlanSummary,
} from '../../demo/dataset/demo-plan.js';
import { SeededRandom } from '../../demo/dataset/prng.js';

/**
 * Large Dataset Seed v1 (docs/29 §2.3): datos 100 % FICTICIOS para performance (benchmarks nightly, NFR-PERF-001/
 * 003/004/005) y aislamiento RLS bajo carga. Un workspace principal de 5 años (2021-10-01 → 2026-09-30, ~100 000
 * transacciones, 25 cuentas, ~120 categorías, 600 contrapartes, 40 suscripciones) y 20 workspaces satélite con
 * 1 000–5 000 transacciones cada uno. Mismo modelo que el dataset Demo: plan determinista (PRNG sembrado, montos como
 * enteros de unidades mínimas, fechas sin reloj) ejecutado con los casos de uso públicos (`applyPlanOp`).
 *
 * `scale` (0 < scale ≤ 1) reduce el volumen de compras diarias y de los satélites para corridas locales rápidas; los
 * umbrales de los NFR solo valen con `scale = 1` (≥ 50 000 transacciones en el workspace principal).
 */
export const LARGE_MANIFEST = {
  profile: 'large',
  datasetVersion: '2',
  generatorVersion: '1.0.0',
  prngSeed: 20210930,
  startYear: 2021,
  startMonth: 10,
  windowMonths: 60,
  anchorDate: '2026-09-30',
  timezone: 'America/La_Paz',
  satellites: 20,
  satelliteWindowMonths: 24,
  modules: ['identity', 'classification', 'accounts', 'fx', 'transactions', 'ledger'],
} as const;

/** Workspace principal y satélites: ids fijos (prefijo `0199a000-…-0000000b…`, fuera de los de la Minimal Seed). */
export const LARGE_MAIN_WORKSPACE_ID = '0199a000-0000-7000-8000-0000000b0000';
export const largeSatelliteId = (n: number): string =>
  `0199a000-0000-7000-8000-0000000b${String(n).padStart(4, '0')}`;
/** Usuario técnico dueño de cada satélite (no existe en el realm: nadie inicia sesión con él). */
export const largeSatelliteSubject = (n: number): string =>
  `0199a000-0000-7000-8000-0000000c1${String(n).padStart(3, '0')}`;

export type LargeAnomalyKind =
  'OUTLIER' | 'DUPLICATE_CHARGE' | 'SUBSCRIPTION_PRICE_HIKE' | 'NEW_COUNTERPARTY_FRAUD' | 'P2P_RATE_JUMP';

/**
 * Anomalía inyectada con su etiqueta (docs/29 §2.3). Vive FUERA de la BD del producto: el plan la expone por clave de
 * operación (o por fecha/par para las tasas) y el seed puede exportarla como JSONL.
 */
export interface LargeAnomaly {
  readonly kind: LargeAnomalyKind;
  readonly key: string | null;
  readonly date: string;
  readonly severity: 'low' | 'medium' | 'high';
  readonly detail: string;
}

export interface LargeCategory {
  readonly name: string;
  /** Categoría del catálogo es-BO.v1 cuyo grupo hereda (las extra se crean en el mismo grupo). */
  readonly groupOf: string;
}

export interface LargeWorkspacePlan extends DemoPlan<PlanKeys> {
  readonly workspaceId: string;
  readonly name: string;
  /** `main` = owner de la Minimal Seed; `satellite-NN` = usuario técnico del satélite. */
  readonly owner: 'main' | `satellite-${string}`;
  readonly liabilities: readonly string[];
  readonly extraCategories: readonly LargeCategory[];
  readonly anomalies: readonly LargeAnomaly[];
}

export interface LargePlan {
  readonly datasetVersion: string;
  readonly scale: number;
  readonly workspaces: readonly LargeWorkspacePlan[];
}

type Op = PlanOp<PlanKeys>;
type ExpenseOp = Extract<Op, { op: 'income' | 'expense' }>;

const bob = (minor: bigint) => money(minor, 'BOB');
const usd = (minor: bigint) => money(minor, 'USD');
const usdt = (minor: bigint) => money(minor, 'USDT');
const btc = (minor: bigint) => money(minor, 'BTC');
/** Escala `minor` por `num/den` con redondeo half-up (enteros). */
const scaleBy = (minor: bigint, num: bigint, den: bigint): bigint => (minor * num * 2n + den) / (den * 2n);
const cents = (hundredths: number): string =>
  `${Math.trunc(hundredths / 100)}.${String(hundredths % 100).padStart(2, '0')}`;
const pad = (n: number, width = 3) => String(n).padStart(width, '0');

/**
 * Multiplicadores (‰) de una log-normal discretizada (μ = 0, σ ≈ 0.6) — cuantiles equiespaciados. Mantiene la cola
 * derecha sin aritmética de punto flotante sobre montos.
 */
const LOGNORMAL_PERMILLE = [
  370, 450, 510, 560, 610, 650, 700, 740, 790, 840, 890, 950, 1_010, 1_080, 1_160, 1_250, 1_370, 1_520, 1_740,
  2_150,
] as const;

// ------------------------------------------------------------------ catálogo ficticio (workspace principal)

const MAIN_INSTITUTIONS: readonly DemoInstitution<PlanKeys>[] = [
  { key: 'andino', name: 'Banco Andino Demo', kind: 'BANK' },
  { key: 'sol', name: 'Banco del Sol Demo', kind: 'BANK' },
  { key: 'illimani', name: 'Cooperativa Illimani Demo', kind: 'BANK' },
  { key: 'pacifico', name: 'Banco Pacífico Demo', kind: 'BANK' },
  { key: 'p2p', name: 'P2P Exchange Demo', kind: 'EXCHANGE' },
  { key: 'cold', name: 'Cold Wallet Demo', kind: 'WALLET_PROVIDER' },
];

type AccountType = DemoAccount['type'];
const MAIN_ACCOUNTS: readonly [string, string, AccountType, DemoCurrency, string | null, bigint][] = [
  ['bob1', 'Banco Andino Demo — Cuenta corriente', 'BANK', 'BOB', 'andino', 2_000_000n],
  ['bob2', 'Banco del Sol Demo — Cuenta corriente', 'BANK', 'BOB', 'sol', 1_000_000n],
  ['bob3', 'Cooperativa Illimani Demo — Cuenta negocio', 'BANK', 'BOB', 'illimani', 500_000n],
  ['bob4', 'Banco Pacífico Demo — Cuenta corriente', 'BANK', 'BOB', 'pacifico', 300_000n],
  ['sav1', 'Banco Andino Demo — Caja de ahorro', 'SAVINGS', 'BOB', 'andino', 5_000_000n],
  ['sav2', 'Banco del Sol Demo — Caja de ahorro', 'SAVINGS', 'BOB', 'sol', 2_000_000n],
  ['sav3', 'Cooperativa Illimani Demo — DPF', 'SAVINGS', 'BOB', 'illimani', 1_000_000n],
  ['usd1', 'Banco Andino Demo — Ahorro USD', 'SAVINGS', 'USD', 'andino', 500_000n],
  ['usd2', 'Banco del Sol Demo — Ahorro USD', 'SAVINGS', 'USD', 'sol', 200_000n],
  ['usd3', 'Banco Pacífico Demo — Cuenta USD', 'BANK', 'USD', 'pacifico', 300_000n],
  ['cash1', 'Efectivo', 'CASH', 'BOB', null, 50_000n],
  ['cash2', 'Caja chica negocio', 'CASH', 'BOB', null, 100_000n],
  ['cash3', 'Efectivo USD', 'CASH', 'USD', null, 30_000n],
  ['usdt1', 'P2P Exchange Demo — Billetera USDT', 'CRYPTO_WALLET', 'USDT', 'p2p', 500_000_000n],
  ['usdt2', 'P2P Exchange Demo — Ahorro USDT', 'CRYPTO_WALLET', 'USDT', 'p2p', 200_000_000n],
  ['usdt3', 'Cold Wallet Demo — USDT', 'CRYPTO_WALLET', 'USDT', 'cold', 0n],
  ['btc1', 'Cold Wallet BTC', 'CRYPTO_WALLET', 'BTC', 'cold', 1_000_000n],
  // Sin postings: GET /reports/summary la presenta en cero a la escala del catálogo (TC-REPORTING-NETWORTH-001,
  // regresión del CURRENCY_MISMATCH BTC(8) vs BTC(18)). BTC se habilita en el workspace antes de abrirla (docs/31 D45).
  ['btc2', 'P2P Exchange Demo — BTC', 'CRYPTO_WALLET', 'BTC', 'p2p', 0n],
  ['card1', 'Tarjeta Andina Demo', 'CREDIT_CARD', 'BOB', 'andino', 0n],
  ['card2', 'Tarjeta Sol Demo', 'CREDIT_CARD', 'BOB', 'sol', 0n],
  ['card3', 'Tarjeta Illimani Demo', 'CREDIT_CARD', 'BOB', 'illimani', 0n],
  ['card4', 'Tarjeta Pacífico Demo', 'CREDIT_CARD', 'BOB', 'pacifico', 0n],
  ['card5', 'Tarjeta Andina Demo USD', 'CREDIT_CARD', 'USD', 'andino', 0n],
  ['loan1', 'Préstamo vehicular', 'LOAN', 'BOB', 'andino', 0n],
  ['loan2', 'Préstamo de consumo', 'LOAN', 'BOB', 'sol', 0n],
];
const BOB_CARDS = ['card1', 'card2', 'card3', 'card4'] as const;
const CARD_PAYER: Readonly<Record<string, string>> = {
  card1: 'bob1',
  card2: 'bob2',
  card3: 'bob3',
  card4: 'bob4',
  card5: 'usd3',
};

/** 42 categorías extra (≈ 67 del catálogo + 11 de sistema + 42 = 120), en el grupo de una categoría existente. */
const EXTRA_CATEGORIES: readonly LargeCategory[] = [
  ...[
    'Panadería',
    'Carnicería',
    'Verdulería',
    'Frutería',
    'Bebidas',
    'Comida rápida',
    'Salteñas y tucumanas',
  ].map((name) => ({ name, groupOf: 'Restaurantes' })),
  ...['Ferretería', 'Jardinería', 'Electrodomésticos', 'Decoración', 'Lavandería', 'Cerrajería'].map(
    (name) => ({
      name,
      groupOf: 'Mantenimiento y reparaciones',
    }),
  ),
  ...['Parqueo mensual', 'Lavado de auto', 'Repuestos', 'Llantas', 'Pasajes interprovinciales'].map(
    (name) => ({
      name,
      groupOf: 'Combustible',
    }),
  ),
  ...['Laboratorio', 'Vacunas', 'Fisioterapia', 'Psicología'].map((name) => ({ name, groupOf: 'Farmacia' })),
  ...['Material escolar', 'Uniformes', 'Transporte escolar', 'Plataformas educativas'].map((name) => ({
    name,
    groupOf: 'Universidad',
  })),
  ...['Juguetes', 'Guardería', 'Veterinaria', 'Alimento para mascotas'].map((name) => ({
    name,
    groupOf: 'Mascotas',
  })),
  ...['Conciertos', 'Videojuegos', 'Libros', 'Música', 'Hobbies', 'Fotografía'].map((name) => ({
    name,
    groupOf: 'Entretenimiento',
  })),
  ...['Electrónica', 'Accesorios', 'Perfumería', 'Barbería', 'Spa', 'Joyería'].map((name) => ({
    name,
    groupOf: 'Ropa y calzado',
  })),
];

/** Compras diarias: categoría, rango de montos base (centavos BOB) y si sigue la inflación de alimentos. */
interface Spend {
  readonly category: string;
  readonly min: bigint;
  readonly max: bigint;
  readonly description: string;
  readonly food?: boolean;
  readonly weight: number;
}
const SPENDING: readonly Spend[] = [
  {
    category: 'Supermercado y minimarket',
    min: 3_000n,
    max: 25_000n,
    description: 'Súper',
    food: true,
    weight: 9,
  },
  { category: 'Mercado', min: 1_000n, max: 8_000n, description: 'Mercado', food: true, weight: 9 },
  { category: 'Restaurantes', min: 2_500n, max: 12_000n, description: 'Almuerzo', food: true, weight: 7 },
  { category: 'Cafés y snacks', min: 800n, max: 3_500n, description: 'Café', food: true, weight: 8 },
  { category: 'Delivery', min: 3_000n, max: 9_000n, description: 'Delivery', food: true, weight: 4 },
  { category: 'Minibús y micro', min: 150n, max: 600n, description: 'Pasaje', weight: 10 },
  { category: 'Teleférico', min: 300n, max: 600n, description: 'Teleférico', weight: 5 },
  { category: 'Taxi y apps de transporte', min: 1_000n, max: 4_500n, description: 'Taxi', weight: 5 },
  { category: 'Combustible', min: 8_000n, max: 25_000n, description: 'Gasolina', weight: 3 },
  { category: 'Farmacia', min: 1_500n, max: 12_000n, description: 'Farmacia', weight: 3 },
  { category: 'Ropa y calzado', min: 8_000n, max: 40_000n, description: 'Ropa', weight: 2 },
  { category: 'Entretenimiento', min: 3_000n, max: 15_000n, description: 'Cine', weight: 2 },
  { category: 'Artículos de limpieza', min: 1_500n, max: 9_000n, description: 'Limpieza', weight: 2 },
  { category: 'Peluquería', min: 3_000n, max: 9_000n, description: 'Peluquería', weight: 1 },
  { category: 'Regalos y celebraciones', min: 5_000n, max: 30_000n, description: 'Regalo', weight: 1 },
  { category: 'Útiles y libros', min: 2_000n, max: 15_000n, description: 'Útiles', weight: 1 },
  ...EXTRA_CATEGORIES.map((c) => ({
    category: c.name,
    min: 500n,
    max: 6_000n,
    description: c.name,
    weight: 1,
  })),
];
const SPENDING_BAG: readonly Spend[] = SPENDING.flatMap((s) => Array.from({ length: s.weight }, () => s));
/** Satélites: solo categorías del catálogo es-BO.v1 (no crean las extra). */
const CATALOG_SPENDING_BAG: readonly Spend[] = SPENDING_BAG.filter(
  (s) => !EXTRA_CATEGORIES.some((c) => c.name === s.category),
);

const MERCHANT_WORDS = [
  'Kantuta',
  'Sajama',
  'Illampu',
  'Chacaltaya',
  'Mururata',
  'Huayna',
  'Tunari',
  'Titicaca',
  'Uyuni',
  'Copacabana',
  'Sorata',
  'Coroico',
  'Yungas',
  'Pantanal',
  'Amboró',
] as const;
const MERCHANT_KINDS = [
  'Comercio',
  'Tienda',
  'Minimarket',
  'Restaurante',
  'Farmacia',
  'Servicios',
  'Distribuidora',
  'Café',
] as const;

/** 600 contrapartes ficticias: 560 comercios, 20 proveedores de servicios, 10 personas, 4 empleadores y 6 reservadas
 * para el fraude simulado (contrapartes nuevas que solo aparecen en la anomalía). */
function mainCounterparties(): DemoCounterparty<PlanKeys>[] {
  const list: DemoCounterparty<PlanKeys>[] = [];
  for (let i = 0; i < 560; i += 1) {
    const word = MERCHANT_WORDS[i % MERCHANT_WORDS.length];
    const kind = MERCHANT_KINDS[Math.floor(i / MERCHANT_WORDS.length) % MERCHANT_KINDS.length];
    list.push({ key: `m${pad(i)}`, name: `${kind} ${word} ${pad(i)} Demo`, kind: 'MERCHANT' });
  }
  for (let i = 0; i < 20; i += 1)
    list.push({ key: `s${pad(i)}`, name: `Servicios Altiplano ${pad(i)} Demo`, kind: 'SERVICE_PROVIDER' });
  for (let i = 0; i < 10; i += 1)
    list.push({ key: `p${pad(i)}`, name: `Persona ${pad(i)} Demo`, kind: 'PERSON' });
  for (let i = 0; i < 4; i += 1)
    list.push({ key: `e${pad(i)}`, name: `Empleador ${pad(i)} Demo SRL`, kind: 'EMPLOYER' });
  for (let i = 0; i < 6; i += 1)
    list.push({ key: `f${pad(i)}`, name: `Comercio Desconocido ${pad(i)} Demo`, kind: 'MERCHANT' });
  return list;
}

/** 40 suscripciones: 30 en USD (tarjeta USD) y 10 en BOB (tarjeta Andina). */
interface Subscription {
  readonly key: string;
  readonly name: string;
  readonly account: string;
  readonly currency: 'USD' | 'BOB';
  readonly price: bigint;
  readonly day: number;
  readonly counterparty: string;
  /** Mes (índice) desde el que el precio sube (suscripción "olvidada" que se encarece), o null. */
  readonly hikeAt: number | null;
}
function subscriptions(rng: SeededRandom): Subscription[] {
  const list: Subscription[] = [];
  for (let i = 0; i < 40; i += 1) {
    const isUsd = i < 30;
    list.push({
      key: `sub${pad(i, 2)}`,
      name: `Suscripción ${pad(i, 2)} Demo`,
      account: isUsd ? 'card5' : 'card1',
      currency: isUsd ? 'USD' : 'BOB',
      price: isUsd ? BigInt(rng.int(199, 2_999)) : BigInt(rng.int(20, 150)) * 100n,
      day: rng.int(1, 28),
      counterparty: `m${pad(500 + i)}`,
      hikeAt: i % 8 === 3 ? rng.int(12, 55) : null,
    });
  }
  return list;
}

// ------------------------------------------------------------------ generador

interface Tracker {
  readonly balances: Map<string, bigint>;
  readonly expenses: Map<string, { account: string; amount: bigint; category: CategoryRef }>;
}

/** Saldo presentado de las tarjetas (para el pago mensual), con la misma aritmética que `summarizePlan`. */
function track(t: Tracker, op: Op, liabilities: ReadonlySet<string>): void {
  const add = (account: string, assetDelta: bigint) =>
    t.balances.set(
      account,
      (t.balances.get(account) ?? 0n) + (liabilities.has(account) ? -assetDelta : assetDelta),
    );
  switch (op.op) {
    case 'income':
    case 'expense':
      if (op.pending) return;
      add(op.account, op.op === 'income' ? op.amount.minor : -op.amount.minor);
      if (op.op === 'expense')
        t.expenses.set(op.key, {
          account: op.account,
          amount: op.amount.minor,
          category: op.splits[0]!.category,
        });
      return;
    case 'refund':
      add(op.account, op.amount.minor);
      return;
    case 'transfer':
      add(op.from, -op.amount.minor);
      add(op.to, op.amount.minor);
      return;
    case 'conversion':
      add(op.from, -op.source.minor);
      add(op.to, op.target.minor);
      return;
    case 'edit': {
      const prev = t.expenses.get(op.of);
      if (!prev) throw new Error(`edición de una operación inexistente: ${op.of}`);
      add(prev.account, prev.amount - op.amount.minor);
      t.expenses.set(op.of, { ...prev, amount: op.amount.minor });
      return;
    }
    case 'void': {
      const prev = t.expenses.get(op.of);
      if (!prev) throw new Error(`anulación de una operación inexistente: ${op.of}`);
      add(prev.account, prev.amount);
      t.expenses.delete(op.of);
      return;
    }
    default:
      return;
  }
}

function rank(op: Op): number {
  return op.op === 'rate' ? 0 : op.op === 'edit' || op.op === 'void' ? 2 : 1;
}

function sortMonth(ops: Op[]): Op[] {
  return ops
    .map((op, i) => ({ op, i }))
    .sort((a, b) => a.op.date.localeCompare(b.op.date) || rank(a.op) - rank(b.op) || a.i - b.i)
    .map((x) => x.op);
}

function account(
  key: string,
  name: string,
  type: AccountType,
  currency: DemoCurrency,
  institution: string | null,
  opening: bigint,
  openedOn: string,
  reference: string,
): DemoAccount<PlanKeys> {
  return {
    key,
    name,
    type,
    currency,
    institution,
    openedOn,
    opening: opening > 0n ? money(opening, currency) : null,
    reference,
    last4: type === 'CREDIT_CARD' || type === 'BANK' ? reference.slice(-4) : null,
  };
}

function buildMainWorkspace(scale: number): LargeWorkspacePlan {
  const seed = LARGE_MANIFEST.prngSeed;
  const { startYear, startMonth, windowMonths } = LARGE_MANIFEST;
  const startDate = ymd(startYear, startMonth, 1);
  const accounts = MAIN_ACCOUNTS.map(([key, name, type, currency, inst, opening], i) =>
    account(key, name, type, currency, inst, opening, startDate, `DEMO-LRG-${pad(i + 1, 4)}`),
  );
  const liabilities = new Set(
    accounts.filter((a) => a.type === 'CREDIT_CARD' || a.type === 'LOAN').map((a) => a.key),
  );
  const tracker: Tracker = {
    balances: new Map(accounts.map((a) => [a.key, a.opening?.minor ?? 0n])),
    expenses: new Map(),
  };
  const anomalies: LargeAnomaly[] = [];

  const rates = SeededRandom.derive(seed, 'fx');
  const daily = SeededRandom.derive(seed, 'daily');
  const incomeRng = SeededRandom.derive(seed, 'income');
  const fixed = SeededRandom.derive(seed, 'fixed');
  const conv = SeededRandom.derive(seed, 'conversions');
  const anomalyRng = SeededRandom.derive(seed, 'anomalies');
  const lifecycle = SeededRandom.derive(seed, 'lifecycle');
  const subs = subscriptions(SeededRandom.derive(seed, 'subscriptions'));

  let usdBob = 696;
  let usdtBob = 690;
  let btcUsd = 45_000;
  let loan1 = 0n;
  let loan2 = 0n;
  const months: { month: string; ops: Op[] }[] = [];
  /** Compras diarias por día ≈ 44 × scale (más ~11/día de ingresos, fijos y movimientos ⇒ ~55/día a escala 1). */
  const dailyBase = Math.max(1, Math.round(44 * scale));

  for (let i = 0; i < windowMonths; i += 1) {
    const { y, m } = monthAt(startYear, startMonth, i);
    const dim = daysInMonth(y, m);
    const d = (day: number) => ymd(y, m, Math.min(Math.max(day, 1), dim));
    const k = (name: string) => `${y}-${pad(m, 2)}:${name}`;
    const ops: Op[] = [];
    const last = i === windowMonths - 1;
    const inflation = 1_000n + 4n * BigInt(i); // ‰ (+0.4 %/mes)
    const push = (op: Op) => {
      ops.push(op);
    };
    const expense = (
      key: string,
      date: string,
      acc: string,
      amount: DemoMoney,
      category: CategoryRef,
      counterparty: string | null,
      paymentMethod: PaymentMethod,
      description: string,
      extra: { pending?: boolean; split?: CategoryRef; tag?: 'reembolsable' | 'hogar' } = {},
    ): ExpenseOp => {
      const half = amount.minor / 2n;
      const splits =
        extra.split && half > 0n
          ? [
              { category, amount: money(amount.minor - half, amount.currency) },
              {
                category: extra.split,
                amount: money(half, amount.currency),
                ...(extra.tag ? { tag: extra.tag } : {}),
              },
            ]
          : [{ category, amount, ...(extra.tag ? { tag: extra.tag } : {}) }];
      return {
        op: 'expense',
        key: k(key),
        date,
        account: acc,
        amount,
        splits,
        counterparty,
        paymentMethod,
        description,
        ...(extra.pending ? { pending: true } : {}),
      };
    };

    // ── FX: paralelo semanal USD/BOB y USDT/BOB, oficial mensual y BTC/USD mensual (con saltos P2P etiquetados).
    push({ op: 'rate', date: d(1), base: 'USD', quote: 'BOB', value: '6.96', rateType: 'OFFICIAL' });
    for (const day of [1, 8, 15, 22]) {
      const jump = anomalyRng.int(0, 199) === 0;
      usdBob = Math.min(1_400, Math.max(686, usdBob + rates.int(-4, i >= 30 ? 9 : 4) + (jump ? 60 : 0)));
      usdtBob = Math.min(1_400, Math.max(686, usdtBob + rates.int(-4, i >= 30 ? 9 : 4) + (jump ? 60 : 0)));
      push({
        op: 'rate',
        date: d(day),
        base: 'USD',
        quote: 'BOB',
        value: cents(usdBob),
        rateType: 'PARALLEL',
      });
      push({
        op: 'rate',
        date: d(day),
        base: 'USDT',
        quote: 'BOB',
        value: cents(usdtBob),
        rateType: 'PARALLEL',
      });
      if (jump)
        anomalies.push({
          kind: 'P2P_RATE_JUMP',
          key: null,
          date: d(day),
          severity: 'medium',
          detail: `USDT/BOB ${cents(usdtBob)} (+0.60)`,
        });
    }
    btcUsd = Math.min(120_000, Math.max(16_000, btcUsd + rates.int(-6_000, 6_500)));
    push({ op: 'rate', date: d(1), base: 'BTC', quote: 'USD', value: String(btcUsd), rateType: 'PARALLEL' });

    // ── Préstamos: desembolsos (mes 0 y mes 24), capital fijo + interés simple mensual.
    if (i === 0) {
      push({
        op: 'transfer',
        date: d(2),
        from: 'loan1',
        to: 'bob1',
        amount: bob(8_000_000n),
        paymentMethod: 'BANK_TRANSFER',
        description: 'Desembolso préstamo vehicular',
      });
      loan1 = 8_000_000n;
    }
    if (i === 24) {
      push({
        op: 'transfer',
        date: d(2),
        from: 'loan2',
        to: 'bob2',
        amount: bob(4_000_000n),
        paymentMethod: 'BANK_TRANSFER',
        description: 'Desembolso préstamo de consumo',
      });
      loan2 = 4_000_000n;
    }
    for (const [loanKey, payer, owed, principal, rateBp] of [
      ['loan1', 'bob1', loan1, 160_000n, 75n],
      ['loan2', 'bob2', loan2, 130_000n, 110n],
    ] as const) {
      if (owed <= 0n || (loanKey === 'loan1' ? i === 0 : i <= 24)) continue;
      const pay = owed < principal ? owed : principal;
      push({
        op: 'transfer',
        date: d(3),
        from: payer,
        to: loanKey,
        amount: bob(pay),
        paymentMethod: 'BANK_TRANSFER',
        description: `Cuota ${loanKey === 'loan1' ? 'préstamo vehicular' : 'préstamo de consumo'} (capital)`,
      });
      push(
        expense(
          `${loanKey}-interest`,
          d(3),
          payer,
          bob(scaleBy(owed, rateBp, 10_000n)),
          { system: 'INTEREST' },
          's000',
          'BANK_TRANSFER',
          'Interés del préstamo',
        ),
      );
      if (loanKey === 'loan1') loan1 -= pay;
      else loan2 -= pay;
    }

    // ── Ingresos: dos sueldos (+5 % cada enero desde 2022), aguinaldo, ventas del negocio y freelance en USD.
    const raises = BigInt(y - LARGE_MANIFEST.startYear); // +5 % cada enero desde 2022
    const raise = (base: bigint) => {
      let v = base;
      for (let r = 0n; r < raises; r += 1n) v = scaleBy(v, 105n, 100n);
      return v;
    };
    for (const [n, acc, base, employer] of [
      [1, 'bob1', 3_000_000n, 'e000'],
      [2, 'bob2', 1_500_000n, 'e001'],
    ] as const) {
      const pay = raise(base);
      push({
        op: 'income',
        key: k(`salary-${n}`),
        date: lastBusinessDay(y, m),
        account: acc,
        amount: bob(pay),
        splits: [{ category: { name: 'Sueldo' }, amount: bob(pay) }],
        counterparty: employer,
        paymentMethod: 'BANK_TRANSFER',
        description: 'Sueldo',
      });
      if (m === 12)
        push({
          op: 'income',
          key: k(`bonus-${n}`),
          date: d(20),
          account: acc,
          amount: bob(pay),
          splits: [{ category: { name: 'Aguinaldo' }, amount: bob(pay) }],
          counterparty: employer,
          paymentMethod: 'BANK_TRANSFER',
          description: 'Aguinaldo',
        });
    }
    const sales = Math.max(1, Math.round(dim * 2 * scale));
    for (let s = 0; s < sales; s += 1) {
      const amount = bob(scaleBy(incomeRng.bigint(40_000n, 200_000n), inflation, 1_000n));
      push({
        op: 'income',
        key: k(`sale-${s}`),
        date: d(1 + (s % dim)),
        account: 'bob3',
        amount,
        splits: [{ category: { name: 'Ventas' }, amount }],
        counterparty: `p${pad(incomeRng.int(0, 9))}`,
        paymentMethod: 'QR',
        description: 'Ventas del día',
      });
    }
    {
      const amount = usd(incomeRng.bigint(80_000n, 150_000n));
      push({
        op: 'income',
        key: k('freelance'),
        date: d(16),
        account: 'usd3',
        amount,
        splits: [{ category: { name: 'Honorarios y freelance' }, amount }],
        counterparty: 'e002',
        paymentMethod: 'BANK_TRANSFER',
        description: 'Proyecto freelance',
      });
    }

    // ── Vivienda y servicios (estacionalidad de invierno junio–agosto en luz/gas: +25 %).
    const winter = m >= 6 && m <= 8;
    const season = (base: bigint) => (winter ? scaleBy(base, 125n, 100n) : base);
    const rentBase = 450_000n + 15_000n * BigInt(Math.floor(i / 12));
    push(
      expense('rent', d(5), 'bob1', bob(rentBase), { name: 'Alquiler' }, 'p000', 'BANK_TRANSFER', 'Alquiler'),
    );
    for (const [name, base, cp, day] of [
      ['Luz', 18_000n, 's001', 12],
      ['Agua', 8_000n, 's002', 12],
      ['Gas domiciliario', 6_000n, 's003', 13],
      ['Internet', 29_900n, 's004', 14],
      ['Telefonía móvil', 15_000n, 's005', 14],
      ['TV cable', 19_000n, 's006', 15],
    ] as const) {
      const seasonal = name === 'Luz' || name === 'Gas domiciliario';
      const amount = (seasonal ? season(base) : base) + fixed.bigint(0n, 1_500n);
      push(
        expense(
          `svc-${name}`,
          d(day),
          'bob1',
          bob(amount),
          { name },
          cp,
          'QR',
          `Factura ${name.toLowerCase()}`,
        ),
      );
    }

    // ── 40 suscripciones (algunas suben de precio sin aviso: anomalía etiquetada).
    for (const s of subs) {
      const hiked = s.hikeAt !== null && i >= s.hikeAt;
      const price = hiked ? scaleBy(s.price, 140n, 100n) : s.price;
      const op = expense(
        s.key,
        d(s.day),
        s.account,
        money(price, s.currency),
        { name: 'Suscripciones digitales' },
        s.counterparty,
        'CREDIT_CARD',
        s.name,
      );
      push(op);
      if (hiked && i === s.hikeAt)
        anomalies.push({
          kind: 'SUBSCRIPTION_PRICE_HIKE',
          key: op.key,
          date: op.date,
          severity: 'low',
          detail: `${s.name} +40 %`,
        });
    }

    // ── Movimientos: retiros de efectivo, ahorro y pagos de tarjetas (saldo del mes anterior, un mes con pago parcial).
    for (const day of [1, 8, 15, 22])
      push({
        op: 'transfer',
        date: d(day),
        from: 'bob1',
        to: 'cash1',
        amount: bob(400_000n),
        paymentMethod: 'BANK_TRANSFER',
        description: 'Retiro de efectivo',
      });
    push({
      op: 'transfer',
      date: d(2),
      from: 'bob3',
      to: 'cash2',
      amount: bob(150_000n),
      paymentMethod: 'BANK_TRANSFER',
      description: 'Caja chica',
    });
    push({
      op: 'transfer',
      date: d(26),
      from: 'bob1',
      to: 'sav1',
      amount: bob(300_000n),
      paymentMethod: 'BANK_TRANSFER',
      description: 'Ahorro mensual',
    });
    push({
      op: 'transfer',
      date: d(26),
      from: 'bob2',
      to: 'sav2',
      amount: bob(100_000n),
      paymentMethod: 'BANK_TRANSFER',
      description: 'Ahorro mensual',
    });
    if (i % 3 === 2)
      push({
        op: 'transfer',
        date: d(27),
        from: 'bob3',
        to: 'sav3',
        amount: bob(500_000n),
        paymentMethod: 'BANK_TRANSFER',
        description: 'DPF trimestral',
      });
    if (i % 6 === 5)
      push({
        op: 'transfer',
        date: d(9),
        from: 'usd1',
        to: 'cash3',
        amount: usd(20_000n),
        paymentMethod: 'CASH',
        description: 'Retiro USD',
      });
    for (const card of [...BOB_CARDS, 'card5']) {
      const owed = tracker.balances.get(card) ?? 0n;
      if (owed <= 0n) continue;
      const amount = i === 17 && card === 'card2' ? scaleBy(owed, 60n, 100n) : owed;
      push({
        op: 'transfer',
        date: d(10),
        from: CARD_PAYER[card]!,
        to: card,
        amount: money(amount, card === 'card5' ? 'USD' : 'BOB'),
        paymentMethod: 'QR',
        description: `Pago tarjeta ${card}`,
      });
    }

    // ── Conversiones: compras P2P de USDT crecientes (1 → 4 por mes), USD mensual, BTC trimestral y ventas de USDT.
    const usdtBuys = 1 + Math.min(3, Math.floor(i / 15));
    for (let c = 0; c < usdtBuys; c += 1) {
      const source = BigInt(conv.int(5, 30)) * 10_000n;
      const p2p = usdtBob + conv.int(-3, 6);
      const fee = BigInt(conv.int(2, 8)) * 100_000n;
      const gross = (source * 1_000_000n) / BigInt(p2p);
      push({
        op: 'conversion',
        date: d(18 + c),
        from: 'bob1',
        to: 'usdt1',
        source: bob(source),
        target: usdt(gross - fee),
        quoted: { base: 'USDT', quote: 'BOB', value: cents(p2p) },
        fee: { type: 'PROVIDER', amount: usdt(fee) },
        description: 'Compra P2P de USDT',
      });
    }
    {
      const source = 200_000n;
      push({
        op: 'conversion',
        date: d(24),
        from: 'bob2',
        to: 'usd1',
        source: bob(source),
        target: usd((source * 100n) / BigInt(usdBob)),
        quoted: { base: 'USD', quote: 'BOB', value: cents(usdBob) },
        fee: null,
        description: 'Ahorro en USD',
      });
    }
    if (i % 3 === 1) {
      const gross = (10_000_000_000n * 100n) / BigInt(btcUsd) / 100n; // 100 USDT → BTC (escala 8)
      push({
        op: 'conversion',
        date: d(21),
        from: 'usdt1',
        to: 'btc1',
        source: usdt(100_000_000n),
        target: btc(gross - 2_000n),
        quoted: { base: 'BTC', quote: 'USDT', value: String(btcUsd) },
        fee: { type: 'NETWORK', amount: btc(2_000n) },
        description: 'Compra de BTC',
      });
    }
    if (i % 4 === 3)
      push({
        op: 'transfer',
        date: d(23),
        from: 'usdt1',
        to: 'usdt2',
        amount: usdt(50_000_000n),
        paymentMethod: 'BANK_TRANSFER',
        description: 'Ahorro USDT',
      });
    if (i % 12 === 11)
      push({
        op: 'conversion',
        date: d(25),
        from: 'usdt2',
        to: 'bob3',
        source: usdt(100_000_000n),
        target: bob(100n * BigInt(usdtBob)),
        quoted: { base: 'USDT', quote: 'BOB', value: cents(usdtBob) },
        fee: null,
        description: 'Venta P2P de USDT',
      });

    // ── Compras diarias: estacionalidad (diciembre +40 %, febrero +15 % útiles/carnaval, invierno), fin de semana +20 %,
    //    inflación de alimentos +0.4 %/mes, montos log-normales, splits, etiquetas y anomalías etiquetadas.
    const monthFactor = m === 12 ? 140 : m === 2 ? 115 : m === 3 ? 105 : 100;
    const purchases: ExpenseOp[] = [];
    for (let day = 1; day <= dim; day += 1) {
      const date = d(day);
      const wd = weekday(date);
      const weekend = wd === 0 || wd === 6 ? 120 : 100;
      const count = Math.max(0, Math.round((dailyBase * monthFactor * weekend) / 10_000) + daily.int(-3, 3));
      for (let p = 0; p < count; p += 1) {
        const spend =
          m === 2 && daily.int(0, 9) === 0
            ? SPENDING.find((s) => s.category === 'Útiles y libros')!
            : daily.pick(SPENDING_BAG);
        let amount = daily.bigint(spend.min, spend.max);
        amount = scaleBy(amount, BigInt(daily.pick(LOGNORMAL_PERMILLE)), 1_000n);
        if (spend.food) amount = scaleBy(amount, inflation, 1_000n);
        if (amount < 100n) amount = 100n;
        const roll = daily.int(0, 99);
        const [acc, method]: [string, PaymentMethod] =
          roll < 45
            ? [BOB_CARDS[daily.int(0, 3)]!, 'CREDIT_CARD']
            : roll < 65
              ? ['cash1', 'CASH']
              : roll < 90
                ? [`bob${daily.int(1, 4)}`, 'QR']
                : ['bob2', 'DEBIT_CARD'];
        const cp = method === 'CASH' && daily.int(0, 1) === 0 ? null : `m${pad(daily.int(0, 499))}`;
        const pending = last && day > dim - 7 && daily.int(0, 99) === 0;
        const extraSplit =
          daily.int(0, 99) < 5 ? { split: { name: 'Artículos de limpieza' } as CategoryRef } : {};
        const tag =
          daily.int(0, 99) < 2
            ? { tag: daily.int(0, 1) === 0 ? ('hogar' as const) : ('reembolsable' as const) }
            : {};
        let key = `buy-${day}-${p}`;
        if (anomalyRng.int(0, 999) === 0) {
          amount = scaleBy(spend.max, BigInt(anomalyRng.int(5, 20)), 1n);
          key = `${key}-outlier`;
          anomalies.push({
            kind: 'OUTLIER',
            key: k(key),
            date,
            severity: 'high',
            detail: `${spend.category} ×${(amount / (spend.max > 0n ? spend.max : 1n)).toString()}`,
          });
        }
        const op = expense(
          key,
          date,
          acc,
          bob(amount),
          { name: spend.category },
          cp,
          method,
          spend.description,
          { ...(pending ? { pending: true } : {}), ...extraSplit, ...tag },
        );
        purchases.push(op);
        if (!pending && anomalyRng.int(0, 1_999) === 0) {
          const dup = { ...op, key: k(`${key}-dup`) };
          purchases.push(dup);
          anomalies.push({
            kind: 'DUPLICATE_CHARGE',
            key: dup.key,
            date,
            severity: 'medium',
            detail: `duplicado de ${op.key}`,
          });
        }
      }
    }
    if (anomalyRng.int(0, 9) === 0) {
      const f = `f${pad(anomalyRng.int(0, 5))}`;
      const op = expense(
        'fraud',
        d(anomalyRng.int(1, dim)),
        'card5',
        usd(anomalyRng.bigint(30_000n, 90_000n)),
        { name: 'Entretenimiento' },
        f,
        'CREDIT_CARD',
        'Cargo no reconocido',
      );
      purchases.push(op);
      anomalies.push({
        kind: 'NEW_COUNTERPARTY_FRAUD',
        key: op.key,
        date: op.date,
        severity: 'high',
        detail: `contraparte nueva ${f}`,
      });
    }
    ops.push(...purchases);

    // ── Recorridos de ciclo de vida: reembolsos (~0.3 % de las compras con tarjeta), 2 ediciones y 1 anulación al mes.
    const cardBuys = purchases.filter(
      (p) => p.account.startsWith('card') && !p.pending && p.account !== 'card5',
    );
    const refunds = Math.max(cardBuys.length > 0 ? 1 : 0, Math.round(cardBuys.length * 0.003));
    const touched = new Set<string>();
    const pickTarget = () => {
      for (let tries = 0; tries < 10 && cardBuys.length > 0; tries += 1) {
        const target = cardBuys[lifecycle.int(0, cardBuys.length - 1)]!;
        if (!touched.has(target.key)) {
          touched.add(target.key);
          return target;
        }
      }
      return null;
    };
    for (let r = 0; r < refunds; r += 1) {
      const target = pickTarget();
      if (!target) break;
      const partial = lifecycle.int(0, 1) === 0;
      const amount = partial ? target.amount.minor / 2n : target.amount.minor;
      if (amount <= 0n) continue;
      ops.push({
        op: 'refund',
        key: k(`refund-${r}`),
        date: d(Math.min(dim, Number(target.date.slice(8)) + 2)),
        of: target.key,
        account: target.account,
        amount: bob(amount),
        description: partial ? 'Reembolso parcial' : 'Reembolso',
      });
    }
    for (let e = 0; e < 2; e += 1) {
      const target = pickTarget();
      if (!target) break;
      ops.push({
        op: 'edit',
        date: d(Math.min(dim, Number(target.date.slice(8)) + 1)),
        of: target.key,
        amount: bob(target.amount.minor + 1_000n),
        category: target.splits[0]!.category,
      });
    }
    const voidTarget = pickTarget();
    if (voidTarget)
      ops.push({
        op: 'void',
        date: d(Math.min(dim, Number(voidTarget.date.slice(8)) + 1)),
        of: voidTarget.key,
        reason: 'Cargo duplicado',
      });

    const sorted = sortMonth(ops);
    for (const op of sorted) track(tracker, op, liabilities);
    // Reposición de fin de mes desde la cuenta del negocio (bob3): mantiene saldos plausibles sin números negativos.
    const topUps: Op[] = [];
    for (const acc of ['bob1', 'bob2', 'bob4', 'cash1']) {
      const balance = tracker.balances.get(acc) ?? 0n;
      if (balance < 1_000_000n)
        topUps.push({
          op: 'transfer',
          date: d(dim),
          from: 'bob3',
          to: acc,
          amount: bob(2_000_000n - balance),
          paymentMethod: acc === 'cash1' ? 'CASH' : 'BANK_TRANSFER',
          description: 'Reposición desde la cuenta del negocio',
        });
    }
    const usdBalance = tracker.balances.get('usd3') ?? 0n;
    if (usdBalance < 50_000n) {
      const target = 100_000n - usdBalance;
      topUps.push({
        op: 'conversion',
        date: d(dim),
        from: 'bob3',
        to: 'usd3',
        source: bob((target * BigInt(usdBob)) / 100n),
        target: usd(target),
        quoted: { base: 'USD', quote: 'BOB', value: cents(usdBob) },
        fee: null,
        description: 'Compra de USD para la tarjeta',
      });
    }
    for (const op of topUps) track(tracker, op, liabilities);
    months.push({ month: `${y}-${pad(m, 2)}`, ops: [...sorted, ...topUps] });
  }

  return {
    workspaceId: LARGE_MAIN_WORKSPACE_ID,
    name: 'Large — Principal',
    owner: 'main',
    datasetVersion: LARGE_MANIFEST.datasetVersion,
    anchorDate: LARGE_MANIFEST.anchorDate,
    startDate,
    institutions: MAIN_INSTITUTIONS,
    accounts,
    counterparties: mainCounterparties(),
    tags: [
      { key: 'reembolsable', name: 'Reembolsable' },
      { key: 'hogar', name: 'Hogar compartido' },
    ],
    months,
    liabilities: [...liabilities],
    extraCategories: EXTRA_CATEGORIES,
    anomalies,
  };
}

/** Satélite `n` (1..20): 3 cuentas BOB y 1 000–5 000 transacciones en los últimos 24 meses. */
function buildSatellite(n: number, scale: number): LargeWorkspacePlan {
  const rng = SeededRandom.derive(LARGE_MANIFEST.prngSeed, `satellite-${n}`);
  const total = Math.max(24, Math.round(rng.int(1_000, 5_000) * scale));
  const months: { month: string; ops: Op[] }[] = [];
  const window = LARGE_MANIFEST.satelliteWindowMonths;
  const first = monthAt(
    LARGE_MANIFEST.startYear,
    LARGE_MANIFEST.startMonth,
    LARGE_MANIFEST.windowMonths - window,
  );
  const startDate = ymd(first.y, first.m, 1);
  const ref = `DEMO-SAT-${pad(n, 2)}`;
  const accounts = [
    account(
      'bank',
      `Banco Satélite ${pad(n, 2)} Demo`,
      'BANK',
      'BOB',
      null,
      1_000_000n,
      startDate,
      `${ref}01`,
    ),
    account('cash', 'Efectivo', 'CASH', 'BOB', null, 50_000n, startDate, `${ref}02`),
    account(
      'card',
      `Tarjeta Satélite ${pad(n, 2)} Demo`,
      'CREDIT_CARD',
      'BOB',
      null,
      0n,
      startDate,
      `${ref}03`,
    ),
  ];
  const liabilities = new Set(['card']);
  const tracker: Tracker = {
    balances: new Map(accounts.map((a) => [a.key, a.opening?.minor ?? 0n])),
    expenses: new Map(),
  };
  const counterparties: DemoCounterparty<PlanKeys>[] = Array.from({ length: 20 }, (_, i) => ({
    key: `c${pad(i)}`,
    name: `Comercio Satélite ${pad(n, 2)}-${pad(i)} Demo`,
    kind: 'MERCHANT' as const,
  }));
  // ~3 operaciones fijas por mes (sueldo, retiro, pago de tarjeta) y el resto compras.
  const perMonth = Math.max(1, Math.round(total / window) - 3);
  for (let i = 0; i < window; i += 1) {
    const { y, m } = monthAt(first.y, first.m, i);
    const dim = daysInMonth(y, m);
    const d = (day: number) => ymd(y, m, Math.min(Math.max(day, 1), dim));
    const k = (name: string) => `${y}-${pad(m, 2)}:${name}`;
    const ops: Op[] = [];
    const pay = bob(BigInt(perMonth) * 6_000n + BigInt(rng.int(100, 300)) * 1_000n);
    ops.push({
      op: 'income',
      key: k('salary'),
      date: lastBusinessDay(y, m),
      account: 'bank',
      amount: pay,
      splits: [{ category: { name: 'Sueldo' }, amount: pay }],
      counterparty: null,
      paymentMethod: 'BANK_TRANSFER',
      description: 'Sueldo',
    });
    ops.push({
      op: 'transfer',
      date: d(2),
      from: 'bank',
      to: 'cash',
      amount: bob(50_000n),
      paymentMethod: 'BANK_TRANSFER',
      description: 'Retiro de efectivo',
    });
    const owed = tracker.balances.get('card') ?? 0n;
    if (owed > 0n) {
      ops.push({
        op: 'transfer',
        date: d(10),
        from: 'bank',
        to: 'card',
        amount: bob(owed),
        paymentMethod: 'QR',
        description: 'Pago de tarjeta',
      });
    }
    for (let p = 0; p < perMonth; p += 1) {
      const spend = rng.pick(CATALOG_SPENDING_BAG);
      const acc = rng.pick(['bank', 'cash', 'card'] as const);
      const amount = bob(rng.bigint(spend.min, spend.max));
      ops.push({
        op: 'expense',
        key: k(`buy-${p}`),
        date: d(rng.int(1, dim)),
        account: acc,
        amount,
        splits: [{ category: { name: spend.category }, amount }],
        counterparty: acc === 'cash' ? null : `c${pad(rng.int(0, 19))}`,
        paymentMethod: acc === 'cash' ? 'CASH' : acc === 'card' ? 'CREDIT_CARD' : 'QR',
        description: spend.description,
      });
    }
    const sorted = sortMonth(ops);
    for (const op of sorted) track(tracker, op, liabilities);
    months.push({ month: `${y}-${pad(m, 2)}`, ops: sorted });
  }
  return {
    workspaceId: largeSatelliteId(n),
    name: `Large — Satélite ${pad(n, 2)}`,
    owner: `satellite-${pad(n, 2)}`,
    datasetVersion: LARGE_MANIFEST.datasetVersion,
    anchorDate: LARGE_MANIFEST.anchorDate,
    startDate,
    institutions: [],
    accounts,
    counterparties,
    tags: [],
    months,
    liabilities: [...liabilities],
    extraCategories: [],
    anomalies: [],
  };
}

/** Plan completo del Large Seed (mismo `scale` ⇒ mismo plan, bit a bit). */
export interface LargePlanOptions {
  readonly scale?: number;
  /** Solo pruebas rápidas: conserva los primeros N meses de cada workspace (los saldos siguen siendo coherentes). */
  readonly months?: number;
  /** Solo pruebas rápidas: cantidad de satélites (por defecto 20). */
  readonly satellites?: number;
}

export function buildLargePlan(options: LargePlanOptions = {}): LargePlan {
  const scale = options.scale ?? 1;
  if (!(scale > 0 && scale <= 1)) throw new RangeError(`scale fuera de rango (0, 1]: ${scale}`);
  const count = options.satellites ?? LARGE_MANIFEST.satellites;
  if (!Number.isInteger(count) || count < 0 || count > LARGE_MANIFEST.satellites)
    throw new RangeError(`satellites fuera de rango [0, ${LARGE_MANIFEST.satellites}]: ${count}`);
  const satellites = Array.from({ length: count }, (_, i) => buildSatellite(i + 1, scale));
  const trim = (ws: LargeWorkspacePlan): LargeWorkspacePlan =>
    options.months === undefined ? ws : { ...ws, months: ws.months.slice(0, options.months) };
  return {
    datasetVersion: LARGE_MANIFEST.datasetVersion,
    scale,
    workspaces: [buildMainWorkspace(scale), ...satellites].map(trim),
  };
}

/** Resumen esperado de un workspace del plan (saldos presentados y conteos), oráculo de la verificación tras cargar. */
export function summarizeLargeWorkspace(ws: LargeWorkspacePlan): PlanSummary {
  const liabilities = new Set(ws.liabilities);
  return summarizePlan(ws, (key) => liabilities.has(key));
}

/** Etiquetas de anomalías en JSONL (docs/29 §2.3: `seeds/large/labels/anomalies.v<N>.jsonl`), fuera de la BD. */
export function anomaliesJsonl(
  plan: LargePlan,
  transactionIds: ReadonlyMap<string, string> = new Map(),
): string {
  return plan.workspaces
    .flatMap((ws) =>
      ws.anomalies.map((a) =>
        JSON.stringify({
          workspaceId: ws.workspaceId,
          key: a.key,
          transactionId: a.key ? (transactionIds.get(`${ws.workspaceId}/${a.key}`) ?? null) : null,
          kind: a.kind,
          injectedAt: a.date,
          severity: a.severity,
          detail: a.detail,
        }),
      ),
    )
    .join('\n');
}

/** Días transcurridos de la ventana (para los tests). */
export const largeWindowDays = (): number =>
  epochDay(LARGE_MANIFEST.anchorDate) -
  epochDay(ymd(LARGE_MANIFEST.startYear, LARGE_MANIFEST.startMonth, 1)) +
  1;
