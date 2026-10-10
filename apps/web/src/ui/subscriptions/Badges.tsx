import { formatDecimal } from '../AuditHistory';
import type { Money } from '../common/types';
import { formatMoney } from '../dashboard/format';
import type { FormatContext } from '../dashboard/types';
import { Badge } from '../recurring/Badges';
import { OUTCOME_PRESENTATION, STATUS_PRESENTATION, formatPercent } from './logic';
import type { ChargeOutcome, SubscriptionBillingCycle, SubscriptionStatus } from './types';

/** Estado de la suscripción con TEXTO + ICONO (NFR-USAB-104): Prueba, Activa, Pausada, Cancelada. */
export function SubscriptionStatusBadge({ status, f }: { status: SubscriptionStatus; f: FormatContext }) {
  return (
    <Badge
      presentation={STATUS_PRESENTATION[status]}
      label={f.t(`status.${status}`)}
      status={status}
      testId="subscription-status"
    />
  );
}

/** Resultado de la detección de un cargo (dentro de la tolerancia, cambio de precio detectado, no comparable). */
export function ChargeOutcomeBadge({ outcome, f }: { outcome: ChargeOutcome; f: FormatContext }) {
  return (
    <Badge
      presentation={OUTCOME_PRESENTATION[outcome]}
      label={f.t(`outcome.${outcome}`)}
      status={outcome}
      testId="charge-outcome"
    />
  );
}

/** "Mensual" o "Mensual (cada 2)" según el intervalo del ciclo. */
export function cycleSummary(cycle: SubscriptionBillingCycle, f: FormatContext): string {
  const name = f.t(`cadences.${cycle.cadence}`);
  return cycle.interval > 1 ? f.t('everyN', { cadence: name, interval: cycle.interval }) : name;
}

/** Monto con la escala de su moneda (los strings de la API ya la traen), p. ej. `10,99 USD`. */
export function MoneyText({ money, f, testId }: { money: Money; f: FormatContext; testId?: string }) {
  return <span {...(testId ? { 'data-testid': testId } : {})}>{formatMoney(money, f.locale)}</span>;
}

/** Variación porcentual con signo (`+20,02 %`); el signo es texto, no solo color. */
export function ChangePercent({ value, f }: { value: string; f: FormatContext }) {
  return <span data-testid="change-percent">{formatPercent(value, f.locale)}</span>;
}

/** Decimal sin moneda (tasa implícita, tolerancia) con el formato del locale. */
export const decimalText = (value: string, f: FormatContext): string => formatDecimal(value, f.locale);
