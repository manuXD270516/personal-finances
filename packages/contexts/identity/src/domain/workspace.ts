import { DomainError, Money, type Currency, type MoneyJson } from '@pf/shared-kernel';
import { LocaleTag } from './locale-tag.js';
import { type Role } from './role.js';
import { TimeZoneId } from './time-zone.js';

export type MembershipStatus = 'ACTIVE' | 'REVOKED';

/** Entidad `Membership` (una por usuario y workspace). */
export interface Membership {
  readonly userId: string;
  readonly role: Role;
  readonly status: MembershipStatus;
}

/** VO `WorkspaceSettings`. `minimumLiquidityReserve` ≥ 0 y en la escala de su moneda (`Money`). */
export interface WorkspaceSettings {
  readonly name: string;
  readonly baseCurrency: Currency;
  readonly timeZone: TimeZoneId;
  readonly locale: LocaleTag;
  readonly fiscalMonthStartDay: number;
  readonly minimumLiquidityReserve: Money | null;
}

export type WorkspaceStatus = 'ACTIVE' | 'PENDING_DELETION';
export type SettingsField =
  'name' | 'baseCurrency' | 'timeZone' | 'locale' | 'fiscalMonthStartDay' | 'minimumLiquidityReserve';
export type SettingsValue = string | number | MoneyJson | null;

export interface SettingsChange {
  readonly field: SettingsField;
  readonly before: SettingsValue;
  readonly after: SettingsValue;
}

export interface WorkspaceProps {
  readonly id: string;
  readonly settings: WorkspaceSettings;
  readonly memberships: readonly Membership[];
  readonly personalOfUserId: string | null;
  readonly status: WorkspaceStatus;
  readonly version: number;
  /** Instante de alta (ISO 8601 UTC) cuando viene de persistencia; ausente en un agregado recién creado. */
  readonly createdAt?: string;
}

/** Cambios pedidos: valores crudos del borde; el agregado los valida. Las monedas ya vienen resueltas del catálogo. */
export interface SettingsPatch {
  readonly name?: string;
  readonly baseCurrency?: Currency;
  readonly timeZone?: string;
  readonly locale?: string;
  readonly fiscalMonthStartDay?: number;
  /** `null` elimina la reserva. */
  readonly minimumLiquidityReserve?: { readonly amount: string; readonly currency: Currency } | null;
}

export function validateName(name: string): string {
  const trimmed = typeof name === 'string' ? name.trim() : '';
  if (trimmed.length < 1 || trimmed.length > 100) {
    throw new DomainError('VALIDATION_FAILED', 'workspace name must have 1..100 characters');
  }
  return trimmed;
}

export function validateFiscalMonthStartDay(day: number): number {
  if (!Number.isInteger(day) || day < 1 || day > 28) {
    throw new DomainError('VALIDATION_FAILED', 'fiscalMonthStartDay must be an integer in 1..28');
  }
  return day;
}

/** Reserva mínima: `Money` en la escala de su moneda (sin redondeo, `AMOUNT_SCALE_EXCEEDED`) y ≥ 0. */
export function validateReserve(amount: string, currency: Currency): Money {
  const money = Money.parse(amount, currency);
  if (money.isNegative()) {
    throw new DomainError('AMOUNT_OUT_OF_RANGE', 'minimumLiquidityReserve must be >= 0');
  }
  return money;
}

const valueOf = (field: SettingsField, s: WorkspaceSettings): SettingsValue => {
  switch (field) {
    case 'name':
      return s.name;
    case 'baseCurrency':
      return s.baseCurrency.code;
    case 'timeZone':
      return s.timeZone.value;
    case 'locale':
      return s.locale.value;
    case 'fiscalMonthStartDay':
      return s.fiscalMonthStartDay;
    case 'minimumLiquidityReserve':
      return s.minimumLiquidityReserve?.toJSON() ?? null;
  }
};

const FIELDS: readonly SettingsField[] = [
  'name',
  'baseCurrency',
  'timeZone',
  'locale',
  'fiscalMonthStartDay',
  'minimumLiquidityReserve',
];

/**
 * Agregado `Workspace`. Invariantes: ≥ 1 OWNER activo; una membresía por usuario; día de inicio del mes fiscal
 * 1..28; reserva mínima ≥ 0 con la escala de su moneda. Cambiar la moneda base NO toca datos históricos: este
 * agregado no conoce ledger ni transacciones (design §1, tarea 4.3).
 */
export class Workspace {
  private constructor(private props: WorkspaceProps) {
    Workspace.assertInvariants(props);
  }

  static create(input: {
    readonly id: string;
    readonly name: string;
    readonly baseCurrency: Currency;
    readonly timeZone: string;
    readonly locale: string;
    readonly fiscalMonthStartDay?: number;
    readonly ownerUserId: string;
    readonly personal: boolean;
  }): Workspace {
    return new Workspace({
      id: input.id,
      settings: {
        name: validateName(input.name),
        baseCurrency: input.baseCurrency,
        timeZone: TimeZoneId.of(input.timeZone),
        locale: LocaleTag.of(input.locale),
        fiscalMonthStartDay: validateFiscalMonthStartDay(input.fiscalMonthStartDay ?? 1),
        minimumLiquidityReserve: null,
      },
      memberships: [{ userId: input.ownerUserId, role: 'OWNER', status: 'ACTIVE' }],
      personalOfUserId: input.personal ? input.ownerUserId : null,
      status: 'ACTIVE',
      version: 1,
    });
  }

  static restore(props: WorkspaceProps): Workspace {
    return new Workspace({ ...props, memberships: [...props.memberships] });
  }

  private static assertInvariants(p: WorkspaceProps): void {
    const users = new Set<string>();
    for (const m of p.memberships) {
      if (users.has(m.userId)) {
        throw new DomainError('VALIDATION_FAILED', `duplicate membership for user ${m.userId}`);
      }
      users.add(m.userId);
    }
    if (!p.memberships.some((m) => m.role === 'OWNER' && m.status === 'ACTIVE')) {
      throw new DomainError('LAST_OWNER_CANNOT_LEAVE', 'a workspace needs at least one active OWNER');
    }
    validateFiscalMonthStartDay(p.settings.fiscalMonthStartDay);
    if (p.settings.minimumLiquidityReserve?.isNegative()) {
      throw new DomainError('AMOUNT_OUT_OF_RANGE', 'minimumLiquidityReserve must be >= 0');
    }
  }

  get id(): string {
    return this.props.id;
  }
  get settings(): WorkspaceSettings {
    return this.props.settings;
  }
  get memberships(): readonly Membership[] {
    return this.props.memberships;
  }
  get personalOfUserId(): string | null {
    return this.props.personalOfUserId;
  }
  get createdAt(): string | null {
    return this.props.createdAt ?? null;
  }
  get status(): WorkspaceStatus {
    return this.props.status;
  }
  get version(): number {
    return this.props.version;
  }

  /** Rol activo del usuario, o `null` si no es miembro activo. */
  roleOf(userId: string): Role | null {
    const m = this.props.memberships.find((x) => x.userId === userId && x.status === 'ACTIVE');
    return m?.role ?? null;
  }

  /** Agrega un miembro (una membresía por usuario). */
  addMember(userId: string, role: Role): void {
    if (this.props.memberships.some((m) => m.userId === userId)) {
      throw new DomainError('VALIDATION_FAILED', `user ${userId} already has a membership`);
    }
    this.replace({ memberships: [...this.props.memberships, { userId, role, status: 'ACTIVE' }] });
  }

  /** Cambia el rol de un miembro; el último OWNER activo no puede perder el rol. */
  changeRole(userId: string, role: Role): void {
    this.replace({
      memberships: this.props.memberships.map((m) => (m.userId === userId ? { ...m, role } : m)),
    });
  }

  /** Revoca una membresía; el último OWNER activo no puede salir. */
  revoke(userId: string): void {
    this.replace({
      memberships: this.props.memberships.map((m) =>
        m.userId === userId ? { ...m, status: 'REVOKED' as const } : m,
      ),
    });
  }

  /**
   * Aplica cambios de configuración. Todo o nada: si un valor es inválido lanza sin modificar el agregado.
   * Devuelve los cambios efectivos (vacío si nada cambió; la versión solo sube si hubo cambios).
   */
  updateSettings(patch: SettingsPatch): readonly SettingsChange[] {
    const s = this.props.settings;
    const next: WorkspaceSettings = {
      name: patch.name === undefined ? s.name : validateName(patch.name),
      baseCurrency: patch.baseCurrency ?? s.baseCurrency,
      timeZone: patch.timeZone === undefined ? s.timeZone : TimeZoneId.of(patch.timeZone),
      locale: patch.locale === undefined ? s.locale : LocaleTag.of(patch.locale),
      fiscalMonthStartDay:
        patch.fiscalMonthStartDay === undefined
          ? s.fiscalMonthStartDay
          : validateFiscalMonthStartDay(patch.fiscalMonthStartDay),
      minimumLiquidityReserve:
        patch.minimumLiquidityReserve === undefined
          ? s.minimumLiquidityReserve
          : patch.minimumLiquidityReserve === null
            ? null
            : validateReserve(patch.minimumLiquidityReserve.amount, patch.minimumLiquidityReserve.currency),
    };
    const changes: SettingsChange[] = [];
    for (const field of FIELDS) {
      const before = valueOf(field, s);
      const after = valueOf(field, next);
      if (JSON.stringify(before) !== JSON.stringify(after)) changes.push({ field, before, after });
    }
    if (changes.length > 0) {
      this.props = { ...this.props, settings: next, version: this.props.version + 1 };
    }
    return changes;
  }

  private replace(changes: Partial<WorkspaceProps>): void {
    const next = { ...this.props, ...changes, version: this.props.version + 1 };
    Workspace.assertInvariants(next);
    this.props = next;
  }

  snapshot(): WorkspaceProps {
    return { ...this.props, memberships: [...this.props.memberships] };
  }
}
