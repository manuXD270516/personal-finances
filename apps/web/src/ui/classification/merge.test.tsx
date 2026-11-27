import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Category, CategoryGroup, Counterparty } from '../common/types';
import type { WorkspaceContext } from '../common/workspace';
import { esContext, textOf } from '../test-support';
import { CategoryRow } from './CategoriesPanel';
import { CounterpartyRow } from './CounterpartiesPanel';
import { MergePreviewView } from './MergeDialog';
import { canConfirmMerge, categoryMergeTargets, counterpartyMergeTargets, visibleCounts } from './logic';
import type { MergePreview } from './types';

/**
 * Fusión de categorías y contrapartes en la UI (openspec add-category-and-counterparty-merge, tareas 6.1 y 6.2):
 * destinos compatibles, vista previa con conteos legibles, conflictos que bloquean, confirmación explícita, marca
 * «fusionada en» y alias que se mueven. Datos ficticios.
 */
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

const G = 'g-alimentacion';
const groups: CategoryGroup[] = [{ id: G, name: 'Alimentación', kind: 'EXPENSE', sortOrder: 1, version: 1 }];
const cat = (id: string, name: string, over: Partial<Category> = {}): Category => ({
  id,
  groupId: G,
  name,
  kind: 'EXPENSE',
  isSystem: false,
  sortOrder: 0,
  version: 1,
  ...over,
});

describe('fusión de categorías: vista previa y confirmación (add-category-and-counterparty-merge 6.1)', () => {
  const FIX = [
    cat('sup', 'Super', { sortOrder: 1 }),
    cat('mercado', 'Supermercado', { sortOrder: 2 }),
    cat('mercado-sub', 'Feria', { parentId: 'mercado', sortOrder: 1 }),
    cat('sueldo', 'Sueldo', { kind: 'INCOME', sortOrder: 3 }),
    cat('vieja', 'Vieja', { sortOrder: 4, archivedAt: '2026-01-01T00:00:00Z' }),
    cat('fusionada', 'Fusionada', {
      sortOrder: 5,
      archivedAt: '2026-01-01T00:00:00Z',
      mergedInto: { id: 'mercado', name: 'Supermercado' },
    }),
  ];
  const preview = (over: Partial<MergePreview> = {}): MergePreview => ({
    source: { id: 'sup', name: 'Super' },
    target: { id: 'mercado', name: 'Supermercado' },
    counts: [
      { key: 'SPLITS_OPEN', count: 3 },
      { key: 'SPLITS_CLOSED_KEPT', count: 0 },
      { key: 'BUDGET_LINES', count: 0 },
      { key: 'RULES', count: 1 },
      { key: 'FUTURE_KEY', count: 2 },
    ],
    conflicts: [],
    ...over,
  });
  const view = (p: MergePreview) =>
    renderToStaticMarkup(<MergePreviewView f={f} kind="category" preview={p} />);

  it('[TC-CLASSIFICATION-MERGE-001] el destino ofrecido es del mismo tipo, activo, no fusionado y distinto de la origen', () => {
    const labels = categoryMergeTargets(groups, FIX, FIX[0]!).flatMap((g) => g.options.map((o) => o.label));
    expect(labels).toEqual(['Supermercado', 'Supermercado › Feria']);
    // Con subcategorías activas, la origen no puede ir bajo otra subcategoría (profundidad).
    const withChildren = [...FIX, cat('hija', 'Hija', { parentId: 'sup' })];
    const noSubs = categoryMergeTargets(groups, withChildren, FIX[0]!).flatMap((g) =>
      g.options.map((o) => o.label),
    );
    expect(noSubs).toEqual(['Supermercado']);
  });

  it('[TC-CLASSIFICATION-MERGE-001] la subcategoría puede fusionarse en su padre', () => {
    const labels = categoryMergeTargets(groups, FIX, FIX[2]!).flatMap((g) => g.options.map((o) => o.label));
    expect(labels).toContain('Supermercado');
  });

  it('[TC-CLASSIFICATION-MERGE-001] la vista previa muestra los conteos legibles sin los que valen 0 y el aviso de que no se deshace', () => {
    const text = textOf(view(preview()));
    expect(text).toContain('Porciones de transacciones que se reasignan: 3');
    expect(text).toContain('Reglas: 1');
    expect(text).toContain('FUTURE_KEY: 2');
    expect(text).not.toContain('Líneas de presupuesto');
    expect(text).not.toContain('sin cambios');
    expect(text).toContain('La fusión no se puede deshacer');
    expect(text).toContain('«Super» quedará archivada y marcada como fusionada en «Supermercado»');
    expect(visibleCounts(preview().counts).map((c) => c.key)).toEqual(['SPLITS_OPEN', 'RULES', 'FUTURE_KEY']);
  });

  it('[TC-CLASSIFICATION-MERGE-001] confirmar exige la vista previa y la casilla «no se puede deshacer»', () => {
    expect(canConfirmMerge(null, true)).toBe(false);
    expect(canConfirmMerge(preview(), false)).toBe(false);
    expect(canConfirmMerge(preview(), true)).toBe(true);
  });

  it('[TC-CLASSIFICATION-MERGE-009] con conflictos se listan con sus referencias y no se puede confirmar', () => {
    const blocked = preview({
      conflicts: [
        {
          reason: 'BUDGET_LINE_EXISTS',
          refs: [{ kind: 'BUDGET_PLAN', id: 'p1', label: 'Plan de noviembre de 2026' }],
        },
        { reason: 'NEW_REASON', refs: [] },
      ],
    });
    const html = view(blocked);
    expect(html).toContain('data-conflict="BUDGET_LINE_EXISTS"');
    expect(textOf(html)).toContain('Un plan ya tiene una línea de presupuesto de la destino');
    expect(textOf(html)).toContain('Plan de noviembre de 2026');
    expect(textOf(html)).toContain('NEW_REASON');
    expect(canConfirmMerge(blocked, true)).toBe(false);
  });

  const row = (c: Category, canEdit: boolean, withMerge = true) =>
    renderToStaticMarkup(
      <CategoryRow
        c={c}
        f={f}
        ctx={ctx}
        canEdit={canEdit}
        position={0}
        count={2}
        onMove={() => undefined}
        onToggle={() => undefined}
        onSave={async () => true}
        {...(withMerge ? { onMerge: () => undefined } : {})}
      />,
    );

  it('[TC-CLASSIFICATION-MERGE-001] «Fusionar en…» solo para OWNER/EDITOR y no en las de sistema', () => {
    expect(row(FIX[0]!, true)).toContain('aria-label="Fusionar «Super» en otra"');
    expect(textOf(row(FIX[0]!, true))).toContain('Fusionar en…');
    expect(row(FIX[0]!, false)).not.toContain('Fusionar');
    expect(row(cat('sin', 'Sin categoría', { isSystem: true }), true)).not.toContain('Fusionar');
  });

  it('[TC-CLASSIFICATION-MERGE-001] una fusionada muestra «fusionada en <destino>» y no se puede desarchivar', () => {
    const html = row(FIX[5]!, true);
    expect(textOf(html)).toContain('fusionada en Supermercado');
    expect(html).not.toContain('Desarchivar');
    expect(html).not.toContain('Fusionar «Fusionada»');
    // Una archivada común (no fusionada) sí se puede desarchivar y fusionar.
    const plain = row(FIX[4]!, true);
    expect(plain).toContain('Desarchivar «Vieja»');
    expect(plain).toContain('Fusionar «Vieja» en otra');
  });
});

describe('fusión de contrapartes: alias que se mueven (add-category-and-counterparty-merge 6.2)', () => {
  const HIPER: Counterparty = {
    id: 'cp1',
    name: 'HIPERMAXI S.A.',
    kind: 'MERCHANT',
    aliases: ['hipermaxi sa'],
    version: 2,
  };
  const preview: MergePreview = {
    source: { id: 'cp1', name: 'HIPERMAXI S.A.' },
    target: { id: 'cp2', name: 'Hipermaxi' },
    counts: [
      { key: 'TRANSACTIONS_OPEN', count: 4 },
      { key: 'TRANSACTIONS_CLOSED_KEPT', count: 1 },
      { key: 'SUBSCRIPTIONS', count: 1 },
      { key: 'RULES', count: 1 },
      { key: 'ALIASES_MOVED', count: 1 },
      { key: 'LOANS', count: 0 },
    ],
    conflicts: [],
  };
  const previewHtml = renderToStaticMarkup(
    <MergePreviewView f={f} kind="counterparty" preview={preview} aliases={HIPER.aliases ?? []} />,
  );

  it('[TC-CLASSIFICATION-MERGE-025] la vista previa muestra los conteos de la contraparte y oculta los que valen 0', () => {
    const text = textOf(previewHtml);
    expect(text).toContain('Transacciones que se reasignan: 4');
    expect(text).toContain('Transacciones en periodos cerrados que quedan sin cambios: 1');
    expect(text).toContain('Suscripciones: 1');
    expect(text).toContain('Reglas: 1');
    expect(text).not.toContain('Préstamos');
    expect(canConfirmMerge(preview, true)).toBe(true);
  });

  it('[TC-CLASSIFICATION-MERGE-021] muestra los alias que pasan a la destino y que el nombre de la origen será alias', () => {
    const text = textOf(previewHtml);
    expect(previewHtml).toContain('data-count-key="ALIASES_MOVED"');
    expect(text).toContain('Alias que se mueven: 1');
    expect(text).toContain('Alias que pasan a la destino: hipermaxi sa.');
    expect(text).toContain('El nombre «HIPERMAXI S.A.» pasará a ser alias de «Hipermaxi»');
  });

  const cp = (c: Counterparty, canEdit: boolean) =>
    renderToStaticMarkup(
      <CounterpartyRow
        c={c}
        f={f}
        ctx={{ ...ctx, canEdit } as WorkspaceContext}
        data={{ groups: [], categories: [], tags: [], counterparties: [HIPER], customFields: [] }}
        run={async () => true}
        categoryName={() => '?'}
      />,
    );

  it('[TC-CLASSIFICATION-MERGE-021] [TC-CLASSIFICATION-MERGE-025] «Fusionar en…» solo con permiso de edición; la fusionada no se desarchiva', () => {
    expect(cp(HIPER, true)).toContain('aria-label="Fusionar «HIPERMAXI S.A.» en otra"');
    expect(cp(HIPER, false)).not.toContain('Fusionar');
    const merged = cp(
      { ...HIPER, archivedAt: '2026-11-20T00:00:00Z', mergedInto: { id: 'cp2', name: 'Hipermaxi' } },
      true,
    );
    expect(textOf(merged)).toContain('fusionada en Hipermaxi');
    expect(merged).not.toContain('Desarchivar');
    expect(merged).not.toContain('Fusionar «');
  });

  it('[TC-CLASSIFICATION-MERGE-021] los destinos son contrapartes activas, no fusionadas y distintas de la origen', () => {
    const all: Counterparty[] = [
      HIPER,
      { id: 'cp2', name: 'Hipermaxi', kind: 'MERCHANT', version: 1 },
      { id: 'cp3', name: 'Archivada', kind: 'MERCHANT', archivedAt: '2026-01-01T00:00:00Z', version: 1 },
      {
        id: 'cp4',
        name: 'Fusionada',
        kind: 'MERCHANT',
        archivedAt: '2026-01-01T00:00:00Z',
        mergedInto: { id: 'cp2', name: 'Hipermaxi' },
        version: 1,
      },
    ];
    expect(counterpartyMergeTargets(all, HIPER).map((o) => o.label)).toEqual(['Hipermaxi']);
  });
});
