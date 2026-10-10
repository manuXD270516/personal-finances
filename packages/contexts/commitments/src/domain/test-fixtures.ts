import { LocalDate } from '@pf/shared-kernel';
import {
  buildDefinitionVersion,
  type DefinitionVersion,
  type ScheduleInput,
  type TemplateInput,
} from './definition-version.js';
import { RecurringDefinition } from './recurring-definition.js';
import type { RecurringKind } from './types.js';

export const WS = '0190a000-0000-7000-8000-00000000a001';
export const BANK = '0190a000-0000-7000-8000-0000000acc01';
export const SAVINGS = '0190a000-0000-7000-8000-0000000acc02';
export const CATEGORY = '0190a000-0000-7000-8000-0000000ca701';

export type TemplateOverrides = Omit<Partial<TemplateInput>, 'schedule'> & {
  schedule?: Partial<ScheduleInput>;
};

export const BOB = { code: 'BOB', scale: 2 } as const;

export function template(overrides: TemplateOverrides = {}): TemplateInput {
  const { schedule, ...rest } = overrides;
  return {
    accountId: BANK,
    amount: { type: 'FIXED', amount: '3500.00' },
    categoryId: CATEGORY,
    schedule: { cadence: 'MONTHLY', interval: 1, startDate: '2026-10-05', ...schedule },
    materialization: { mode: 'PENDING_APPROVAL', leadDays: 3 },
    ...rest,
  };
}

export function version(
  versionNo: number,
  effectiveFrom: string,
  overrides: TemplateOverrides = {},
  kind: RecurringKind = 'EXPENSE',
): DefinitionVersion {
  return buildDefinitionVersion({
    kind,
    versionNo,
    effectiveFrom,
    currency: BOB,
    template: template(overrides),
  });
}

export function definition(
  id: string,
  overrides: TemplateOverrides = {},
  kind: RecurringKind = 'EXPENSE',
): RecurringDefinition {
  const v1 = version(1, overrides.schedule?.startDate ?? '2026-10-05', overrides, kind);
  return RecurringDefinition.create({
    id,
    workspaceId: WS,
    name: 'Alquiler',
    kind,
    version1: v1,
    at: '2026-10-09T12:00:00.000Z',
    by: 'user-1',
  });
}

export const d = (s: string): LocalDate => LocalDate.parse(s);
