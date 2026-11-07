import { DomainError } from '@pf/shared-kernel';
import { beforeEach, describe, expect, it } from 'vitest';
import type { SpendableSettingsRow } from './ports/index.js';
import {
  SpendableSettingsService,
  type SpendableSettingsAuditPort,
  type SpendableSettingsRepository,
} from './spendable-settings.use-cases.js';

const WS = '0190a000-0000-7000-8000-0000000000a1';
const OWNER = '0190a000-0000-7000-8000-000000000001';
const SUPER = '0190a000-0000-7000-8000-0000000ca001';
const TRANSPORTE = '0190a000-0000-7000-8000-0000000ca002';
const SALARIO = '0190a000-0000-7000-8000-0000000ca003';
const VIEJA = '0190a000-0000-7000-8000-0000000ca004';

let stored: SpendableSettingsRow | null;
let audits: { version: number; changes: readonly { field: string; before: unknown; after: unknown }[] }[];
let lostRace = false;

const repository: SpendableSettingsRepository = {
  read: async () => stored,
  write: async (_ws, value, expectedVersion) => {
    if (lostRace) return null;
    const version = (stored?.version ?? 1) + 1;
    if ((stored?.version ?? 1) !== expectedVersion) return null;
    stored = { ...value, essentialCategoryIds: [...value.essentialCategoryIds], version };
    return stored;
  },
};
const audit: SpendableSettingsAuditPort = {
  updated: async (e) => void audits.push({ version: e.version, changes: e.changes }),
};
const category = (categoryId: string, kind: 'EXPENSE' | 'INCOME', archived = false) =>
  ({ categoryId, name: categoryId, kind, groupId: null, parentId: null, archived }) as never;

const service = () =>
  new SpendableSettingsService({
    uow: { run: (_ctx, fn) => fn(), join: (_ws, fn) => fn() },
    repository,
    categories: {
      categoryTree: async () => ({
        groups: [],
        categories: [
          category(SUPER, 'EXPENSE'),
          category(TRANSPORTE, 'EXPENSE'),
          category(SALARIO, 'INCOME'),
          category(VIEJA, 'EXPENSE', true),
        ],
        tags: [],
      }),
    },
    audit,
  });

const update = (
  over: Partial<Parameters<SpendableSettingsService['update']>[0]['settings']> = {},
  expectedVersion = 1,
) =>
  service().update({
    userId: OWNER,
    workspaceId: WS,
    expectedVersion,
    settings: {
      horizonMode: 'NEXT_INCOME',
      subtractEssentials: true,
      essentialCategoryIds: [SUPER, TRANSPORTE],
      ...over,
    },
  });
const codeOf = async (fn: () => Promise<unknown>) => {
  try {
    await fn();
  } catch (e) {
    return e instanceof DomainError ? e.code : String(e);
  }
  return undefined;
};

beforeEach(() => {
  stored = null;
  audits = [];
  lostRace = false;
});

describe('Ajustes del disponible (reporting/dashboard; D377, D378)', () => {
  it('[TC-REPORTING-FORECAST-027] sin fila los ajustes son los valores por omisión en versión 1', async () => {
    expect(await service().get({ userId: OWNER, workspaceId: WS })).toEqual({
      horizonMode: 'FINANCIAL_PERIOD',
      subtractEssentials: false,
      essentialCategoryIds: [],
      version: 1,
    });
  });

  it('[TC-REPORTING-FORECAST-027] el OWNER guarda el modo y los esenciales: versión 2 y auditoría con anterior y nuevo', async () => {
    const saved = await update();
    expect(saved).toMatchObject({ horizonMode: 'NEXT_INCOME', subtractEssentials: true, version: 2 });
    expect(saved.essentialCategoryIds).toEqual([SUPER, TRANSPORTE].sort());
    expect(audits).toHaveLength(1);
    expect(audits[0]!.version).toBe(2);
    expect(audits[0]!.changes).toEqual([
      { field: 'horizonMode', before: 'FINANCIAL_PERIOD', after: 'NEXT_INCOME' },
      { field: 'subtractEssentials', before: false, after: true },
      // Valores compuestos como texto JSON.
      { field: 'essentialCategoryIds', before: '[]', after: JSON.stringify([SUPER, TRANSPORTE].sort()) },
    ]);
    expect(await service().get({ userId: OWNER, workspaceId: WS })).toEqual(saved);
  });

  it('[TC-REPORTING-FORECAST-027] una versión vencida se rechaza con PRECONDITION_FAILED sin cambiar los ajustes', async () => {
    await update();
    expect(await codeOf(() => update({ subtractEssentials: false }, 1))).toBe('PRECONDITION_FAILED');
    expect(stored?.version).toBe(2);
    expect(stored?.subtractEssentials).toBe(true);
    expect(audits).toHaveLength(1);
  });

  it('[TC-REPORTING-FORECAST-027] perder la carrera en la escritura también es PRECONDITION_FAILED', async () => {
    lostRace = true;
    expect(await codeOf(() => update())).toBe('PRECONDITION_FAILED');
    expect(audits).toEqual([]);
  });

  it('[TC-REPORTING-FORECAST-027] guardar lo mismo no versiona ni audita (idempotente por contenido)', async () => {
    await update();
    const again = await update({}, 2);
    expect(again.version).toBe(2);
    expect(audits).toHaveLength(1);
  });

  it('[TC-REPORTING-FORECAST-028] una categoría de ingreso se rechaza con CATEGORY_KIND_MISMATCH y una archivada con CATEGORY_ARCHIVED', async () => {
    expect(await codeOf(() => update({ essentialCategoryIds: [SUPER, SALARIO] }))).toBe(
      'CATEGORY_KIND_MISMATCH',
    );
    expect(await codeOf(() => update({ essentialCategoryIds: [VIEJA] }))).toBe('CATEGORY_ARCHIVED');
    expect(stored).toBeNull();
  });

  it('[TC-REPORTING-FORECAST-028] categorías repetidas, inexistentes o más de 50 se rechazan con VALIDATION_FAILED', async () => {
    expect(await codeOf(() => update({ essentialCategoryIds: [SUPER, SUPER] }))).toBe('VALIDATION_FAILED');
    expect(
      await codeOf(() => update({ essentialCategoryIds: ['0190a000-0000-7000-8000-0000000ca999'] })),
    ).toBe('VALIDATION_FAILED');
    const many = Array.from(
      { length: 51 },
      (_, i) => `0190a000-0000-7000-8000-${String(i).padStart(12, '0')}`,
    );
    expect(await codeOf(() => update({ essentialCategoryIds: many }))).toBe('VALIDATION_FAILED');
    expect(stored).toBeNull();
  });
});
