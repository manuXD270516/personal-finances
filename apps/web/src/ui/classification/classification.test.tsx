import { readFileSync } from 'node:fs';
import { NextIntlClientProvider } from 'next-intl';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Category, CategoryGroup, Counterparty } from '../common/types';
import type { WorkspaceContext } from '../common/workspace';
import { LifecycleExportActions } from '../lifecycle/LifecycleTab';
import { esContext, textOf } from '../test-support';
import { categoryOptions } from '../transactions/catalogs';
import { CategoryRow } from './CategoriesPanel';
import { ClassificationDetail } from './ClassificationDetail';
import { CounterpartySummary } from './CounterpartiesPanel';
import { activeSiblings, categoryTree, moveBy, moveTo, parseAliases } from './logic';

const f = esContext('Classification');
const ctx = {
  base: '/workspaces/w1',
  canEdit: true,
  formatLocale: 'es-BO',
  timeZone: 'America/La_Paz',
  uiLocale: 'es',
  me: { id: 'u1' },
  api: { get: () => new Promise(() => undefined) },
} as unknown as WorkspaceContext;
const messages = JSON.parse(
  readFileSync(new URL('../../../messages/es.json', import.meta.url), 'utf8'),
) as Record<string, unknown>;
const G1 = 'g-servicios';
const G2 = 'g-alimentacion';

const group = (
  id: string,
  name: string,
  sortOrder: number,
  kind: 'EXPENSE' | 'INCOME' = 'EXPENSE',
): CategoryGroup => ({
  id,
  name,
  kind,
  sortOrder,
  version: 1,
});
const cat = (id: string, name: string, over: Partial<Category> = {}): Category => ({
  id,
  groupId: G1,
  name,
  kind: 'EXPENSE',
  isSystem: false,
  sortOrder: 0,
  version: 1,
  ...over,
});

const groups = [group(G1, 'Servicios', 2), group(G2, 'Alimentación', 1)];
const categories = [
  cat('basicos', 'Servicios básicos', { sortOrder: 1 }),
  cat('luz', 'Luz', { parentId: 'basicos', sortOrder: 1 }),
  cat('agua', 'Agua', { parentId: 'basicos', sortOrder: 2 }),
  cat('internet', 'Internet', { parentId: 'basicos', sortOrder: 3 }),
  cat('gas', 'Gas', { parentId: 'basicos', sortOrder: 4, archivedAt: '2026-10-01T00:00:00Z' }),
  cat('super', 'Supermercado', { groupId: G2, sortOrder: 1, icon: 'cart', color: '#2E7D32' }),
];

describe('árbol y orden persistente de categorías (add-classification 8.1)', () => {
  it('grupo → categoría → subcategoría en el orden persistente (sortOrder), no alfabético', () => {
    const tree = categoryTree(groups, categories);
    expect(tree.map((g) => g.group.name)).toEqual(['Alimentación', 'Servicios']);
    expect(tree[1]!.categories[0]!.children.map((c) => c.name)).toEqual(['Luz', 'Agua', 'Internet', 'Gas']);
  });

  it('[TC-CLASSIFICATION-CATEGORY-001] reordenar subcategorías como "Internet", "Luz", "Agua" (botones ↑/↓ o arrastrar) envía exactamente las hermanas activas', () => {
    const ids = activeSiblings(categories, categories[1]!).map((c) => c.id);
    expect(ids).toEqual(['luz', 'agua', 'internet']); // la archivada no participa del reordenamiento
    const dragged = moveTo(ids, 'internet', 0);
    expect(dragged).toEqual(['internet', 'luz', 'agua']);
    expect(moveBy(ids, 'agua', -1)).toEqual(['agua', 'luz', 'internet']);
    expect(moveBy(ids, 'luz', -1)).toBeNull();
    expect(moveBy(ids, 'internet', 1)).toBeNull();
    expect(moveTo(ids, 'gas', 0)).toBeNull();
  });

  it('una categoría muestra icono y color decorativos y las acciones accesibles por teclado (↑ deshabilitado en la primera)', () => {
    const html = renderToStaticMarkup(
      <CategoryRow
        c={categories[5]!}
        f={f}
        ctx={ctx}
        canEdit
        position={0}
        count={2}
        onMove={() => undefined}
        onToggle={() => undefined}
        onSave={async () => true}
      />,
    );
    expect(html).toContain('data-icon="cart"');
    expect(html).toContain('data-color="#2E7D32"');
    expect(html).toMatch(/<button type="button" aria-label="Subir «Supermercado»" disabled="">/);
    expect(html).toMatch(/<button type="button" aria-label="Bajar «Supermercado»">/);
    expect(textOf(html)).toContain('Archivar');
  });

  it('[TC-CLASSIFICATION-SYSTEM-002] una de sistema está protegida: sin archivar, editable solo en icono/color/orden', () => {
    const html = renderToStaticMarkup(
      <CategoryRow
        c={cat('sin', 'Sin categoría', { isSystem: true, systemCode: 'UNCATEGORIZED_EXPENSE' })}
        f={f}
        ctx={ctx}
        canEdit
        position={1}
        count={3}
        onMove={() => undefined}
        onToggle={() => undefined}
        onSave={async () => true}
      />,
    );
    expect(html).toContain('data-system="true"');
    expect(textOf(html)).toContain('de sistema (protegida)');
    expect(html).not.toContain('Archivar «Sin categoría»');
    expect(html).toContain('Editar «Sin categoría»');
  });

  it('VIEWER: solo lectura (sin botones) y archivada marcada', () => {
    const html = renderToStaticMarkup(
      <CategoryRow
        c={categories[4]!}
        f={f}
        ctx={ctx}
        canEdit={false}
        position={-1}
        count={3}
        onMove={() => undefined}
        onToggle={() => undefined}
        onSave={async () => true}
      />,
    );
    // Solo la acción "Recorrido" (lectura, VIEWER incluido; docs/31 D52): ninguna de edición.
    expect(html.match(/<button/g)).toHaveLength(1);
    expect(html).toContain('aria-label="Recorrido de «Gas»"');
    expect(html).toContain('data-archived="true"');
    expect(textOf(html)).toContain('archivada');
  });
});

describe('selectores sin archivadas (add-classification 8.2)', () => {
  it('[TC-CLASSIFICATION-ARCHIVE-002] una subcategoría archivada no aparece en el selector; los grupos siguen su orden persistente', () => {
    const options = categoryOptions(categories, groups, 'EXPENSE');
    expect(options.map((g) => g.group)).toEqual(['Alimentación', 'Servicios']);
    const labels = options.flatMap((g) => g.options.map((o) => o.label));
    expect(labels).toContain('Servicios básicos › Internet');
    expect(labels).not.toContain('Servicios básicos › Gas');
  });
});

describe('contrapartes: alias y categoría por defecto (add-classification 8.2)', () => {
  it('[TC-CLASSIFICATION-ALIAS-001] los alias se separan por comas o líneas, sin repetidos y con mínimo 3 caracteres', () => {
    expect(parseAliases('TIGO MONEY, tigo money\nTigo Bolivia ,')).toEqual({
      ok: true,
      aliases: ['TIGO MONEY', 'Tigo Bolivia'],
    });
    expect(parseAliases('ab')).toEqual({ ok: false, error: 'ALIAS_MIN' });
    expect(parseAliases(Array.from({ length: 21 }, (_, i) => `alias ${i}`).join(','))).toEqual({
      ok: false,
      error: 'ALIAS_MAX_COUNT',
    });
  });

  it('[TC-CLASSIFICATION-COUNTERPARTY-001] el resumen muestra tipo, alias y categoría por defecto', () => {
    const c: Counterparty = {
      id: 'cp',
      name: 'Tigo',
      kind: 'SERVICE_PROVIDER',
      aliases: ['TIGO MONEY', 'TIGO BOLIVIA'],
      defaultCategoryId: 'internet',
      version: 1,
    };
    const text = textOf(
      renderToStaticMarkup(
        <CounterpartySummary c={c} f={f} categoryName={(id) => (id === 'internet' ? 'Internet' : '?')} />,
      ),
    );
    expect(text).toContain('Tigo (Proveedor de servicios)');
    expect(text).toContain('Alias: TIGO MONEY, TIGO BOLIVIA');
    expect(text).toContain('Categoría por defecto: Internet');
  });
});

describe('Recorrido de categorías y contrapartes (docs/31 D52, tarea 9.6)', () => {
  const detail = (edit: boolean, mode: 'edit' | 'lifecycle') =>
    renderToStaticMarkup(
      <NextIntlClientProvider locale="es" messages={messages} timeZone="America/La_Paz">
        <ClassificationDetail
          ctx={ctx}
          f={f}
          mode={mode}
          name="Supermercado"
          path="categories/c1"
          version={3}
          idPrefix="category-c1"
          {...(edit ? { edit: <form data-testid="category-edit-form" /> } : {})}
        />
      </NextIntlClientProvider>,
    );

  it('[TC-AUDIT-LIFECYCLE-020] el detalle ofrece pestañas Editar y Recorrido; la acción "Recorrido" abre esa pestaña', () => {
    const html = detail(true, 'lifecycle');
    expect(html).toContain('role="tablist"');
    expect(html).toContain('aria-label="Detalle de «Supermercado»"');
    const tabs = [...html.matchAll(/<button[^>]*role="tab"[^>]*>([^<]*)<\/button>/g)].map((m) => [
      m[1],
      /aria-selected="true"/.test(m[0]),
    ]);
    expect(tabs).toEqual([
      ['Editar', false],
      ['Recorrido', true],
    ]);
    // El recorrido se carga del API (VIEWER+); el formulario de edición queda montado en su panel oculto.
    expect(textOf(html)).toContain('Cargando el recorrido…');
    expect(html).toContain('data-testid="category-edit-form"');
    const editFirst = detail(true, 'edit');
    expect(editFirst).toMatch(/aria-selected="true"[^>]*>Editar</);
  });

  it('[TC-AUDIT-LIFECYCLE-020] un VIEWER solo ve la pestaña Recorrido', () => {
    const html = detail(false, 'edit');
    const tabs = [...html.matchAll(/role="tab"[^>]*>([^<]*)</g)].map((m) => m[1]);
    expect(tabs).toEqual(['Recorrido']);
    expect(html).not.toContain('category-edit-form');
  });

  it('[TC-AUDIT-LIFECYCLE-020] "Exportar CSV" y "Exportar PDF" descargan por el BFF el recorrido del elemento', () => {
    const html = renderToStaticMarkup(
      <LifecycleExportActions
        href={(format) => `/api/bff/v1/workspaces/w1/categories/c1/lifecycle/export?format=${format}`}
        label="Exportar el recorrido"
        csv="Exportar CSV"
        pdf="Exportar PDF"
        idPrefix="category-c1"
      />,
    );
    expect(html).toContain('<nav aria-label="Exportar el recorrido"');
    expect(html).toMatch(
      /<a href="\/api\/bff\/v1\/workspaces\/w1\/categories\/c1\/lifecycle\/export\?format=csv" download="" data-testid="category-c1-export-csv"[^>]*>Exportar CSV<\/a>/,
    );
    expect(html).toMatch(
      /format=pdf" download="" data-testid="category-c1-export-pdf"[^>]*>Exportar PDF<\/a>/,
    );
  });
});
