import { fail, recordOf, uuidOf, type NotificationPlan } from './type-catalog.js';
import { currencyOf, instantOf, zoneOf, type IntakeTypeDefinition } from './fx-rate-notifications.js';

/**
 * Aviso de riesgo de exceder un presupuesto (openspec add-budget-overrun-risk, decisión 8; D478, D484). NOTIFY lo recibe
 * por el puerto síncrono `NotificationIntakePort` desde el paso de avisos de `reporting.cash-flow-watch`, SIN consumidor
 * de eventos (no hay cola `events.notifications.*` ni conexiones nuevas). La regla (primera vez que una línea pasa a
 * «probable» y no cruzó el 100 %) la decide REPORTING; el riesgo «posible» nunca avisa (D484). Va DESACTIVADO por omisión
 * en los dos canales (`defaultTypePreference`). Los textos hablan de ritmo y fecha estimada, nunca de certeza (RISK-015);
 * el email sin opt-in no lleva montos ni nombres.
 */
export const BUDGET_OVERRUN_RISK_MESSAGE_KEY = 'notifications.budget_overrun_risk.v1';

const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DECIMAL = /^\d+(\.\d+)?$/;
const PERIOD_LABEL = /^\d{4}-(0[1-9]|1[0-2])$/;
const BASES = ['RUN_RATE', 'FORECAST'] as const;

function localDateOf(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  return typeof value === 'string' && LOCAL_DATE.test(value) && !Number.isNaN(Date.parse(value))
    ? value
    : fail(key);
}

function moneyOf(source: Record<string, unknown>, key: string) {
  const money = recordOf(source[key], key);
  const amount = money['amount'];
  if (typeof amount !== 'string' || !DECIMAL.test(amount)) return fail(`${key}.amount`);
  return { amount, currency: currencyOf(money, 'currency') };
}

const BUDGET_OVERRUN_RISK: IntakeTypeDefinition = {
  type: 'BUDGET_OVERRUN_RISK',
  // Como el umbral de presupuesto (docs/33 D89): todo miembro activo puede leer presupuestos, VIEWER incluido.
  recipients: ['OWNER', 'EDITOR', 'VIEWER'],
  plan(payload, factKey): NotificationPlan {
    const p = recordOf(payload, 'payload');
    const periodId = uuidOf(p, 'periodId');
    const budgetId = uuidOf(p, 'budgetId');
    const budgetLineId = uuidOf(p, 'budgetLineId');
    if (factKey !== `budget-risk:${periodId}:${budgetLineId}`) fail('factKey');
    const periodLabel = p['periodLabel'];
    if (typeof periodLabel !== 'string' || !PERIOD_LABEL.test(periodLabel)) fail('periodLabel');
    const target = recordOf(p['target'], 'target');
    const kind = target['kind'];
    if (kind !== 'CATEGORY' && kind !== 'GROUP') fail('target.kind');
    const targetId = uuidOf(target, 'id');
    const name = target['name'];
    if (typeof name !== 'string' || name.length === 0 || name.length > 200) fail('target.name');
    const projected = moneyOf(p, 'projected');
    const reference = moneyOf(p, 'reference');
    if (projected.currency !== reference.currency) fail('currency');
    const basis = p['basis'];
    if (!(BASES as readonly unknown[]).includes(basis)) fail('basis');
    const estimatedDate = p['estimatedDate'] === null ? null : localDateOf(p, 'estimatedDate');
    return {
      type: 'BUDGET_OVERRUN_RISK',
      // Una notificación por línea y periodo, aunque el riesgo baje y vuelva a subir.
      dedupeKey: `BUDGET_OVERRUN_RISK:${periodId}:${budgetLineId}`,
      severity: 'WARNING',
      messageKey: BUDGET_OVERRUN_RISK_MESSAGE_KEY,
      params: {
        periodId,
        periodLabel: periodLabel as string,
        budgetId,
        budgetLineId,
        targetKind: kind as 'CATEGORY' | 'GROUP',
        targetId,
        targetName: name as string,
        projected,
        reference,
        estimatedDate,
        basis: basis as 'RUN_RATE' | 'FORECAST',
        detectedAt: instantOf(p, 'detectedAt'),
        timeZone: zoneOf(p, 'timeZone'),
      },
      link: {
        kind: 'BUDGET_LINE',
        periodId,
        periodLabel: periodLabel as string,
        budgetId,
        budgetLineId,
        targetKind: kind as 'CATEGORY' | 'GROUP',
        targetId,
      },
    };
  },
};

/** Tipos de entrega directa de REPORTING (riesgo de presupuesto). */
export const BUDGET_RISK_INTAKE_CATALOG: readonly IntakeTypeDefinition[] = [BUDGET_OVERRUN_RISK];
