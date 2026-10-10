import { DomainError, LocalDate } from '@pf/shared-kernel';

export const MIN_REMINDER_DAYS = 1;
export const MAX_REMINDER_DAYS = 30;
export const DEFAULT_REMINDER_DAYS = 3;

export interface ReminderSettings {
  readonly enabled: boolean;
  readonly daysBefore: number;
}

export const DEFAULT_REMINDER: ReminderSettings = { enabled: true, daysBefore: DEFAULT_REMINDER_DAYS };

export function validReminder(
  input: Partial<ReminderSettings> | undefined,
  base: ReminderSettings,
): ReminderSettings {
  const daysBefore = input?.daysBefore ?? base.daysBefore;
  if (!Number.isInteger(daysBefore) || daysBefore < MIN_REMINDER_DAYS || daysBefore > MAX_REMINDER_DAYS) {
    throw new DomainError(
      'VALIDATION_FAILED',
      `daysBefore must be ${MIN_REMINDER_DAYS}..${MAX_REMINDER_DAYS}`,
    ).at('/reminder/daysBefore');
  }
  return { enabled: input?.enabled ?? base.enabled, daysBefore };
}

/**
 * Política pura de los recordatorios (FR-COMMITMENTS-016; design decisión 12): se recuerda una fecha cuando cae en la
 * ventana `[hoy, hoy + N]` evaluada con "hoy" en la zona horaria del workspace. Una fecha pasada nunca se recuerda;
 * si el job estuvo caído un día, se recupera mientras la fecha siga dentro de la ventana. La idempotencia (a lo sumo
 * una vez por suscripción y fecha) la da la clave `(suscripción, tipo, fecha)` de `subscription_reminder`.
 */
export const RenewalReminderPolicy = {
  isDue(input: {
    readonly today: LocalDate;
    readonly targetDate: string;
    readonly daysBefore: number;
  }): boolean {
    const target = LocalDate.parse(input.targetDate);
    return target.compare(input.today) >= 0 && target.compare(input.today.plusDays(input.daysBefore)) <= 0;
  },
} as const;
