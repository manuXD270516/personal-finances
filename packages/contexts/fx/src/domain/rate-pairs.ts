import { DomainError } from '@pf/shared-kernel';
import type { CurrencyKind, FxRateType } from './fx-types.js';

/**
 * Clase de activo de una moneda para los pares de tasa automáticos y el umbral de anomalía (D227, D228): fiat,
 * estable (una cripto en `FX_STABLECOIN_CODES`, hoy USDT) o cripto volátil. Las clases `COMMODITY` y `CUSTOM` no tienen
 * pares automáticos hasta los changes 42 y 43 (D221) y cuentan como fiat para el umbral.
 */
export const FX_ASSET_CLASSES = ['FIAT', 'STABLE', 'VOLATILE_CRYPTO'] as const;
export type AssetClass = (typeof FX_ASSET_CLASSES)[number];

/** Moneda pivote de los pares cripto (D227): toda cripto volátil se cotiza frente a USDT. */
export const CRYPTO_PIVOT_CURRENCY = 'USDT';
export const DEFAULT_STABLECOIN_CODES: readonly string[] = [CRYPTO_PIVOT_CURRENCY];
/** Máximo de pares automáticos por workspace (contrato `FxRatePairListInput`). */
export const MAX_RATE_PAIRS = 50;

/** Moneda tal como la ve la política de clases: código y tipo del catálogo global. */
export interface CurrencyRef {
  readonly code: string;
  readonly kind: CurrencyKind;
}

/**
 * `AssetClassPolicy` (puro): fiat del catálogo ⇒ `FIAT`; `CRYPTO` con código en `FX_STABLECOIN_CODES` ⇒ `STABLE`; el
 * resto de las criptos ⇒ `VOLATILE_CRYPTO`.
 */
export class AssetClassPolicy {
  private readonly stable: ReadonlySet<string>;

  constructor(stableCodes: readonly string[] = DEFAULT_STABLECOIN_CODES) {
    this.stable = new Set(stableCodes);
  }

  get stableCodes(): readonly string[] {
    return [...this.stable];
  }

  classOf(currency: CurrencyRef): AssetClass {
    if (currency.kind !== 'CRYPTO') return 'FIAT';
    return this.stable.has(currency.code) ? 'STABLE' : 'VOLATILE_CRYPTO';
  }

  isVolatileCrypto(currency: CurrencyRef): boolean {
    return this.classOf(currency) === 'VOLATILE_CRYPTO';
  }
}

/** Par de tasa automático: 1 `base` = X `quote`. */
export interface RatePair {
  readonly base: string;
  readonly quote: string;
}

export const pairKey = (p: RatePair): string => `${p.base}/${p.quote}`;

const byCode = (a: RatePair, b: RatePair) => (a.base < b.base ? -1 : a.base > b.base ? 1 : 0);

/**
 * DS `DefaultRatePairs` (D220 + D227, puro): la lista por defecto de un workspace derivada de sus monedas habilitadas.
 *   - cada moneda fiat o estable habilitada, distinta de la base, frente a la moneda base (USD/BOB, USDT/BOB);
 *   - cada cripto volátil habilitada frente a USDT (BTC/USDT);
 *   - y, si hay algún par contra USDT, USDT frente a la moneda base (pivote necesario para valorar en BOB).
 * `baseCurrency = null` (procesos de solo valoración sin la moneda base): solo los pares cripto contra USDT, que no la
 * necesitan. Orden determinista: fiat y estables por código y luego las cripto volátiles por código.
 */
export function defaultRatePairs(input: {
  readonly enabled: readonly CurrencyRef[];
  readonly baseCurrency: string | null;
  readonly policy: AssetClassPolicy;
}): RatePair[] {
  const { baseCurrency, policy } = input;
  const seen = new Set<string>();
  const anchored: RatePair[] = [];
  const volatile: RatePair[] = [];
  const add = (list: RatePair[], pair: RatePair) => {
    if (pair.base === pair.quote || seen.has(pairKey(pair))) return;
    seen.add(pairKey(pair));
    list.push(pair);
  };
  for (const currency of input.enabled) {
    if (currency.code === baseCurrency) continue;
    const cls = policy.classOf(currency);
    if (cls === 'VOLATILE_CRYPTO') {
      add(volatile, { base: currency.code, quote: CRYPTO_PIVOT_CURRENCY });
    } else if (baseCurrency !== null && (currency.kind === 'FIAT' || cls === 'STABLE')) {
      add(anchored, { base: currency.code, quote: baseCurrency });
    }
  }
  if (baseCurrency !== null && volatile.length > 0) {
    add(anchored, { base: CRYPTO_PIVOT_CURRENCY, quote: baseCurrency });
  }
  return [...anchored.sort(byCode), ...volatile.sort(byCode)];
}

/**
 * Tipo de tasa de un par SIN preferencia (D226, fx/market-rates): `MARKET` si la moneda base del par es una criptomoneda
 * volátil cotizada frente a una estable (BTC/USDT, en cualquier orientación) y `PARALLEL` en los demás casos.
 */
export function defaultRateTypeFor(
  a: string,
  b: string,
  classOf: (code: string) => AssetClass | null,
): FxRateType {
  const ca = classOf(a);
  const cb = classOf(b);
  if ((ca === 'VOLATILE_CRYPTO' && cb === 'STABLE') || (cb === 'VOLATILE_CRYPTO' && ca === 'STABLE')) {
    return 'MARKET';
  }
  return 'PARALLEL';
}

export type RatePairMode = 'DEFAULT' | 'CUSTOM';

export interface RatePairListState {
  readonly mode: RatePairMode;
  /** Solo en `CUSTOM`; vacío en `DEFAULT` (la lista se deriva en cada lectura). */
  readonly pairs: readonly RatePair[];
  /** ETag / `If-Match`; `1` mientras el workspace nunca fijó su lista. */
  readonly version: number;
}

/** Contexto de validación de una lista nueva: moneda base, monedas habilitadas y catálogo activo del workspace. */
export interface RatePairValidationContext {
  readonly baseCurrency: string;
  readonly enabledCodes: ReadonlySet<string>;
  readonly catalogCodes: ReadonlySet<string>;
}

/**
 * AR `RatePairList` (D220, D230, D250): la lista de pares automáticos del workspace, sin máquina de estados (solo
 * auditoría). `DEFAULT` = se deriva con `defaultRatePairs`; `CUSTOM` = lista explícita validada: moneda base habilitada
 * (`CURRENCY_NOT_ENABLED`), moneda quote = moneda base del workspace o USDT, base ≠ quote, sin repetidos y como máximo
 * 50 (`VALIDATION_FAILED`). Quitar un par no toca su histórico: la lista solo decide qué se registra de ahora en
 * adelante.
 */
export class RatePairList {
  private constructor(private readonly state: RatePairListState) {
    Object.freeze(this);
  }

  /** Workspace que nunca fijó su lista: `DEFAULT`, versión 1. */
  static defaults(): RatePairList {
    return new RatePairList({ mode: 'DEFAULT', pairs: [], version: 1 });
  }

  static rehydrate(state: RatePairListState): RatePairList {
    return new RatePairList({ ...state, pairs: [...state.pairs] });
  }

  get mode(): RatePairMode {
    return this.state.mode;
  }
  get version(): number {
    return this.state.version;
  }
  get snapshot(): RatePairListState {
    return this.state;
  }

  /** Lista efectiva: la explícita (`CUSTOM`) o la derivada de las monedas habilitadas (`DEFAULT`). */
  effective(derivedDefault: readonly RatePair[]): RatePair[] {
    return this.state.mode === 'CUSTOM' ? [...this.state.pairs] : [...derivedDefault];
  }

  /**
   * Lista nueva (`version + 1`): `DEFAULT` borra la lista explícita; `CUSTOM` guarda la indicada tras validarla. Un
   * error deja la lista y su versión intactas (el agregado es inmutable).
   */
  replace(
    input: { readonly mode: RatePairMode; readonly pairs?: readonly RatePair[] },
    context: RatePairValidationContext,
  ): RatePairList {
    const version = this.state.version + 1;
    if (input.mode === 'DEFAULT') return new RatePairList({ mode: 'DEFAULT', pairs: [], version });
    if (input.mode !== 'CUSTOM') {
      throw new DomainError('VALIDATION_FAILED', 'mode must be DEFAULT or CUSTOM').at('/mode');
    }
    const pairs = input.pairs ?? [];
    validatePairs(pairs, context);
    return new RatePairList({
      mode: 'CUSTOM',
      pairs: pairs.map((p) => ({ base: p.base, quote: p.quote })),
      version,
    });
  }
}

function validatePairs(pairs: readonly RatePair[], context: RatePairValidationContext): void {
  if (pairs.length > MAX_RATE_PAIRS) {
    throw new DomainError('VALIDATION_FAILED', `at most ${MAX_RATE_PAIRS} pairs are allowed`).at('/pairs');
  }
  const seen = new Set<string>();
  // Primero la forma (quote, repetidos) y después la habilitación: un BTC/USD siempre es `VALIDATION_FAILED`.
  for (const [i, p] of pairs.entries()) {
    if (p.base === p.quote) {
      throw new DomainError('VALIDATION_FAILED', 'base and quote must differ').at(`/pairs/${i}/quote`);
    }
    if (p.quote !== context.baseCurrency && p.quote !== CRYPTO_PIVOT_CURRENCY) {
      throw new DomainError(
        'VALIDATION_FAILED',
        `quote must be the workspace base currency (${context.baseCurrency}) or ${CRYPTO_PIVOT_CURRENCY}`,
      ).at(`/pairs/${i}/quote`);
    }
    const key = pairKey(p);
    if (seen.has(key)) throw new DomainError('VALIDATION_FAILED', `duplicate pair ${key}`).at(`/pairs/${i}`);
    seen.add(key);
  }
  for (const [i, p] of pairs.entries()) {
    if (!context.catalogCodes.has(p.base) || !context.enabledCodes.has(p.base)) {
      throw new DomainError('CURRENCY_NOT_ENABLED', `currency ${p.base} is not enabled`).at(
        `/pairs/${i}/base`,
      );
    }
  }
}
