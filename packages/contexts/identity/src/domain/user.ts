import { DomainError } from '@pf/shared-kernel';
import { LocaleTag } from './locale-tag.js';
import { TimeZoneId } from './time-zone.js';

export type UserStatus = 'ACTIVE' | 'DISABLED';

export interface UserProps {
  readonly id: string;
  readonly idpIssuer: string;
  readonly idpSubject: string;
  readonly email: string;
  readonly displayName: string;
  readonly locale: LocaleTag;
  /** Preferencia personal; `null` = usar la zona del workspace activo (FR-IDENTITY-003). */
  readonly timeZone: TimeZoneId | null;
  readonly status: UserStatus;
  readonly version: number;
  /** Preferencias libres de la UI (objeto JSON); `{}` por defecto. */
  readonly preferences?: Readonly<Record<string, unknown>>;
}

/** Cambios de `PATCH /me` (merge-patch): `preferences` se fusiona clave a clave y `null` borra la clave. */
export interface UserPreferenceChanges {
  readonly displayName?: string;
  readonly locale?: string;
  readonly timeZone?: string | null;
  readonly preferences?: Readonly<Record<string, unknown>>;
}

const MAX_DISPLAY_NAME = 100;
const MAX_PREFERENCES_JSON = 16_384;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Agregado `User` (identidad del IdP + preferencias personales). */
export class User {
  private constructor(private props: UserProps) {}

  static restore(props: UserProps): User {
    if (!EMAIL.test(props.email)) throw new DomainError('VALIDATION_FAILED', 'invalid email');
    return new User({ ...props, preferences: { ...(props.preferences ?? {}) } });
  }

  get id(): string {
    return this.props.id;
  }
  get email(): string {
    return this.props.email;
  }
  get displayName(): string {
    return this.props.displayName;
  }
  get locale(): LocaleTag {
    return this.props.locale;
  }
  get timeZone(): TimeZoneId | null {
    return this.props.timeZone;
  }
  get status(): UserStatus {
    return this.props.status;
  }
  get version(): number {
    return this.props.version;
  }
  get idpIssuer(): string {
    return this.props.idpIssuer;
  }
  get idpSubject(): string {
    return this.props.idpSubject;
  }
  get preferences(): Readonly<Record<string, unknown>> {
    return this.props.preferences ?? {};
  }

  /**
   * Cambia nombre visible, locale, zona horaria y/o preferencias (validados: zona inválida → `INVALID_TIMEZONE`,
   * nombre vacío o > 100 → `VALIDATION_FAILED`). Todo o nada; sube la versión solo si algo cambió.
   */
  updatePreferences(changes: UserPreferenceChanges): boolean {
    const locale = changes.locale === undefined ? this.props.locale : LocaleTag.of(changes.locale);
    const timeZone =
      changes.timeZone === undefined
        ? this.props.timeZone
        : changes.timeZone === null
          ? null
          : TimeZoneId.of(changes.timeZone);
    let displayName = this.props.displayName;
    if (changes.displayName !== undefined) {
      displayName = changes.displayName.trim();
      if (displayName.length === 0 || displayName.length > MAX_DISPLAY_NAME) {
        throw new DomainError('VALIDATION_FAILED', 'displayName must have 1..100 characters').at(
          '/displayName',
        );
      }
    }
    const current = this.props.preferences ?? {};
    let preferences = current;
    if (changes.preferences !== undefined) {
      const merged: Record<string, unknown> = { ...current };
      for (const [k, v] of Object.entries(changes.preferences)) {
        if (v === null) delete merged[k];
        else merged[k] = v;
      }
      if (JSON.stringify(merged).length > MAX_PREFERENCES_JSON) {
        throw new DomainError('VALIDATION_FAILED', 'preferences are too large').at('/preferences');
      }
      preferences = merged;
    }
    const changed =
      locale.value !== this.props.locale.value ||
      timeZone?.value !== this.props.timeZone?.value ||
      displayName !== this.props.displayName ||
      JSON.stringify(preferences) !== JSON.stringify(current);
    if (changed) {
      this.props = {
        ...this.props,
        locale,
        timeZone,
        displayName,
        preferences,
        version: this.props.version + 1,
      };
    }
    return changed;
  }

  snapshot(): UserProps {
    return { ...this.props, preferences: { ...(this.props.preferences ?? {}) } };
  }
}
