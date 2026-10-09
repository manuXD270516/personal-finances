import type { PortabilitySection } from '@pf/shared-kernel';

/**
 * Secciones de exportación/importación del workspace que pertenecen a ACCOUNTS (openspec add-workspace-export, regla de
 * cobertura de tablas): instituciones, cuentas, etiquetas de cuenta y valores de custom fields de cuenta.
 */
export const ACCOUNTS_PORTABILITY_SECTIONS: readonly PortabilitySection[] = [
  { name: 'institutions', context: 'accounts', table: 'accounts.institution', order: 400, orderBy: ['id'] },
  { name: 'accounts', context: 'accounts', table: 'accounts.account', order: 410, orderBy: ['id'] },
  {
    name: 'account-tags',
    context: 'accounts',
    table: 'accounts.account_tag',
    order: 420,
    orderBy: ['account_id', 'tag_id'],
    idColumns: [],
  },
  {
    name: 'account-custom-field-values',
    context: 'accounts',
    table: 'accounts.account_custom_field_value',
    order: 430,
    orderBy: ['account_id', 'field_id'],
    idColumns: [],
  },
];
