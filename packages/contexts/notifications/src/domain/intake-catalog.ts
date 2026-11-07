import { DomainError } from '@pf/shared-kernel';
import { CASH_FLOW_INTAKE_CATALOG } from './cash-flow-notifications.js';
import { FX_INTAKE_CATALOG, type IntakeTypeDefinition } from './fx-rate-notifications.js';

/**
 * Tipos de entrega directa (`NotificationIntakePort`): las alertas de tasas de FX (add-rate-feed-alerts) y el riesgo de
 * déficit de REPORTING (add-cash-flow-forecast). Ninguno es un consumidor de eventos: NO se registran colas
 * `events.notifications.*` por ellos (D249; presupuesto de conexiones del worker).
 */
export const NOTIFICATION_INTAKE_CATALOG: readonly IntakeTypeDefinition[] = [
  ...FX_INTAKE_CATALOG,
  ...CASH_FLOW_INTAKE_CATALOG,
];

export function intakeDefinitionOf(type: string): IntakeTypeDefinition {
  const definition = NOTIFICATION_INTAKE_CATALOG.find((d) => d.type === type);
  if (!definition) throw new DomainError('VALIDATION_FAILED', `unknown intake notification type ${type}`);
  return definition;
}
