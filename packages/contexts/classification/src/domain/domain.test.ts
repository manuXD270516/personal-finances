import { isDomainError } from '@pf/shared-kernel';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { Category, CategoryGroup } from './category.js';
import { Alias, Counterparty, CounterpartyMatcher } from './counterparty.js';
import { NormalizedText, normalizeText } from './normalized-text.js';
import { SYSTEM_CATEGORY_CATALOG, systemCategoryName } from './system-categories.js';
import { Tag } from './tag.js';

const WS = '0190c000-0000-7000-8000-000000000001';
const codeOf = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (err) {
    if (isDomainError(err)) return err.code;
    throw err;
  }
  return undefined;
};

let seq = 0;
const id = () => `0190c000-0000-7000-8000-${(++seq).toString(16).padStart(12, '0')}`;
const group = (name: string, kind: 'EXPENSE' | 'INCOME' = 'EXPENSE') =>
  CategoryGroup.create({ id: id(), workspaceId: WS, kind, name });

describe('NormalizedText (tarea 2.1)', () => {
  it('minúsculas, sin acentos y espacios colapsados', () => {
    expect(normalizeText('  Panadería   DON  Pépe ')).toBe('panaderia don pepe');
    expect(NormalizedText.of('TIGO bolivia').equals(NormalizedText.of('Tigo  Bolivia'))).toBe(true);
    expect(NormalizedText.of('COMPRA PEDIDOS  YA*LPZ').contains(NormalizedText.of('Pedidos Ya'))).toBe(true);
  });

  it('propiedades: idempotente, sin mayúsculas, sin dobles espacios ni marcas diacríticas', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        const n = normalizeText(s);
        expect(normalizeText(n)).toBe(n);
        expect(n).toBe(n.trim());
        expect(n).not.toMatch(/\s{2,}/u);
        expect(n).not.toMatch(/\p{M}/u);
        expect(normalizeText(s.toUpperCase())).toBe(normalizeText(s.toLowerCase()));
      }),
    );
  });
});

describe('Category y CategoryGroup (tarea 2.2)', () => {
  it('[TC-CLASSIFICATION-HIERARCHY-001] subcategoría hereda grupo y tipo; tercer nivel ⇒ CATEGORY_DEPTH_EXCEEDED', () => {
    const vivienda = group('Vivienda');
    const servicios = Category.create({ id: id(), group: vivienda, name: 'Servicios básicos' });
    const luz = Category.create({ id: id(), group: vivienda, parent: servicios, name: 'Luz' });
    expect(luz).toMatchObject({
      kind: 'EXPENSE',
      groupId: vivienda.id,
      parentId: servicios.id,
      isArchived: false,
    });
    expect(
      codeOf(() => Category.create({ id: id(), group: vivienda, parent: luz, name: 'Luz departamento' })),
    ).toBe('CATEGORY_DEPTH_EXCEEDED');
    // Una categoría con subcategorías no puede volverse subcategoría.
    const otra = Category.create({ id: id(), group: vivienda, name: 'Alquiler' });
    expect(codeOf(() => servicios.moveTo(vivienda, otra, true))).toBe('CATEGORY_DEPTH_EXCEEDED');
  });

  it('[TC-CLASSIFICATION-KIND-001] el tipo es inmutable: mover a un grupo de ingreso ⇒ CATEGORY_KIND_MISMATCH; a otro de gasto se acepta', () => {
    const alimentacion = group('Alimentación');
    const restaurantes = Category.create({ id: id(), group: alimentacion, name: 'Restaurantes' });
    const v = restaurantes.version;
    expect(codeOf(() => restaurantes.moveTo(group('Ingresos laborales', 'INCOME'), null, false))).toBe(
      'CATEGORY_KIND_MISMATCH',
    );
    expect(restaurantes.groupId).toBe(alimentacion.id);
    expect(restaurantes.version).toBe(v);
    const ocio = group('Ocio');
    expect(restaurantes.moveTo(ocio, null, false)).toBe(true);
    expect(restaurantes).toMatchObject({ groupId: ocio.id, kind: 'EXPENSE', version: v + 1 });
  });

  it('[TC-CLASSIFICATION-ARCHIVE-003] archivar/desarchivar: transiciones y padre archivado ⇒ CATEGORY_ARCHIVED', () => {
    const g = group('Vivienda');
    const padre = Category.create({ id: id(), group: g, name: 'Servicios básicos' });
    const luz = Category.create({ id: id(), group: g, parent: padre, name: 'Luz' });
    padre.archive('2026-10-03T12:00:00.000Z');
    luz.archive('2026-10-03T12:00:00.000Z');
    expect(codeOf(() => padre.archive('2026-10-03T12:00:00.000Z'))).toBe('INVALID_STATUS_TRANSITION');
    expect(codeOf(() => luz.unarchive(g, padre))).toBe('CATEGORY_ARCHIVED');
    padre.unarchive(g, null);
    luz.unarchive(g, padre);
    expect(luz.isArchived).toBe(false);
    expect(codeOf(() => Category.create({ id: id(), group: g, parent: luz, name: 'x' }))).toBe(
      'CATEGORY_DEPTH_EXCEEDED',
    );
  });

  it('un grupo solo se archiva sin categorías activas (CATEGORY_GROUP_NOT_EMPTY)', () => {
    const g = group('Ocio');
    expect(codeOf(() => g.archive('2026-10-03T12:00:00.000Z', 2))).toBe('CATEGORY_GROUP_NOT_EMPTY');
    g.archive('2026-10-03T12:00:00.000Z', 0);
    expect(g.isArchived).toBe(true);
    expect(codeOf(() => Category.create({ id: id(), group: g, name: 'Cine' }))).toBe('CATEGORY_ARCHIVED');
  });
});

describe('SystemCategoryPolicy y SystemCategoryCatalog (tarea 2.3)', () => {
  it('[TC-CLASSIFICATION-SYSTEM-001] el catálogo de sistema tiene exactamente los 11 códigos con su tipo', () => {
    expect(SYSTEM_CATEGORY_CATALOG.map((d) => `${d.code}:${d.kind}`)).toEqual([
      'FEES:EXPENSE',
      'FX_FEES:EXPENSE',
      'INTEREST:EXPENSE',
      'LOAN_FEES:EXPENSE',
      'INSURANCE:EXPENSE',
      'TAXES:EXPENSE',
      'ADJUSTMENTS:EXPENSE',
      'UNCATEGORIZED:EXPENSE',
      'INTEREST_EARNED:INCOME',
      'ADJUSTMENTS_INCOME:INCOME',
      'UNCATEGORIZED_INCOME:INCOME',
    ]);
  });

  it('[TC-CLASSIFICATION-SYSTEM-002] no se archiva, renombra ni recibe padre/subcategorías; color e icono sí', () => {
    const finanzas = group('Finanzas');
    const fees = Category.create({ id: id(), group: finanzas, name: 'Comisiones', systemCode: 'FEES' });
    expect(codeOf(() => fees.archive('2026-10-03T12:00:00.000Z'))).toBe('SYSTEM_CATEGORY_IMMUTABLE');
    expect(codeOf(() => fees.update({ name: 'Cargos' }))).toBe('SYSTEM_CATEGORY_IMMUTABLE');
    expect(codeOf(() => Category.create({ id: id(), group: finanzas, parent: fees, name: 'x' }))).toBe(
      'SYSTEM_CATEGORY_IMMUTABLE',
    );
    const otra = Category.create({ id: id(), group: finanzas, name: 'Bancos' });
    expect(codeOf(() => fees.moveTo(finanzas, otra, false))).toBe('SYSTEM_CATEGORY_IMMUTABLE');
    expect(fees.update({ color: '#C62828', icon: 'bank' })).toBe(true);
    expect(fees).toMatchObject({ systemCode: 'FEES', color: '#C62828', isArchived: false });
  });

  it('[TC-CLASSIFICATION-SYSTEM-003] nombres por locale con fallback a español', () => {
    expect(systemCategoryName('FEES', 'es-BO')).toBe('Comisiones');
    expect(systemCategoryName('FEES', 'en')).toBe('Fees');
    expect(systemCategoryName('FEES', 'pt-BR')).toBe('Tarifas');
    expect(systemCategoryName('FEES', 'fr')).toBe('Comisiones');
  });
});

describe('Tag y Counterparty (tareas 3.1, 3.2)', () => {
  it('[TC-CLASSIFICATION-TAG-003] un tag se archiva y desarchiva conservando id y nombre', () => {
    const t = Tag.create({ id: id(), workspaceId: WS, name: 'Viaje Santa Cruz 2026', color: '#1565C0' });
    t.archive('2026-10-03T12:00:00.000Z');
    expect(codeOf(() => t.archive('2026-10-03T12:00:00.000Z'))).toBe('INVALID_STATUS_TRANSITION');
    t.unarchive();
    expect(t).toMatchObject({ name: 'Viaje Santa Cruz 2026', isArchived: false, version: 3 });
  });

  it('[TC-CLASSIFICATION-ALIAS-001] reconoce por alias normalizado, ignora archivadas y descripciones sin coincidencia', () => {
    const pedidos = Counterparty.create({
      id: id(),
      workspaceId: WS,
      name: 'PedidosYa',
      aliases: ['pedidos ya'],
    });
    const entel = Counterparty.create({ id: id(), workspaceId: WS, name: 'Entel', aliases: ['entel'] });
    entel.archive('2026-10-03T12:00:00.000Z');
    const all = [pedidos, entel];
    expect(CounterpartyMatcher.match('COMPRA PEDIDOS  YA*LPZ 4471', all)).toMatchObject({
      counterparty: { id: pedidos.id },
      matchedOn: 'ALIAS',
      matchedText: 'pedidos ya',
    });
    expect(CounterpartyMatcher.match('TRANSF 99812', all)).toBeNull();
    expect(CounterpartyMatcher.match('PAGO ENTEL 120.00', all)).toBeNull();
  });

  it('[TC-CLASSIFICATION-ALIAS-001] desempate por el alias más largo', () => {
    const ya = Counterparty.create({ id: id(), workspaceId: WS, name: 'Yaigo', aliases: ['yai'] });
    const pedidos = Counterparty.create({
      id: id(),
      workspaceId: WS,
      name: 'PedidosYa',
      aliases: ['pedidos yaigo'],
    });
    expect(CounterpartyMatcher.match('PAGO PEDIDOS YAIGO', [ya, pedidos])?.counterparty.id).toBe(pedidos.id);
  });

  it('[TC-CLASSIFICATION-COUNTERPARTY-001] kind por defecto OTHER; alias de menos de 3 caracteres ⇒ VALIDATION_FAILED', () => {
    expect(Counterparty.create({ id: id(), workspaceId: WS, name: 'Panadería Don Pepe' }).kind).toBe('OTHER');
    expect(codeOf(() => Alias.of('ya'))).toBe('VALIDATION_FAILED');
    const c = Counterparty.create({
      id: id(),
      workspaceId: WS,
      name: 'Tigo',
      aliases: ['TIGO', 'tigo ', 'Tigo Money'],
    });
    expect(c.aliases).toEqual(['TIGO', 'Tigo Money']);
  });
});
