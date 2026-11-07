import { DomainError } from '@pf/shared-kernel';
import { isDigestFrequency, type DigestFrequencyValue } from './home-digest.js';
import { QuietHours } from './quiet-hours.js';
import {
  NOTIFICATION_CHANNELS,
  NOTIFICATION_TYPES,
  isNotificationType,
  type NotificationChannel,
  type NotificationType,
} from './types.js';

/** Preferencia de un tipo: un booleano por canal. */
export interface TypePreference {
  readonly inApp: boolean;
  readonly email: boolean;
}

export interface PreferencesState {
  readonly userId: string;
  readonly workspaceId: string;
  /** Solo los tipos con fila explícita; la ausencia equivale a "activado" (docs/33 D88). */
  readonly byType: Readonly<Partial<Record<NotificationType, TypePreference>>>;
  readonly quietHours: { readonly start: string; readonly end: string } | null;
  readonly includeDetailsInEmail: boolean;
  /** Frecuencia del digest del Home por email (add-cash-flow-forecast, D385): desactivado por omisión. */
  readonly digestFrequency: DigestFrequencyValue;
  /** ETag de las preferencias; sin fila de ajustes es la versión 1 y se persiste al primer cambio. */
  readonly version: number;
}

export interface PreferencesChange {
  /** Campo auditado (`byType.<TIPO>.<canal>`, `quietHours`, `includeDetailsInEmail`, `digestFrequency`). */
  readonly field: string;
  readonly before: unknown;
  readonly after: unknown;
}

export interface PreferencesInput {
  readonly types: readonly { readonly type: string; readonly inApp: boolean; readonly email: boolean }[];
  readonly quietHours: { readonly start: string; readonly end: string } | null;
  readonly includeDetailsInEmail: boolean;
  /** Ausente = sin cambio; un valor fuera de `OFF | WEEKLY | MONTHLY` se rechaza (`VALIDATION_FAILED`). */
  readonly digestFrequency?: string | undefined;
}

/**
 * AR `NotificationPreferences` (una por usuario y workspace; design decisión 10). Por defecto ambos canales activos
 * en todos los tipos, sin horario de silencio y sin detalles en el email (docs/33 D88, FR-NOTIFY-006).
 */
export class NotificationPreferences {
  private constructor(
    private state: PreferencesState,
    /** Versión persistida (0 = sin fila de ajustes: el primer guardado la crea). */
    readonly persistedVersion: number,
  ) {}

  static defaults(userId: string, workspaceId: string): NotificationPreferences {
    return new NotificationPreferences(
      {
        userId,
        workspaceId,
        byType: {},
        quietHours: null,
        includeDetailsInEmail: false,
        digestFrequency: 'OFF',
        version: 1,
      },
      0,
    );
  }

  static restore(state: PreferencesState): NotificationPreferences {
    return new NotificationPreferences({ ...state }, state.version);
  }

  get snapshot(): PreferencesState {
    return this.state;
  }
  get version(): number {
    return this.state.version;
  }
  get includeDetailsInEmail(): boolean {
    return this.state.includeDetailsInEmail;
  }
  get digestFrequency(): DigestFrequencyValue {
    return this.state.digestFrequency;
  }
  get quietHours(): QuietHours | null {
    const q = this.state.quietHours;
    return q ? QuietHours.of(q.start, q.end) : null;
  }

  /** Estado efectivo de un tipo en un canal (ausencia = activado). */
  isEnabled(type: NotificationType, channel: NotificationChannel): boolean {
    const pref = this.state.byType[type];
    if (!pref) return true;
    return channel === 'IN_APP' ? pref.inApp : pref.email;
  }

  /** Lista completa (todos los tipos del catálogo) para la API. */
  toView(): {
    readonly types: readonly { type: NotificationType; inApp: boolean; email: boolean }[];
    readonly quietHours: { readonly start: string; readonly end: string } | null;
    readonly includeDetailsInEmail: boolean;
    readonly digestFrequency: DigestFrequencyValue;
  } {
    return {
      types: NOTIFICATION_TYPES.map((type) => ({
        type,
        inApp: this.isEnabled(type, 'IN_APP'),
        email: this.isEnabled(type, 'EMAIL'),
      })),
      quietHours: this.state.quietHours,
      includeDetailsInEmail: this.state.includeDetailsInEmail,
      digestFrequency: this.state.digestFrequency,
    };
  }

  /**
   * Reemplaza las preferencias (`PUT`): valida tipos conocidos sin repetir y el horario (`HH:mm`, inicio ≠ fin) y
   * devuelve los cambios campo a campo para la auditoría (FR-AUDIT-001). Los tipos omitidos conservan su valor.
   */
  update(input: PreferencesInput): readonly PreferencesChange[] {
    const seen = new Set<string>();
    const byType: Partial<Record<NotificationType, TypePreference>> = { ...this.state.byType };
    const changes: PreferencesChange[] = [];
    input.types.forEach((entry, index) => {
      if (!isNotificationType(entry.type)) {
        throw new DomainError('VALIDATION_FAILED', `unknown notification type ${String(entry.type)}`).at(
          `/types/${index}/type`,
        );
      }
      if (seen.has(entry.type)) {
        throw new DomainError('VALIDATION_FAILED', `duplicate notification type ${entry.type}`).at(
          `/types/${index}/type`,
        );
      }
      seen.add(entry.type);
      for (const channel of NOTIFICATION_CHANNELS) {
        const before = this.isEnabled(entry.type, channel);
        const after = channel === 'IN_APP' ? entry.inApp : entry.email;
        if (before !== after) changes.push({ field: `byType.${entry.type}.${channel}`, before, after });
      }
      byType[entry.type] = { inApp: entry.inApp, email: entry.email };
    });

    // La frecuencia del digest es opcional en la entrada: ausente conserva el valor actual.
    let nextDigest = this.state.digestFrequency;
    if (input.digestFrequency !== undefined) {
      if (!isDigestFrequency(input.digestFrequency)) {
        throw new DomainError('VALIDATION_FAILED', 'digestFrequency must be OFF, WEEKLY or MONTHLY').at(
          '/digestFrequency',
        );
      }
      nextDigest = input.digestFrequency;
    }

    const quiet = input.quietHours ? QuietHours.of(input.quietHours.start, input.quietHours.end) : null;
    const nextQuiet = quiet ? { start: quiet.start, end: quiet.end } : null;
    const prevQuiet = this.state.quietHours;
    if (JSON.stringify(prevQuiet) !== JSON.stringify(nextQuiet)) {
      changes.push({ field: 'quietHours', before: prevQuiet, after: nextQuiet });
    }
    if (this.state.includeDetailsInEmail !== input.includeDetailsInEmail) {
      changes.push({
        field: 'includeDetailsInEmail',
        before: this.state.includeDetailsInEmail,
        after: input.includeDetailsInEmail,
      });
    }

    if (this.state.digestFrequency !== nextDigest) {
      changes.push({ field: 'digestFrequency', before: this.state.digestFrequency, after: nextDigest });
    }

    // Un `PUT` idéntico al estado actual no cambia nada (ni versión, ni auditoría).
    if (changes.length === 0) return changes;
    this.state = {
      ...this.state,
      byType,
      quietHours: nextQuiet,
      includeDetailsInEmail: input.includeDetailsInEmail,
      digestFrequency: nextDigest,
      version: this.state.version + 1,
    };
    return changes;
  }
}
