'use client';

import type { ReactNode } from 'react';
import { Tabs } from '../common/Tabs';
import { cardStyle } from '../common/ui';
import { useFormat, type WorkspaceContext } from '../common/workspace';
import type { FormatContext } from '../dashboard/types';
import { LifecycleTab } from '../lifecycle/LifecycleTab';

export type DetailMode = 'edit' | 'lifecycle';

/**
 * Detalle de una categoría o contraparte (docs/31 D52; add-lifecycle-timeline tarea 9.6) dentro de su fila: pestañas
 * "Editar" (solo OWNER/EDITOR) y "Recorrido" (todos los roles, VIEWER incluido) con el `LifecycleReport` y las
 * acciones "Exportar CSV" / "Exportar PDF". `mode` elige la pestaña inicial (botón "Editar" o "Recorrido" de la fila).
 */
export function ClassificationDetail({
  ctx,
  f,
  mode,
  name,
  path,
  version,
  idPrefix,
  edit,
}: {
  ctx: WorkspaceContext;
  /** Formato del namespace `Classification`. */
  f: FormatContext;
  mode: DetailMode;
  name: string;
  /** Recurso relativo al workspace: `categories/{id}` o `counterparties/{id}`. */
  path: string;
  version: number;
  idPrefix: string;
  edit?: ReactNode;
}) {
  const lf = useFormat('Lifecycle', ctx);
  const label = (prefix: string, key: string) => (f.has(`${prefix}.${key}`) ? f.t(`${prefix}.${key}`) : key);
  const tabs = [
    ...(edit ? [{ id: 'edit', label: f.t('detailTabs.edit'), content: edit }] : []),
    {
      id: 'lifecycle',
      label: lf.t('tabs.lifecycle'),
      content: (
        <LifecycleTab
          ctx={ctx}
          path={path}
          refreshKey={version}
          stateLabel={(code) => label('states', code)}
          fieldLabel={(field) => label('fields', field)}
          idPrefix={idPrefix}
        />
      ),
    },
  ];
  return (
    <div style={{ ...cardStyle, padding: '0.5rem 0.75rem' }} data-testid={`${idPrefix}-detail`}>
      <Tabs
        key={mode}
        label={f.t('detailTabs.label', { name })}
        tabs={tabs}
        idPrefix={idPrefix}
        initial={edit ? mode : 'lifecycle'}
      />
    </div>
  );
}
