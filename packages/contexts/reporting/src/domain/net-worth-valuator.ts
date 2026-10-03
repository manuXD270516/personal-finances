import { dec, Money, type Currency, type Decimal } from '@pf/shared-kernel';
import { convertExact, sumByCurrency, type ExactRate } from './valuation.js';

/** Cuenta valorable: saldo PRESENTADO en su moneda (pasivo positivo = adeudado, FR-LEDGER-012). */
export interface ValuedAccount {
  readonly accountId: string;
  /** Tipo canónico de la cuenta (`AccountType`). */
  readonly type: string;
  readonly nature: 'ASSET' | 'LIABILITY';
  readonly includeInNetWorth: boolean;
  readonly balance: Money;
}

export interface NetWorthByCurrency {
  readonly currency: Currency;
  readonly assets: Money;
  readonly liabilities: Money;
  readonly net: Money;
  /** Neto en la moneda de reporte sin redondear; `null` si no hay tasa (y el neto no es cero). */
  readonly converted: Decimal | null;
}

export interface NetWorthResult {
  readonly assets: Decimal;
  readonly liabilities: Decimal;
  readonly netWorth: Decimal;
  readonly complete: boolean;
  readonly byCurrency: readonly NetWorthByCurrency[];
  /** Por tipo de cuenta en la moneda de reporte (pasivos en negativo), solo lo valorado. */
  readonly byAccountType: readonly { readonly type: string; readonly amount: Decimal }[];
  /** Montos nativos no valorados por falta de tasa (neto por moneda). */
  readonly unvalued: readonly Money[];
  readonly convertedCurrencies: readonly string[];
}

/**
 * DS `NetWorthValuator` (docs/14 §4, FR-REPORTING-005), puro: NW = Σ conv_v(activos) − Σ conv_v(pasivos) de las
 * cuentas con `includeInNetWorth`. Agrega por moneda (y por tipo y moneda) ANTES de convertir, sin redondeo
 * intermedio. Una moneda sin tasa se excluye de los totales, se lista en `unvalued` y marca el resultado incompleto
 * (nunca 1:1). Transferencias entre cuentas incluidas no cambian el resultado (INV-009, INV-031).
 */
export const NetWorthValuator = {
  value(
    accounts: readonly ValuedAccount[],
    target: Currency,
    rateFor: (currency: string) => ExactRate | null,
  ): NetWorthResult {
    const included = accounts.filter((a) => a.includeInNetWorth);
    const convert = (m: Money): Decimal | null => {
      if (m.isZero() || m.currency.code === target.code) return m.toDecimal();
      const rate = rateFor(m.currency.code);
      return rate ? convertExact(m, target, rate) : null;
    };
    let assets = dec('0');
    let liabilities = dec('0');
    const byCurrency: NetWorthByCurrency[] = [];
    const unvalued: Money[] = [];
    const converted: string[] = [];
    for (const total of sumByCurrency(included.map((a) => a.balance))) {
      const ccy = total.currency;
      const of = (nature: ValuedAccount['nature']) =>
        Money.sum(
          included
            .filter((a) => a.nature === nature && a.balance.currency.code === ccy.code)
            .map((a) => a.balance),
          ccy,
        );
      const a = of('ASSET');
      const l = of('LIABILITY');
      const net = a.subtract(l);
      const assetsValue = convert(a);
      const liabilitiesValue = convert(l);
      const netValue = convert(net);
      const valued = assetsValue !== null && liabilitiesValue !== null && netValue !== null;
      if (valued) {
        assets = assets.plus(assetsValue);
        liabilities = liabilities.plus(liabilitiesValue);
        if (ccy.code !== target.code && !(a.isZero() && l.isZero())) converted.push(ccy.code);
      } else {
        unvalued.push(net.isZero() ? a : net);
      }
      byCurrency.push({ currency: ccy, assets: a, liabilities: l, net, converted: valued ? netValue : null });
    }
    const byType = new Map<string, Money[]>();
    for (const acc of included) {
      const signed = acc.nature === 'LIABILITY' ? acc.balance.negate() : acc.balance;
      byType.set(acc.type, [...(byType.get(acc.type) ?? []), signed]);
    }
    const byAccountType: { type: string; amount: Decimal }[] = [];
    for (const [type, amounts] of byType) {
      let amount = dec('0');
      let any = false;
      for (const sum of sumByCurrency(amounts)) {
        const v = convert(sum);
        if (v === null) continue;
        amount = amount.plus(v);
        any = true;
      }
      if (any) byAccountType.push({ type, amount });
    }
    return {
      assets,
      liabilities,
      netWorth: assets.minus(liabilities),
      complete: unvalued.length === 0,
      byCurrency,
      byAccountType,
      unvalued,
      convertedCurrencies: converted,
    };
  },
} as const;
