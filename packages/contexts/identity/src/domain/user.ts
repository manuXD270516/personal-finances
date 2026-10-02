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
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Agregado `User` (identidad del IdP + preferencias personales). */
export class User {
  private constructor(private props: UserProps) {}

  static restore(props: UserProps): User {
    if (!EMAIL.test(props.email)) throw new DomainError('VALIDATION_FAILED', 'invalid email');
    return new User({ ...props });
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

  /**
   * Cambia locale y/o zona horaria (validadas por sus VO: zona inválida → `INVALID_TIMEZONE`). Todo o nada;
   * sube la versión solo si algo cambió.
   */
  updatePreferences(changes: { readonly locale?: string; readonly timeZone?: string | null }): boolean {
    const locale = changes.locale === undefined ? this.props.locale : LocaleTag.of(changes.locale);
    const timeZone =
      changes.timeZone === undefined
        ? this.props.timeZone
        : changes.timeZone === null
          ? null
          : TimeZoneId.of(changes.timeZone);
    const changed =
      locale.value !== this.props.locale.value || timeZone?.value !== this.props.timeZone?.value;
    if (changed) this.props = { ...this.props, locale, timeZone, version: this.props.version + 1 };
    return changed;
  }

  snapshot(): UserProps {
    return { ...this.props };
  }
}
