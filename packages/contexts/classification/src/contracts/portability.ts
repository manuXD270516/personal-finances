import type { PortabilitySection } from '@pf/shared-kernel';

/**
 * Secciones de exportación/importación del workspace que pertenecen a CLASSIFICATION (openspec add-workspace-export):
 * grupos y categorías (con las de sistema), contrapartes y sus alias, etiquetas y definiciones de custom fields. El
 * nombre de las categorías de sistema por idioma (`classification.category_name_i18n`) es catálogo global, no del workspace.
 */
export const CLASSIFICATION_PORTABILITY_SECTIONS: readonly PortabilitySection[] = [
  { name: 'category-groups', context: 'classification', table: 'classification.category_group', order: 300, orderBy: ['id'] },
  {
    name: 'categories',
    context: 'classification',
    table: 'classification.category',
    order: 310,
    orderBy: ['id'],
    selfRefs: ['parent_id'],
  },
  { name: 'counterparties', context: 'classification', table: 'classification.counterparty', order: 320, orderBy: ['id'] },
  {
    name: 'counterparty-aliases',
    context: 'classification',
    table: 'classification.counterparty_alias',
    order: 330,
    orderBy: ['counterparty_id', 'alias_normalized'],
    idColumns: [],
  },
  { name: 'tags', context: 'classification', table: 'classification.tag', order: 340, orderBy: ['id'] },
  {
    name: 'custom-field-definitions',
    context: 'classification',
    table: 'classification.custom_field_definition',
    order: 350,
    orderBy: ['id'],
  },
];
