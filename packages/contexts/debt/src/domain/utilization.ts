import { Money, dec, type Decimal } from '@pf/shared-kernel';

/**
 * `UtilizationCalculator` y `UtilizationThresholdTracker` (openspec add-credit-cards, design decisiones 10 y 11;
 * capability `debt/credit-cards`). Puros, sin reloj ni IO; la valoración de un límite compartido (FlowValuation, sin
 * 1:1) la hace la aplicación y entrega aquí el crédito usado ya consolidado en la moneda del límite.
 */

/** Crédito usado = saldo adeudado + compras pendientes (D169); los pagos pendientes no restan; nunca negativo. */
export function creditUsed(input: { readonly presentedBalance: Money; readonly pendingOut: Money }): Money {
  const total = input.presentedBalance.add(input.pendingOut);
  return total.isNegative() ? Money.zero(total.currency) : total;
}

export interface Utilization {
  readonly limit: Money;
  readonly used: Money;
  /** `used ÷ límite × 100` con la precisión completa del decimal (los umbrales se comparan con ella). */
  readonly percent: Decimal;
  /** Presentación: 2 decimales HALF_EVEN. */
  readonly display: string;
  /** `límite − usado` (negativo ⇒ sobregirada). */
  readonly available: Money;
  readonly overdrawn: boolean;
}

export function computeUtilization(input: {
  readonly limit: Money;
  readonly used: Money;
  /** Crédito usado sin redondear (límite compartido consolidado): el porcentaje usa la precisión completa. */
  readonly usedExact?: Decimal;
}): Utilization {
  const { limit, used } = input;
  const percent = (input.usedExact ?? used.toDecimal()).mul(100).div(limit.toDecimal());
  const available = limit.subtract(used);
  return {
    limit,
    used,
    percent,
    display: percent.toDecimalPlaces(2, 6 /* ROUND_HALF_EVEN */).toFixed(2),
    available,
    overdrawn: available.isNegative(),
  };
}

export interface ThresholdState {
  /** Porcentaje con 2 decimales (`30.00`). */
  readonly threshold: string;
  readonly armed: boolean;
  /** Cruces acumulados del umbral. */
  readonly crossingNo: number;
}

export interface ThresholdEvaluation {
  readonly states: readonly ThresholdState[];
  /** Un cruce por cada umbral que pasó de armado a alcanzado en este cambio. */
  readonly crossings: readonly { readonly threshold: string; readonly crossingNo: number }[];
  /** El hecho a publicar: el umbral más alto cruzado y los demás cruzados en el mismo cambio; `null` si ninguno. */
  readonly event: {
    readonly threshold: string;
    readonly alsoCrossed: readonly string[];
    readonly crossingNo: number;
  } | null;
}

const byThreshold = (a: { threshold: string }, b: { threshold: string }) =>
  dec(a.threshold).comparedTo(dec(b.threshold));

/**
 * Estado inicial de un alta o de un umbral nuevo sin disparar: armado si la utilización aún no lo alcanza (o si no
 * puede calcularse), desarmado si ya lo alcanzó.
 */
export function initialThresholdStates(
  thresholds: readonly string[],
  percent: Decimal | null,
): ThresholdState[] {
  return thresholds
    .map((threshold) => ({
      threshold,
      armed: percent === null ? true : percent.lt(dec(threshold)),
      crossingNo: 0,
    }))
    .sort(byThreshold);
}

/**
 * Evaluación (decisión 11): un umbral armado con `utilización >= umbral` se desarma, suma un cruce y entra en el hecho
 * (el más alto como principal, los demás en `alsoCrossed`); uno desarmado con `utilización < umbral` se rearma sin
 * evento. Sin utilización calculable (falta de tasa) no se evalúa nada.
 */
export function evaluateThresholds(
  states: readonly ThresholdState[],
  percent: Decimal | null,
): ThresholdEvaluation {
  if (percent === null) return { states: [...states].sort(byThreshold), crossings: [], event: null };
  const crossings: { threshold: string; crossingNo: number }[] = [];
  const next = [...states].sort(byThreshold).map((state): ThresholdState => {
    const level = dec(state.threshold);
    if (state.armed && percent.gte(level)) {
      const crossingNo = state.crossingNo + 1;
      crossings.push({ threshold: state.threshold, crossingNo });
      return { threshold: state.threshold, armed: false, crossingNo };
    }
    if (!state.armed && percent.lt(level)) {
      return { threshold: state.threshold, armed: true, crossingNo: state.crossingNo };
    }
    return state;
  });
  const highest = crossings.at(-1);
  return {
    states: next,
    crossings,
    event: highest
      ? {
          threshold: highest.threshold,
          alsoCrossed: crossings.slice(0, -1).map((c) => c.threshold),
          crossingNo: highest.crossingNo,
        }
      : null,
  };
}
