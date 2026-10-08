'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ApiProblemBody } from '../../bff/finance-api-client';
import { ProblemMessage } from '../../errors/ProblemMessage';
import { Tabs } from '../common/Tabs';
import type { Category, CategoryGroup, Counterparty, Tag } from '../common/types';
import { pageStyle } from '../common/ui';
import type { CustomFieldDefinition } from '../custom-fields/logic';
import { listAll, problemOf, useFormat, WithWorkspace, type WorkspaceContext } from '../common/workspace';
import { CategoriesPanel } from './CategoriesPanel';
import { CounterpartiesPanel } from './CounterpartiesPanel';
import { CustomFieldsPanel } from './CustomFieldsPanel';
import { TagsPanel } from './TagsPanel';
import type { ClassificationData, Run } from './types';

export function ClassificationPage({ view }: { view?: string }) {
  return <WithWorkspace>{(ctx) => <Classification ctx={ctx} {...(view ? { view } : {})} />}</WithWorkspace>;
}

const VIEWS: Record<string, string> = {
  categorias: 'categories',
  etiquetas: 'tags',
  contrapartes: 'counterparties',
  campos: 'customFields',
};

/**
 * `/clasificacion` (add-classification 8.1–8.3): pestañas Categorías (árbol grupo → categoría → subcategoría con icono,
 * color y orden persistente: subir/bajar por teclado o arrastrar; archivar/desarchivar; sistema protegidas; catálogo
 * sugerido), Etiquetas, Contrapartes (alias y categoría por defecto) y Campos personalizados (add-custom-fields 6.1). La API decide la autorización: la UI solo oculta
 * las acciones a un VIEWER.
 */
function Classification({ ctx, view }: { ctx: WorkspaceContext; view?: string }) {
  const f = useFormat('Classification', ctx);
  const { t } = f;
  const [showArchived, setShowArchived] = useState(false);
  const [data, setData] = useState<ClassificationData>({
    groups: [],
    categories: [],
    tags: [],
    counterparties: [],
    customFields: [],
  });
  const [problem, setProblem] = useState<ApiProblemBody | undefined>();
  const [status, setStatus] = useState<string | undefined>();

  const load = useCallback(() => {
    const q = new URLSearchParams(showArchived ? { includeArchived: 'true' } : {});
    Promise.all([
      listAll<CategoryGroup>(ctx.api, `${ctx.base}/category-groups`, q),
      listAll<Category>(ctx.api, `${ctx.base}/categories`, q),
      listAll<Tag>(ctx.api, `${ctx.base}/tags`, q),
      listAll<Counterparty>(ctx.api, `${ctx.base}/counterparties`, q),
      listAll<CustomFieldDefinition>(ctx.api, `${ctx.base}/custom-fields`, q),
    ])
      .then(([groups, categories, tags, counterparties, customFields]) =>
        setData({ groups, categories, tags, counterparties, customFields }),
      )
      .catch((err: unknown) => setProblem(problemOf(err)));
  }, [ctx.api, ctx.base, showArchived]);
  useEffect(load, [load]);

  const run: Run = async (fn, done) => {
    setProblem(undefined);
    try {
      await fn();
      setStatus(done);
      load();
      return true;
    } catch (err) {
      setProblem(problemOf(err));
      return false;
    }
  };

  return (
    <section aria-labelledby="classification-title" style={pageStyle} data-testid="classification">
      <h1 id="classification-title">{t('title')}</h1>
      <label style={{ display: 'flex', gap: '0.25rem', alignItems: 'center' }}>
        <input
          type="checkbox"
          name="showArchived"
          checked={showArchived}
          onChange={(e) => setShowArchived(e.target.checked)}
        />
        {t('showArchived')}
      </label>
      <div aria-live="polite">{status ? <p role="status">{status}</p> : null}</div>
      {problem ? <ProblemMessage problem={problem} locale={ctx.uiLocale} /> : null}
      <Tabs
        label={t('sections')}
        idPrefix="classification"
        initial={VIEWS[view ?? ''] ?? 'categories'}
        tabs={[
          {
            id: 'categories',
            label: t('categories'),
            content: <CategoriesPanel ctx={ctx} f={f} data={data} run={run} />,
          },
          { id: 'tags', label: t('tags'), content: <TagsPanel ctx={ctx} f={f} tags={data.tags} run={run} /> },
          {
            id: 'counterparties',
            label: t('counterparties'),
            content: <CounterpartiesPanel ctx={ctx} f={f} data={data} run={run} />,
          },
          {
            id: 'customFields',
            label: t('customFields'),
            content: <CustomFieldsPanel ctx={ctx} definitions={data.customFields} run={run} />,
          },
        ]}
      />
    </section>
  );
}
