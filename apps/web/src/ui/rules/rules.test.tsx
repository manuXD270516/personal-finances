import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Transaction } from '../common/types';
import { esContext, textOf } from '../test-support';
import { CoverageView } from './Coverage';
import { DryRunTable } from './DryRun';
import { PreviewResult } from './RuleEditor';
import { RulesTable } from './RulesList';
import { CreateRuleLink, NeedsReviewBadge, ReviewBanner, SplitClassificationView } from './TransactionRules';
import type { Coverage, DryRunItem, Rule, RulePreview } from './types';

const f = esContext('Rules');
const tf = esContext('Transactions');
const href = (p: string) => `/es${p}`;
const render = (node: React.ReactElement) => renderToStaticMarkup(node);
const names = {
  category: (id: string) => ({ c1: 'Supermercado', c2: 'Hogar' })[id],
  tag: (id: string) => ({ t1: 'hogar' })[id],
  counterparty: (id: string) => ({ cp1: 'Hipermaxi' })[id],
  account: () => undefined,
};

const rule = (over: Partial<Rule> = {}): Rule => ({
  id: 'r1',
  name: 'Supermercado',
  description: null,
  priority: 100,
  enabled: true,
  status: 'ACTIVE',
  triggers: ['IMPORT', 'RETROACTIVE'],
  matchMode: 'ALL',
  conditions: [{ field: 'DESCRIPTION', operator: 'contains', value: 'hipermaxi' }],
  actions: [
    { type: 'SET_CATEGORY', categoryId: 'c1' },
    { type: 'ADD_TAG', tagId: 't1' },
  ],
  stopProcessing: false,
  version: 1,
  rowVersion: 1,
  needsAttention: false,
  archivedAt: null,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  stats: { classifiedTransactions: 40, lastAppliedAt: '2026-10-18T10:00:00.000Z', unusedFor90Days: false },
  ...over,
});

describe('listado de reglas', () => {
  const rules = [
    rule(),
    rule({
      id: 'r2',
      name: 'Gimnasio',
      priority: 200,
      needsAttention: true,
      stats: { classifiedTransactions: 0, lastAppliedAt: null, unusedFor90Days: true },
    }),
    rule({
      id: 'r3',
      name: 'Vieja',
      status: 'ARCHIVED',
      enabled: false,
      archivedAt: '2026-10-02T00:00:00.000Z',
    }),
  ];
  const html = render(
    <RulesTable
      rules={rules}
      f={f}
      href={href}
      names={names}
      canEdit
      busy={false}
      onMove={() => undefined}
      onToggle={() => undefined}
      onArchive={() => undefined}
    />,
  );

  it('[TC-RULES-ENGINE-048] muestra la señal de «sin aplicaciones en 90 días» con texto y no solo con color', () => {
    expect(html.match(/data-testid="rule-row"/g)).toHaveLength(3);
    expect(html).toMatch(
      /data-testid="rule-unused"[^>]*><span aria-hidden="true">◌<\/span> Sin aplicaciones en 90 días/,
    );
    expect(textOf(html)).toContain('40 transacciones clasificadas');
    expect(textOf(html)).toContain('Sin aplicaciones');
  });

  it('[TC-RULES-ENGINE-023] la regla con un destino archivado aparece como «requiere atención»', () => {
    expect(html).toMatch(/data-rule-id="r2"[^>]*data-attention="true"/);
    expect(textOf(html)).toContain('Requiere atención');
    expect(html.match(/data-attention="true"/g)).toHaveLength(1);
  });

  it('el estado es texto + icono, la tabla tiene leyenda y encabezados, y reordenar tiene alternativa de teclado con nombre accesible', () => {
    expect(html).toContain('<caption');
    expect(html).toContain('scope="col"');
    expect(html).toContain('scope="row"');
    expect(html).toMatch(/aria-label="Subir la regla Gimnasio"/);
    expect(html).toMatch(/aria-label="Bajar la regla Supermercado"/);
    expect(textOf(html)).toContain('Archivada');
    // la primera no sube y la última no baja
    expect(html).toMatch(
      /disabled=""[^>]*data-testid="rule-move-up"[^>]*aria-label="Subir la regla Supermercado"/,
    );
  });

  it('describe las acciones con los nombres del catálogo y un VIEWER no ve acciones', () => {
    expect(textOf(html)).toContain('Fijar la categoría: Supermercado');
    expect(textOf(html)).toContain('Agregar etiqueta: hogar');
    const viewer = render(
      <RulesTable rules={rules} f={f} href={href} names={names} canEdit={false} busy={false} />,
    );
    expect(viewer).not.toContain('rule-move-up');
    expect(viewer).not.toContain('rule-archive');
  });
});

describe('vista previa', () => {
  const preview: RulePreview = {
    matched: true,
    conditions: [
      { path: '/conditions/0', met: true, actual: 'TIGO MONEY RECARGA' },
      { path: '/conditions/1', met: false, actual: '180.00 BOB' },
    ],
    actions: [{ type: 'SET_CATEGORY', categoryId: 'c1' }],
    skipped: [{ action: 'ADD_TAG', reason: 'RULE_ACTION_TARGET_ARCHIVED' }],
  };

  it('[TC-RULES-ENGINE-025] cada condición dice si se cumple (texto + icono) y las acciones usan el nombre del catálogo', () => {
    const html = render(<PreviewResult preview={preview} f={f} names={names} />);
    expect(html).toContain('data-testid="preview-result"');
    expect(html.match(/data-testid="preview-condition"/g)).toHaveLength(2);
    expect(textOf(html)).toContain('Condición cumplida');
    expect(textOf(html)).toContain('Condición no cumplida');
    expect(textOf(html)).toContain('Fijar la categoría: Supermercado');
    expect(textOf(html)).toContain('el destino está archivado');
  });

  it('[TC-RULES-ENGINE-026] sin coincidencia no lista acciones', () => {
    const html = render(
      <PreviewResult
        preview={{ ...preview, matched: false, actions: [], skipped: [] }}
        f={f}
        names={names}
      />,
    );
    expect(textOf(html)).toContain('no coincide');
    expect(html).not.toContain('preview-actions');
  });
});

describe('dry-run', () => {
  const items: DryRunItem[] = [
    {
      transactionId: 'aaaaaaaa-1111',
      version: 2,
      applicable: true,
      reasons: [],
      changes: [{ field: 'categoryId', before: null, after: 'c1', ruleId: 'r1', ruleVersion: 1 }],
    },
    {
      transactionId: 'bbbbbbbb-2222',
      version: 1,
      applicable: false,
      reasons: ['TRANSACTION_RECONCILED'],
      changes: [{ field: 'tagAdded', before: null, after: 't1', ruleId: 'r1', ruleVersion: 1 }],
    },
  ];

  it('[TC-RULES-ENGINE-027] muestra el valor actual → propuesto con la regla y versión, y solo lo aplicable se puede seleccionar', () => {
    const html = render(
      <DryRunTable
        items={items}
        selected={new Set(['aaaaaaaa-1111'])}
        onToggle={() => undefined}
        f={f}
        names={names}
        ruleNames={new Map([['r1', 'Supermercado']])}
      />,
    );
    expect(textOf(html)).toContain('Categoría');
    expect(textOf(html)).toContain('(vacío)');
    expect(textOf(html)).toContain('Supermercado');
    expect(textOf(html)).toContain('por la regla Supermercado (v1)');
    expect(html.match(/data-testid="dry-run-select"/g)).toHaveLength(2);
    expect(html).toMatch(/disabled=""[^>]*data-testid="dry-run-select"/);
    expect(textOf(html)).toContain('está conciliada');
    expect(html).toContain('<caption');
  });
});

describe('cobertura', () => {
  const base: Coverage = {
    count: 200,
    byOrigin: { rule: 148, counterpartyDefault: 20, manual: 12, systemDefault: 20, unknown: 0 },
    ruleCoverage: '0.7400',
    target: '0.7000',
    meetsTarget: true,
    byRule: [{ ruleId: 'r1', name: 'Supermercado', version: 1, archived: false, count: 148 }],
  };

  it('[TC-RULES-ENGINE-044] informa el cociente, la meta, el desglose por origen y por regla', () => {
    const html = render(<CoverageView coverage={base} f={f} locale="es-BO" />);
    expect(textOf(html)).toContain('74,00 %');
    expect(textOf(html)).toContain('meta 70,00 %');
    expect(textOf(html)).toContain('Cumple la meta');
    expect(html.match(/data-testid="coverage-origin"/g)).toHaveLength(5);
    expect(html).toMatch(/data-origin="rule"[^>]*>.*?148/s);
    expect(textOf(html)).toContain('200 transacciones importadas');
  });

  it('[TC-RULES-ENGINE-045] por debajo de la meta lo dice con texto', () => {
    const html = render(
      <CoverageView
        coverage={{ ...base, count: 198, ruleCoverage: '0.7323', meetsTarget: true, byRule: [] }}
        f={f}
        locale="es-BO"
      />,
    );
    expect(textOf(html)).toContain('73,23 %');
    const below = render(
      <CoverageView
        coverage={{ ...base, ruleCoverage: '0.6667', meetsTarget: false }}
        f={f}
        locale="es-BO"
      />,
    );
    expect(textOf(below)).toContain('No cumple la meta');
    expect(below).toContain('data-meets="false"');
  });
});

describe('origen en el detalle de la transacción', () => {
  const split = {
    id: 's1',
    amount: { amount: '185.40', currency: 'BOB' },
    categoryId: 'c1',
    tagIds: ['t1'],
    categoryOrigin: 'RULE' as const,
    ruleRefs: [
      { field: 'CATEGORY', ruleId: 'r1', ruleVersion: 1, ruleName: 'Supermercado' },
      { field: 'TAG:t1', ruleId: 'r1', ruleVersion: 1, ruleName: 'Supermercado' },
    ],
  };

  it('[TC-RULES-ENGINE-037] muestra la categoría y la etiqueta con su regla y versión', () => {
    const html = render(
      <SplitClassificationView split={split} categoryName="Supermercado" tagName={() => 'hogar'} f={f} />,
    );
    expect(textOf(html)).toContain('Supermercado — por la regla Supermercado (v1)');
    expect(textOf(html)).toContain('Etiqueta hogar — por la regla Supermercado (v1)');
  });

  it('[TC-RULES-ENGINE-038] una corrección manual muestra el origen manual y conserva la etiqueta de la regla', () => {
    const html = render(
      <SplitClassificationView
        split={{ ...split, categoryId: 'c2', categoryOrigin: 'MANUAL', ruleRefs: [split.ruleRefs[1]!] }}
        categoryName="Hogar"
        tagName={() => 'hogar'}
        f={f}
      />,
    );
    expect(html).toContain('data-category-origin="MANUAL"');
    expect(textOf(html)).toContain('elegida por el usuario');
    expect(textOf(html)).toContain('Etiqueta hogar — por la regla Supermercado (v1)');
  });

  it('[TC-RULES-ENGINE-040] una regla archivada se sigue resolviendo con su nombre, versión y la nota «archivada»', () => {
    const html = render(
      <SplitClassificationView
        split={{
          ...split,
          ruleRefs: [
            { field: 'CATEGORY', ruleId: 'r1', ruleVersion: 1, ruleName: 'Supermercado', ruleArchived: true },
          ],
        }}
        categoryName="Supermercado"
        tagName={() => ''}
        f={f}
      />,
    );
    expect(textOf(html)).toContain('por la regla Supermercado (v1, archivada)');
  });

  it('las filas anteriores al motor de reglas dicen que se registraron antes', () => {
    const html = render(
      <SplitClassificationView
        split={{ id: 's', amount: split.amount, categoryId: 'c1' }}
        categoryName="Supermercado"
        tagName={() => ''}
        f={f}
      />,
    );
    expect(textOf(html)).toContain('registrada antes del motor de reglas');
  });
});

describe('marca de revisión', () => {
  const tx = (over: Partial<Transaction> = {}): Transaction =>
    ({
      id: 'tx1',
      kind: 'EXPENSE',
      status: 'POSTED',
      version: 3,
      needsReview: true,
      review: {
        reason: 'RULE',
        ruleId: 'r1',
        ruleVersion: 1,
        ruleName: 'Revisar gastos grandes',
        markedAt: '2026-10-20T14:00:00.000Z',
      },
      ...over,
    }) as unknown as Transaction;

  it('[TC-RULES-ENGINE-057] indica la regla y versión que la marcó y ofrece quitarla al EDITOR', () => {
    const html = render(
      <ReviewBanner
        tx={tx()}
        f={f}
        canEdit
        busy={false}
        onResolve={() => undefined}
        onMark={() => undefined}
      />,
    );
    expect(textOf(html)).toContain('Pendiente de revisión.');
    expect(textOf(html)).toContain('La marcó la regla Revisar gastos grandes (v1).');
    expect(html).toContain('data-testid="review-resolve"');
    const viewer = render(
      <ReviewBanner
        tx={tx()}
        f={f}
        canEdit={false}
        busy={false}
        onResolve={() => undefined}
        onMark={() => undefined}
      />,
    );
    expect(viewer).not.toContain('review-resolve');
  });

  it('una marca del usuario lo dice y sin marca se ofrece marcar; la insignia del listado es texto + icono', () => {
    const user = render(
      <ReviewBanner
        tx={tx({ review: { reason: 'USER', markedAt: '2026-10-20T14:00:00.000Z' } })}
        f={f}
        canEdit
        busy={false}
        onResolve={() => undefined}
        onMark={() => undefined}
      />,
    );
    expect(textOf(user)).toContain('La marcó una persona.');
    const none = render(
      <ReviewBanner
        tx={tx({ needsReview: false, review: null })}
        f={f}
        canEdit
        busy={false}
        onResolve={() => undefined}
        onMark={() => undefined}
      />,
    );
    expect(none).toContain('data-testid="review-mark"');
    expect(render(<NeedsReviewBadge f={tf} />)).toMatch(/aria-hidden="true">⚑<\/span> Por revisar/);
  });
});

describe('crear regla desde una fila', () => {
  it('[TC-RULES-ENGINE-054] el enlace abre el editor prellenado por URL (sin guardar nada)', () => {
    const html = render(
      <CreateRuleLink
        f={f}
        href={href}
        seed={{ description: 'TIGO MONEY RECARGA 77712345', kind: 'EXPENSE', categoryId: 'c1' }}
      />,
    );
    expect(html).toMatch(
      /href="\/es\/reglas\/nueva\?description=TIGO\+MONEY\+RECARGA\+77712345&amp;kind=EXPENSE&amp;categoryId=c1"/,
    );
    expect(textOf(html)).toContain('Crear regla desde esta transacción');
  });
});
