import { renderToStaticMarkup } from 'react-dom/server';
import { describe as suite, expect, it } from 'vitest';
import type { Account, Category, CategoryGroup, Counterparty, Tag, Transaction } from '../common/types';
import type { WorkspaceContext } from '../common/workspace';
import { esContext, textOf } from '../test-support';
import {
  bulkChanges,
  bulkEditItems,
  bulkFilter,
  CLEAR_COUNTERPARTY,
  conflictingTags,
  EMPTY_BULK_DRAFT,
  itemErrors,
  splitPreview,
  type BulkPreview,
} from './bulk-edit-logic';
import { BulkEditPanel } from './BulkEditPanel';
import type { Catalogs } from './catalogs';
import { EMPTY_TRANSACTION_FILTERS } from './logic';

const f = esContext('Transactions');
const SUPER = '0190a000-0000-7000-8000-0000000000d1';
const HOGAR = '0190a000-0000-7000-8000-0000000000d2';
const GROUP = '0190a000-0000-7000-8000-0000000000d0';
const FAMILIA = '0190a000-0000-7000-8000-0000000000a1';
const CP = '0190a000-0000-7000-8000-0000000000f1';

const category = (id: string, name: string): Category => ({
  id,
  groupId: GROUP,
  name,
  kind: 'EXPENSE',
  isSystem: false,
  sortOrder: 1,
  version: 1,
});
const catalogs: Catalogs = {
  loaded: true,
  accounts: [] as Account[],
  activeAccounts: [],
  categories: [category(SUPER, 'Supermercado'), category(HOGAR, 'Hogar')],
  groups: [
    { id: GROUP, name: 'Gastos', kind: 'EXPENSE', sortOrder: 1, version: 1 } as unknown as CategoryGroup,
  ],
  counterparties: [{ id: CP, name: 'Farmacia Demo', kind: 'MERCHANT', version: 1 } as Counterparty],
  tags: [{ id: FAMILIA, name: 'familia', version: 1 } as Tag],
  names: {
    account: () => undefined,
    category: (id) => ({ [SUPER]: 'Supermercado', [HOGAR]: 'Hogar' })[id],
    counterparty: (id) => (id === CP ? 'Farmacia Demo' : undefined),
    tag: (id) => (id === FAMILIA ? 'familia' : undefined),
  },
  reload: () => undefined,
  addCounterparty: () => undefined,
};
const ctx = {
  api: {},
  base: '/workspaces/w1',
  uiLocale: 'es',
  formatLocale: 'es-BO',
  href: (p: string) => p,
  canEdit: true,
} as unknown as WorkspaceContext;

suite('Edición masiva — lógica del borrador', () => {
  it('[TC-TRANSACTIONS-BULK-001] el borrador se traduce a BulkEditChanges; sin cambios no hay petición', () => {
    expect(bulkChanges(EMPTY_BULK_DRAFT)).toBeUndefined();
    expect(
      bulkChanges({
        ...EMPTY_BULK_DRAFT,
        categoryId: HOGAR,
        addTagIds: [FAMILIA],
        counterparty: CLEAR_COUNTERPARTY,
        cleared: 'uncleared',
      }),
    ).toEqual({ categoryId: HOGAR, addTagIds: [FAMILIA], counterpartyId: null, cleared: false });
    expect(bulkChanges({ ...EMPTY_BULK_DRAFT, counterparty: CP, cleared: 'cleared' })).toEqual({
      counterpartyId: CP,
      cleared: true,
    });
  });

  it('una etiqueta agregada y quitada a la vez se detecta y no viaja como quitada', () => {
    const d = { ...EMPTY_BULK_DRAFT, addTagIds: [FAMILIA], removeTagIds: [FAMILIA] };
    expect(conflictingTags(d)).toEqual([FAMILIA]);
    expect(bulkChanges(d)).toEqual({ addTagIds: [FAMILIA] });
  });

  it('[TC-TRANSACTIONS-BULK-002] los filtros del registro viajan como filtro de la vista previa (incluido el custom field)', () => {
    expect(bulkFilter(EMPTY_TRANSACTION_FILTERS)).toEqual({});
    expect(
      bulkFilter({
        ...EMPTY_TRANSACTION_FILTERS,
        q: ' farmacia ',
        accountId: SUPER,
        kind: 'EXPENSE',
        categoryId: SUPER,
        dateFrom: '2026-03-01',
        dateTo: '2026-03-31',
        withoutStatement: true,
      }),
    ).toEqual({
      q: 'farmacia',
      accountId: [SUPER],
      kind: ['EXPENSE'],
      categoryId: [SUPER],
      dateFrom: '2026-03-01',
      dateTo: '2026-03-31',
      systemFlag: ['RECONCILED_WITHOUT_STATEMENT'],
    });
  });

  it('[TC-TRANSACTIONS-BULK-002] la vista previa separa aplicables y no aplicables y la ejecución envía las versiones vigentes', () => {
    const preview: BulkPreview = {
      count: 3,
      truncated: false,
      items: [
        { id: 'a', version: 2, applicable: true, reasons: [] },
        { id: 'b', version: 1, applicable: false, reasons: ['BULK_EDIT_NOT_APPLICABLE'] },
        { id: 'c', version: null, applicable: false, reasons: ['RESOURCE_NOT_FOUND'] },
      ],
    };
    const parts = splitPreview(preview);
    expect(parts.applicable.map((i) => i.id)).toEqual(['a']);
    expect(parts.blocked.map((i) => i.id)).toEqual(['b', 'c']);
    expect(bulkEditItems(parts.applicable)).toEqual([{ id: 'a', version: 2 }]);
  });

  it('[TC-TRANSACTIONS-BULK-003] los errores por ítem se leen de errors[] (pointer /items/<i>)', () => {
    expect(
      itemErrors({
        code: 'PRECONDITION_FAILED',
        errors: [
          { pointer: '/items/1/version', code: 'PRECONDITION_FAILED' },
          { pointer: '/items/0', code: 'PERIOD_CLOSED' },
          { pointer: '/changes/categoryId', code: 'VALIDATION_FAILED' },
        ],
      }),
    ).toEqual([
      { index: 1, code: 'PRECONDITION_FAILED' },
      { index: 0, code: 'PERIOD_CLOSED' },
    ]);
    expect(itemErrors(undefined)).toEqual([]);
  });
});

suite('Edición masiva — panel', () => {
  const known = new Map<string, Transaction>();
  const render = (target: Parameters<typeof BulkEditPanel>[0]['target']) =>
    renderToStaticMarkup(
      <BulkEditPanel
        ctx={ctx}
        f={f}
        catalogs={catalogs}
        target={target}
        filters={EMPTY_TRANSACTION_FILTERS}
        customFilter={undefined}
        known={known}
        focus="category"
        onClose={() => undefined}
        onApplied={() => undefined}
      />,
    );

  it('[TC-TRANSACTIONS-BULK-001] ofrece categoría, etiquetas, contraparte y confirmación; la vista previa es obligatoria', () => {
    const html = render({ kind: 'items', ids: ['a', 'b', 'c'] });
    const text = textOf(html);
    expect(text).toContain('Edición masiva de 3 transacciones');
    for (const label of [
      'Categoría nueva',
      'Agregar etiquetas',
      'Quitar etiquetas',
      'Contraparte',
      'Confirmación',
    ]) {
      expect(text).toContain(label);
    }
    expect(text).toContain('Supermercado');
    expect(text).toContain('Quitar la contraparte');
    expect(text).toContain('Marcar como confirmadas');
    // Sin cambios elegidos: la vista previa está deshabilitada y no hay botón de aplicar.
    expect(html).toMatch(
      /data-testid="bulk-preview"[^>]*disabled=""|disabled=""[^>]*data-testid="bulk-preview"/,
    );
    expect(html).not.toContain('data-testid="bulk-apply"');
    expect(text).toContain('Elige al menos un cambio.');
  });

  it('sobre lo filtrado el título no inventa una cantidad antes de la vista previa', () => {
    expect(textOf(render({ kind: 'filter' }))).toContain('Edición masiva de lo filtrado');
  });
});
