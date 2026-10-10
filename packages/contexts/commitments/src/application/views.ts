import type { DefinitionVersion, OccurrenceState, RecurringDefinition } from '../domain/index.js';
import { projectedAmount } from '../domain/index.js';
import type { OccurrenceView } from './ports/index.js';
import type { MoneyDto } from '../contracts/index.js';

/** `RecurringAmount` del contrato HTTP. */
export interface RecurringAmountDto {
  readonly type: 'FIXED' | 'ESTIMATED' | 'MIN_MAX' | 'VARIABLE';
  readonly amount?: MoneyDto;
  readonly min?: MoneyDto;
  readonly max?: MoneyDto;
}

export const money = (amount: string, currency: string): MoneyDto => ({ amount, currency });

export function amountDto(
  spec: {
    readonly type: RecurringAmountDto['type'];
    amount: string | null;
    min: string | null;
    max: string | null;
  },
  currency: string,
): RecurringAmountDto {
  return {
    type: spec.type,
    ...(spec.amount !== null ? { amount: money(spec.amount, currency) } : {}),
    ...(spec.min !== null ? { min: money(spec.min, currency) } : {}),
    ...(spec.max !== null ? { max: money(spec.max, currency) } : {}),
  };
}

export interface DefinitionVersionDto {
  readonly versionNo: number;
  readonly effectiveFrom: string;
  readonly accountId: string;
  readonly toAccountId: string | null;
  readonly currency: string;
  readonly amount: RecurringAmountDto;
  readonly categoryId: string | null;
  readonly counterpartyId: string | null;
  readonly tagIds: readonly string[];
  readonly paymentMethod: string | null;
  readonly schedule: {
    readonly cadence: string;
    readonly interval: number;
    readonly monthDays: readonly number[];
    readonly rrule: string | null;
    readonly startDate: string;
    readonly endDate: string | null;
    readonly maxOccurrences: number | null;
    readonly weekendAdjustment: string;
  };
  readonly materialization: {
    readonly mode: string;
    readonly autoCreateStatus: string | null;
    readonly leadDays: number;
  };
  /** Solo definiciones administradas con el precio en otra moneda que la cuenta (suscripciones en USD con tarjeta BOB). */
  readonly indexedPrice?: MoneyDto;
}

export function versionDto(v: DefinitionVersion): DefinitionVersionDto {
  return {
    versionNo: v.versionNo,
    effectiveFrom: v.effectiveFrom,
    accountId: v.accountId,
    toAccountId: v.toAccountId,
    currency: v.currency,
    amount: amountDto(v.amount, v.currency),
    categoryId: v.categoryId,
    counterpartyId: v.counterpartyId,
    tagIds: v.tagIds,
    paymentMethod: v.paymentMethod,
    schedule: {
      cadence: v.schedule.cadence,
      interval: v.schedule.interval,
      monthDays: v.schedule.monthDays,
      rrule: v.schedule.rrule,
      startDate: v.schedule.startDate,
      endDate: v.schedule.endDate,
      maxOccurrences: v.schedule.maxOccurrences,
      weekendAdjustment: v.schedule.weekendAdjustment,
    },
    materialization: {
      mode: v.materialization.mode,
      autoCreateStatus: v.materialization.autoCreateStatus,
      leadDays: v.materialization.leadDays,
    },
    ...(v.indexedPrice ? { indexedPrice: money(v.indexedPrice.amount, v.indexedPrice.currency) } : {}),
  };
}

/** `RecurringDefinition` del contrato HTTP. */
export interface DefinitionDto {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly notes: string | null;
  readonly kind: string;
  readonly managedBy: string;
  readonly managedRef: string | null;
  readonly status: string;
  readonly currentVersionNo: number;
  readonly generatedThrough: string | null;
  readonly endDate: string | null;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly current: DefinitionVersionDto;
  readonly versions?: readonly DefinitionVersionDto[];
  readonly nextOccurrence?: { readonly occurrenceDate: string; readonly dueDate: string } | null;
  readonly pendingApprovalCount?: number;
  readonly generatedCount?: number;
}

export function definitionDto(
  d: RecurringDefinition,
  extra: {
    readonly withVersions?: boolean;
    readonly nextOccurrence?: { readonly occurrenceDate: string; readonly dueDate: string } | null;
    readonly pendingApprovalCount?: number;
    readonly generatedCount?: number;
  } = {},
): DefinitionDto {
  const s = d.snapshot;
  return {
    id: s.id,
    name: s.name,
    description: s.description,
    notes: s.notes,
    kind: s.kind,
    managedBy: s.managedBy,
    managedRef: s.managedRef,
    status: s.status,
    currentVersionNo: s.currentVersionNo,
    generatedThrough: s.generatedThrough,
    endDate: s.endDate,
    version: s.version,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    current: versionDto(d.current),
    ...(extra.withVersions ? { versions: d.versions.map(versionDto) } : {}),
    ...(extra.nextOccurrence !== undefined ? { nextOccurrence: extra.nextOccurrence } : {}),
    ...(extra.pendingApprovalCount !== undefined ? { pendingApprovalCount: extra.pendingApprovalCount } : {}),
    ...(extra.generatedCount !== undefined ? { generatedCount: extra.generatedCount } : {}),
  };
}

/** `RecurringOccurrence` del contrato HTTP. */
export interface OccurrenceDto {
  readonly id: string;
  readonly definitionId: string;
  readonly definitionName: string;
  readonly kind: string;
  readonly managedBy: string;
  readonly occurrenceDate: string;
  readonly dueDate: string;
  readonly definitionVersionNo: number;
  readonly expected: RecurringAmountDto;
  readonly projectedAmount: MoneyDto | null;
  readonly status: string;
  readonly cancelReason: string | null;
  readonly requiresApproval: boolean;
  readonly mode: string;
  readonly overridden: boolean;
  readonly accountId: string;
  readonly toAccountId: string | null;
  readonly transactionId: string | null;
  readonly resolution: string | null;
  readonly matchedBy: string | null;
  readonly skipReason: string | null;
  readonly lastAutoCreateError: string | null;
  readonly version: number;
}

/** "Por aprobar": `DUE`/`OVERDUE` de definiciones en `PENDING_APPROVAL` (D114: `NOTIFY_ONLY` no entra a la bandeja). */
export const needsApproval = (status: string, mode: string): boolean =>
  mode === 'PENDING_APPROVAL' && (status === 'DUE' || status === 'OVERDUE');

export function occurrenceDto(v: OccurrenceView): OccurrenceDto {
  const o: OccurrenceState = v.occurrence;
  const projected = projectedAmount(o.expected);
  return {
    id: o.id,
    definitionId: o.definitionId,
    definitionName: v.definitionName,
    kind: v.kind,
    managedBy: v.managedBy,
    occurrenceDate: o.occurrenceDate,
    dueDate: o.dueDate,
    definitionVersionNo: o.definitionVersionNo,
    expected: amountDto(o.expected, o.currency),
    projectedAmount: projected === null ? null : money(projected, o.currency),
    status: o.status,
    cancelReason: o.cancelReason,
    requiresApproval: needsApproval(o.status, v.mode),
    mode: v.mode,
    overridden: o.amountOverridden || o.dateOverridden,
    accountId: v.accountId,
    toAccountId: v.toAccountId,
    transactionId: o.transactionId,
    resolution: o.resolution,
    matchedBy: o.matchedBy,
    skipReason: o.skipReason,
    lastAutoCreateError: o.lastAutoCreateError,
    version: o.version,
  };
}
