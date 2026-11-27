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

/** Un conteo de la vista previa de una fusión (`MergeCount`); `key` es un enum abierto: se toleran claves nuevas. */
export interface MergeCount {
  readonly key: string;
  readonly count: number;
}

/** Referencia legible de un conflicto (`MergeConflict.refs`). */
export interface MergeRef {
  readonly kind: string;
  readonly id: string;
  readonly label: string;
}

/** Conflicto que bloquea la fusión; `reason` es un enum abierto (BUDGET_LINE_EXISTS, TEMPLATE_LINE_EXISTS…). */
export interface MergeConflict {
  readonly reason: string;
  readonly refs: readonly MergeRef[];
}

/** Respuesta de `GET …/{categories|counterparties}/{id}/merge-preview?targetId=` (solo lectura). */
export interface MergePreview {
  readonly source: { readonly id: string; readonly name: string };
  readonly target: { readonly id: string; readonly name: string };
  readonly counts: readonly MergeCount[];
  readonly conflicts: readonly MergeConflict[];
}

/** Destinos posibles de una fusión, agrupados para un `<select>`. */
export interface MergeTargetGroup {
  readonly label: string;
  readonly options: readonly { readonly id: string; readonly label: string }[];
}
