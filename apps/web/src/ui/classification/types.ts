import type { Category, CategoryGroup, Counterparty, Tag } from '../common/types';
import type { CustomFieldDefinition } from '../custom-fields/logic';

/** Ejecuta un comando, informa el resultado (región `status`) o el problema, y recarga los catálogos. */
export type Run = (fn: () => Promise<unknown>, done: string) => Promise<boolean>;

/** Catálogos de clasificación del workspace activo (con o sin archivados, según el filtro). */
export interface ClassificationData {
  readonly groups: readonly CategoryGroup[];
  readonly categories: readonly Category[];
  readonly tags: readonly Tag[];
  readonly counterparties: readonly Counterparty[];
  readonly customFields: readonly CustomFieldDefinition[];
}
