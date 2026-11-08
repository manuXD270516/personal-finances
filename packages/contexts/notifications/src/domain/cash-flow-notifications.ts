import { fail, recordOf, type NotificationPlan } from './type-catalog.js';
import {
  currencyOf,
  factKeyOf,
  instantOf,
  monthLabelIn,
  signedDecimalOf,
  zoneOf,
  type IntakeTypeDefinition,
} from './fx-rate-notifications.js';

/**
 * Riesgo de déficit del calendario de flujo de caja (openspec add-cash-flow-forecast; D381, D382, D386). NOTIFY lo recibe
 * por el puerto síncrono `NotificationIntakePort` desde el job `reporting.cash-flow-watch`, SIN consumidor de eventos (no
 * hay cola `events.notifications.*` ni conexiones nuevas). Aquí solo se traduce el hecho; la regla (episodio abierto con
 * riesgo `HIGH`) la decide REPORTING. El cierre del episodio no notifica (D380).
 */
export const CASH_FLOW_SHORTFALL_RISK_MESSAGE_KEY = 'notifications.cash_flow_shortfall_risk.v1';

const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DECIMAL = /^\d+(\.\d+)?$/;

function localDateOf(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  return typeof value === 'string' && LOCAL_DATE.test(value) && !Number.isNaN(Date.parse(value))
    ? value
    : fail(key);
}

function moneyOf(source: Record<string, unknown>, key: string, signed: boolean) {
  const money = recordOf(source[key], key);
  const amount = signed ? signedDecimalOf(money, 'amount') : money['amount'];
  if (typeof amount !== 'string' || !(signed || DECIMAL.test(amount))) return fail(`${key}.amount`);
  return { amount, currency: currencyOf(money, 'currency') };
}

const CASH_FLOW_SHORTFALL_RISK: IntakeTypeDefinition = {
  type: 'CASH_FLOW_SHORTFALL_RISK',
  // Alerta accionable: OWNER y EDITOR (el VIEWER la ve en la tarjeta Q8 del Home; D382).
  recipients: ['OWNER', 'EDITOR'],
  plan(payload, factKey): NotificationPlan {
    const episodeId = factKeyOf(factKey);
    const p = recordOf(payload, 'payload');
    if (p['episodeId'] !== episodeId) fail('episodeId');
    const detectedAt = instantOf(p, 'detectedAt');
    const timeZone = zoneOf(p, 'timeZone');
    const currency = currencyOf(p, 'currency');
    const horizonDays = p['horizonDays'];
    if (!Number.isInteger(horizonDays) || (horizonDays as number) < 1) fail('horizonDays');
    if (typeof p['belowZero'] !== 'boolean') fail('belowZero');
    const lowest = moneyOf(p, 'lowest', true);
    const threshold = moneyOf(p, 'threshold', false);
    if (lowest.currency !== currency || threshold.currency !== currency) fail('currency');
    return {
      type: 'CASH_FLOW_SHORTFALL_RISK',
      dedupeKey: `CASH_FLOW_SHORTFALL_RISK:${episodeId}`,
      // Crítica si el saldo más bajo es negativo; advertencia si solo queda bajo la reserva mínima.
      severity: p['belowZero'] === true ? 'CRITICAL' : 'WARNING',
      messageKey: CASH_FLOW_SHORTFALL_RISK_MESSAGE_KEY,
      params: {
        episodeId,
        currency,
        horizonDays: horizonDays as number,
        firstShortfallDate: localDateOf(p, 'firstShortfallDate'),
        lowest,
        lowestDate: localDateOf(p, 'lowestDate'),
        threshold,
        belowZero: p['belowZero'] as boolean,
        detectedAt,
        timeZone,
      },
      link: {
        kind: 'CASH_FLOW_CALENDAR',
        currency,
        horizonDays: horizonDays as number,
        periodId: episodeId,
        periodLabel: monthLabelIn(detectedAt, timeZone),
      },
    };
  },
};

/** Tipos de entrega directa de REPORTING. */
export const CASH_FLOW_INTAKE_CATALOG: readonly IntakeTypeDefinition[] = [CASH_FLOW_SHORTFALL_RISK];
