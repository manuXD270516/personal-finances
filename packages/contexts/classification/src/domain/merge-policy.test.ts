import { isDomainError } from '@pf/shared-kernel';
import { describe, expect, it } from 'vitest';
import { Category, CategoryGroup } from './category.js';
import { CATEGORY_LIFECYCLE, COUNTERPARTY_LIFECYCLE } from './classification-lifecycle.js';
import { Counterparty } from './counterparty.js';
import { CategoryMergePolicy, CounterpartyMergePolicy } from './merge-policy.js';

const WS = '0190c000-0000-7000-8000-000000000001';
const AT = '2026-11-27T14:00:00Z';
let seq = 0;
const id = () => `0190c000-0000-7000-8000-${(++seq).toString(16).padStart(12, '0')}`;
const group = (kind: 'EXPENSE' | 'INCOME' = 'EXPENSE') =>
  CategoryGroup.create({ id: id(), workspaceId: WS, kind, name: `G${seq}` });
const category = (g: CategoryGroup, name: string, parent: Category | null = null) =>
  Category.create({ id: id(), group: g, parent, name });
const codeOf = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (err) {
    if (isDomainError(err)) return err.code;
    throw err;
  }
  return undefined;
};

describe('CategoryMergePolicy', () => {
  it('[TC-CLASSIFICATION-MERGE-002] tipos de movimiento distintos ⇒ CATEGORY_KIND_MISMATCH', () => {
    const sup = category(group(), 'Super');
    const sueldo = category(group('INCOME'), 'Sueldo');
    expect(codeOf(() => CategoryMergePolicy.plan(sup, sueldo, [sup, sueldo]))).toBe('CATEGORY_KIND_MISMATCH');
  });

  it('[TC-CLASSIFICATION-MERGE-003] una categoría de sistema no puede ser origen; sí puede ser destino', () => {
    const g = group();
    const fees = Category.create({ id: id(), group: g, name: 'Comisiones', systemCode: 'FEES' });
    const bank = category(g, 'Gastos bancarios');
    expect(codeOf(() => CategoryMergePolicy.plan(fees, bank, [fees, bank]))).toBe(
      'SYSTEM_CATEGORY_IMMUTABLE',
    );
    expect(codeOf(() => CategoryMergePolicy.plan(bank, fees, [fees, bank]))).toBeUndefined();
  });

  it('[TC-CLASSIFICATION-MERGE-004] una destino archivada se rechaza con CATEGORY_ARCHIVED', () => {
    const g = group();
    const sup = category(g, 'Super');
    const old = category(g, 'Old Market');
    old.archive(AT);
    expect(codeOf(() => CategoryMergePolicy.plan(sup, old, [sup, old]))).toBe('CATEGORY_ARCHIVED');
  });

  it('[TC-CLASSIFICATION-MERGE-005] origen igual a la destino ⇒ VALIDATION_FAILED', () => {
    const sup = category(group(), 'Supermercado');
    expect(codeOf(() => CategoryMergePolicy.plan(sup, sup, [sup]))).toBe('VALIDATION_FAILED');
  });

  it('[TC-CLASSIFICATION-MERGE-020] una origen o destino ya fusionada ⇒ CATEGORY_MERGED con la destino', () => {
    const g = group();
    const sup = category(g, 'Super');
    const mercado = category(g, 'Supermercado');
    const otra = category(g, 'Mercado');
    sup.merge(mercado.id, AT);
    expect(codeOf(() => CategoryMergePolicy.plan(sup, otra, [sup, mercado, otra]))).toBe('CATEGORY_MERGED');
    expect(codeOf(() => CategoryMergePolicy.plan(otra, sup, [sup, mercado, otra]))).toBe('CATEGORY_MERGED');
    try {
      CategoryMergePolicy.plan(sup, otra, [sup, mercado, otra]);
    } catch (err) {
      expect(isDomainError(err) && err.details['mergedInto']).toBe(mercado.id);
    }
  });

  it('[TC-CLASSIFICATION-MERGE-010] las subcategorías activas de la origen pasan a la destino de primer nivel; las archivadas no', () => {
    const g = group();
    const servicios = category(g, 'Servicios');
    const basicos = category(g, 'Servicios básicos');
    const luz = category(g, 'Luz', servicios);
    const agua = category(g, 'Agua', servicios);
    const gas = category(g, 'Gas', servicios);
    gas.archive(AT);
    const plan = CategoryMergePolicy.plan(servicios, basicos, [servicios, basicos, luz, agua, gas]);
    expect(plan.movedSubcategories.map((c) => c.name).sort()).toEqual(['Agua', 'Luz']);
    expect(plan.conflicts).toEqual([]);
  });

  it('[TC-CLASSIFICATION-MERGE-011] una destino subcategoría con origen que tiene hijas activas ⇒ CATEGORY_DEPTH_EXCEEDED', () => {
    const g = group();
    const servicios = category(g, 'Servicios');
    const luz = category(g, 'Luz', servicios);
    const hogar = category(g, 'Hogar');
    const mant = category(g, 'Mantenimiento', hogar);
    expect(codeOf(() => CategoryMergePolicy.plan(servicios, mant, [servicios, luz, hogar, mant]))).toBe(
      'CATEGORY_DEPTH_EXCEEDED',
    );
  });

  it('[TC-CLASSIFICATION-MERGE-012] fusionar una subcategoría en su propio padre está permitido', () => {
    const g = group();
    const basicos = category(g, 'Servicios básicos');
    const luz = category(g, 'Luz', basicos);
    expect(CategoryMergePolicy.plan(luz, basicos, [basicos, luz]).conflicts).toEqual([]);
  });

  it('[TC-CLASSIFICATION-MERGE-013] una subcategoría con el nombre de una hermana activa de la destino es un conflicto', () => {
    const g = group();
    const servicios = category(g, 'Servicios');
    const basicos = category(g, 'Servicios básicos');
    const agua = category(g, 'Agua', servicios);
    const agua2 = category(g, 'AGUA', basicos);
    const plan = CategoryMergePolicy.plan(servicios, basicos, [servicios, basicos, agua, agua2]);
    expect(plan.conflicts).toHaveLength(1);
    expect(plan.conflicts[0]).toMatchObject({ reason: 'SUBCATEGORY_NAME_TAKEN' });
    expect(plan.conflicts[0]?.refs.map((r) => r.label)).toContain('Agua');
  });

  it('[TC-CLASSIFICATION-MERGE-001] D497: una origen archivada también se fusiona y conserva su archivedAt', () => {
    const g = group();
    const sup = category(g, 'Super');
    const mercado = category(g, 'Supermercado');
    sup.archive('2026-01-05T10:00:00Z');
    expect(CategoryMergePolicy.plan(sup, mercado, [sup, mercado]).conflicts).toEqual([]);
    const fresh = Category.restore(sup.snapshot());
    fresh.merge(mercado.id, AT);
    expect(fresh.lastTransition).toEqual({ transition: 'MERGE', from: 'ARCHIVED', to: 'ARCHIVED' });
    expect(fresh.archivedAt).toBe('2026-01-05T10:00:00Z');
    expect(fresh.mergedIntoId).toBe(mercado.id);
    expect(fresh.mergedAt).toBe(AT);
  });
});

describe('Category.merge y unarchive', () => {
  it('[TC-CLASSIFICATION-MERGE-019] una categoría fusionada no se desarchiva (CATEGORY_MERGED) y queda ARCHIVED', () => {
    const g = group();
    const sup = category(g, 'Super');
    const mercado = category(g, 'Supermercado');
    sup.merge(mercado.id, AT);
    expect(sup.lastTransition).toEqual({ transition: 'MERGE', from: 'ACTIVE', to: 'ARCHIVED' });
    expect(sup.status).toBe('ARCHIVED');
    const reloaded = Category.restore(sup.snapshot());
    expect(codeOf(() => reloaded.unarchive(g, null))).toBe('CATEGORY_MERGED');
    expect(reloaded.status).toBe('ARCHIVED');
    expect(codeOf(() => Category.restore(sup.snapshot()).merge(mercado.id, AT))).toBe('CATEGORY_MERGED');
  });

  it('[TC-AUDIT-LIFECYCLE-028] la máquina v2 declara MERGE de ACTIVE y de ARCHIVED hacia ARCHIVED con su evento', () => {
    for (const [machine, event] of [
      [CATEGORY_LIFECYCLE, 'classification.CategoriesMerged.v1'],
      [COUNTERPARTY_LIFECYCLE, 'classification.CounterpartiesMerged.v1'],
    ] as const) {
      expect(machine.version).toBe(2);
      const merge = machine.definition.transitions.find((t) => t.code === 'MERGE');
      expect(merge).toMatchObject({ from: ['ACTIVE', 'ARCHIVED'], to: ['ARCHIVED'], events: [event] });
      expect(
        machine.replay([
          { transition: 'CREATE', from: null, to: 'ACTIVE' },
          { transition: 'MERGE', from: 'ACTIVE', to: 'ARCHIVED' },
        ]),
      ).toBe('ARCHIVED');
      expect(
        machine.replay([
          { transition: 'CREATE', from: null, to: 'ACTIVE' },
          { transition: 'ARCHIVE', from: 'ACTIVE', to: 'ARCHIVED' },
          { transition: 'MERGE', from: 'ARCHIVED', to: 'ARCHIVED' },
        ]),
      ).toBe('ARCHIVED');
    }
  });
});

const counterparty = (name: string, extra: { aliases?: string[]; defaultCategoryId?: string | null } = {}) =>
  Counterparty.create({ id: id(), workspaceId: WS, name, ...extra });

describe('CounterpartyMergePolicy', () => {
  it('[TC-CLASSIFICATION-MERGE-021] los alias de la origen y su nombre pasan a la destino', () => {
    const src = counterparty('HIPERMAXI S.A.', { aliases: ['hipermaxi sa'] });
    const dst = counterparty('Hipermaxi');
    const plan = CounterpartyMergePolicy.plan(src, dst, [src, dst], new Set());
    expect(plan.movedAliases).toEqual(['hipermaxi sa']);
    expect(plan.nameAsAlias).toBe('HIPERMAXI S.A.');
    expect(plan.aliases).toEqual(['hipermaxi sa', 'HIPERMAXI S.A.']);
  });

  it('[TC-CLASSIFICATION-MERGE-021] el nombre de la origen no se agrega si coincide con el nombre o un alias de la destino', () => {
    const src = counterparty('Hipermaxi');
    const dst = counterparty('HIPERMAXI', { aliases: ['otro'] });
    expect(CounterpartyMergePolicy.plan(src, dst, [src, dst], new Set()).nameAsAlias).toBeNull();
    const src2 = counterparty('Banco Uno');
    const dst2 = counterparty('B1 Banco', { aliases: ['banco uno'] });
    const plan = CounterpartyMergePolicy.plan(src2, dst2, [src2, dst2], new Set());
    expect(plan.nameAsAlias).toBeNull();
    expect(plan.aliases).toEqual(['banco uno']);
  });

  it('[TC-CLASSIFICATION-MERGE-021] el nombre de la origen no se agrega si es el alias de una tercera contraparte activa', () => {
    const src = counterparty('Entel SA');
    const dst = counterparty('Entel');
    const tercera = counterparty('Otra', { aliases: ['entel sa'] });
    expect(CounterpartyMergePolicy.plan(src, dst, [src, dst, tercera], new Set()).nameAsAlias).toBeNull();
  });

  it('[TC-CLASSIFICATION-MERGE-022] la destino sin categoría por defecto hereda la de la origen si está activa (D498)', () => {
    const cat = id();
    const src = counterparty('HIPERMAXI S.A.', { defaultCategoryId: cat });
    const dst = counterparty('Hipermaxi');
    expect(CounterpartyMergePolicy.plan(src, dst, [src, dst], new Set([cat])).defaultCategoryId).toBe(cat);
    expect(CounterpartyMergePolicy.plan(src, dst, [src, dst], new Set()).defaultCategoryId).toBeNull();
    const dstWith = counterparty('Hipermaxi 2', { defaultCategoryId: id() });
    expect(CounterpartyMergePolicy.plan(src, dstWith, [src, dstWith], new Set([cat])).defaultCategoryId).toBe(
      dstWith.defaultCategoryId,
    );
  });

  it('[TC-CLASSIFICATION-MERGE-023] una destino archivada ⇒ COUNTERPARTY_ARCHIVED; la misma ⇒ VALIDATION_FAILED', () => {
    const src = counterparty('HIPERMAXI S.A.');
    const old = counterparty('Hiper Viejo');
    old.archive(AT);
    expect(codeOf(() => CounterpartyMergePolicy.plan(src, old, [src, old], new Set()))).toBe(
      'COUNTERPARTY_ARCHIVED',
    );
    expect(codeOf(() => CounterpartyMergePolicy.plan(src, src, [src], new Set()))).toBe('VALIDATION_FAILED');
  });

  it('[TC-CLASSIFICATION-MERGE-027] una contraparte fusionada no se desarchiva ni se vuelve a fusionar (COUNTERPARTY_MERGED)', () => {
    const src = counterparty('HIPERMAXI S.A.', { aliases: ['hipermaxi sa'] });
    const dst = counterparty('Hipermaxi');
    const other = counterparty('Otra');
    src.merge(dst.id, AT);
    expect(src.lastTransition).toEqual({ transition: 'MERGE', from: 'ACTIVE', to: 'ARCHIVED' });
    expect(src.aliases).toEqual([]);
    expect(src.mergedIntoId).toBe(dst.id);
    expect(codeOf(() => Counterparty.restore(src.snapshot()).unarchive())).toBe('COUNTERPARTY_MERGED');
    expect(codeOf(() => CounterpartyMergePolicy.plan(src, other, [src, dst, other], new Set()))).toBe(
      'COUNTERPARTY_MERGED',
    );
    expect(codeOf(() => CounterpartyMergePolicy.plan(other, src, [src, dst, other], new Set()))).toBe(
      'COUNTERPARTY_MERGED',
    );
  });
});
