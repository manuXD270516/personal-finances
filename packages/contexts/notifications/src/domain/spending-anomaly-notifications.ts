import { fail, recordOf, type NotificationPlan } from './type-catalog.js';
import { currencyOf, zoneOf, type IntakeTypeDefinition } from './fx-rate-notifications.js';

/**
 * Aviso de gastos atípicos (openspec add-spending-anomaly-detection, decisión 9; D474). NOTIFY lo recibe por el puerto
 * síncrono `NotificationIntakePort` desde el trabajo diario `forecasting.schedule`, SIN consumidor de eventos (no hay cola
 * `events.notifications.*` ni conexiones nuevas). Una notificación por pasada y destinatario (`factKey` =
 * `spending-anomalies:<fecha de la pasada>`). Es el primer tipo DESACTIVADO por omisión en los dos canales
 * (`defaultTypePreference`). Los textos nunca hablan de error ni de fraude (RISK-015); el email sin opt-in solo lleva la
 * cantidad y la fecha de la pasada.
 */
export const SPENDING_ANOMALY_MESSAGE_KEY = 'notifications.spending_anomaly.v1';

const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DECIMAL = /^\d+(\.\d+)?$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REASON_KINDS = ['CATEGORY_OUTLIER', 'COUNTERPARTY_OUTLIER', 'NEW_COUNTERPARTY_HIGH_AMOUNT'] as const;

function localDateOf(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  return typeof value === 'string' && LOCAL_DATE.test(value) && !Number.isNaN(Date.parse(value))
    ? value
    : fail(key);
}

const SPENDING_ANOMALY: IntakeTypeDefinition = {
  type: 'SPENDING_ANOMALY',
  // Revisar o descartar un gasto atípico es de quien registra: OWNER y EDITOR (el VIEWER ve la lista, pero no actúa).
  recipients: ['OWNER', 'EDITOR'],
  plan(payload, factKey): NotificationPlan {
    const key = /^spending-anomalies:\d{4}-\d{2}-\d{2}$/.test(factKey) ? factKey : fail('factKey');
    const p = recordOf(payload, 'payload');
    const passDate = localDateOf(p, 'passDate');
    if (key !== `spending-anomalies:${passDate}`) fail('passDate');
    if (typeof p['workspaceId'] !== 'string' || !UUID.test(p['workspaceId'])) fail('workspaceId');
    const count = p['count'];
    if (!Number.isInteger(count) || (count as number) < 1) fail('count');
    const top = recordOf(p['top'], 'top');
    if (typeof top['anomalyId'] !== 'string' || !UUID.test(top['anomalyId'])) fail('top.anomalyId');
    const money = recordOf(top['reportingAmount'], 'top.reportingAmount');
    const amount = money['amount'];
    if (typeof amount !== 'string' || !DECIMAL.test(amount)) return fail('top.reportingAmount.amount');
    const reasons = top['reasons'];
    if (
      !Array.isArray(reasons) ||
      reasons.length === 0 ||
      reasons.some((r) => !(REASON_KINDS as readonly unknown[]).includes(r))
    ) {
      fail('top.reasons');
    }
    return {
      type: 'SPENDING_ANOMALY',
      dedupeKey: `SPENDING_ANOMALY:${passDate}`,
      severity: 'INFO',
      messageKey: SPENDING_ANOMALY_MESSAGE_KEY,
      params: {
        passDate,
        count: count as number,
        top: {
          anomalyId: top['anomalyId'] as string,
          transactionDate: localDateOf(top, 'transactionDate'),
          reportingAmount: { amount, currency: currencyOf(money, 'currency') },
          reasons: reasons as string[],
        },
        timeZone: zoneOf(p, 'timeZone'),
      },
      link: {
        kind: 'SPENDING_ANOMALIES',
        // `periodId` es el id del workspace y `periodLabel` el mes de la pasada (el contrato HTTP del enlace los exige).
        periodId: p['workspaceId'] as string,
        periodLabel: passDate.slice(0, 7),
      },
    };
  },
};

/** Tipos de entrega directa de FORECAST. */
export const SPENDING_ANOMALY_INTAKE_CATALOG: readonly IntakeTypeDefinition[] = [SPENDING_ANOMALY];
