import { LifecycleMachine, type StateTransition } from '@pf/shared-kernel';

/**
 * Estados de las categorías y contrapartes (docs/31 D52): sin eliminación (INV-019), solo archivado. Una categoría o
 * contraparte archivada no acepta asignaciones nuevas pero conserva las históricas.
 */
export const CLASSIFICATION_STATUSES = ['ACTIVE', 'ARCHIVED'] as const;
export type ClassificationStatus = (typeof CLASSIFICATION_STATUSES)[number];

export const CLASSIFICATION_TRANSITIONS = ['CREATE', 'ARCHIVE', 'UNARCHIVE', 'MERGE'] as const;
export type ClassificationTransition = (typeof CLASSIFICATION_TRANSITIONS)[number];
export type ClassificationTransitionRecord = StateTransition<ClassificationStatus, ClassificationTransition>;

export type ClassificationLifecycleMachine = LifecycleMachine<ClassificationStatus, ClassificationTransition>;

/** Estado derivado del agregado (`archivedAt`), el mismo que audita el campo `status`. */
export const classificationStatus = (archivedAt: string | null): ClassificationStatus =>
  archivedAt === null ? 'ACTIVE' : 'ARCHIVED';

/**
 * Máquinas `Category` y `Counterparty` (openspec add-lifecycle-timeline, docs/31 D52). Versión 1: crear, archivar y
 * desarchivar. Versión 2 (openspec add-category-and-counterparty-merge, D52 revisada por D480): suma `MERGE`, una
 * transición hacia `ARCHIVED` desde `ACTIVE` o desde `ARCHIVED` (una origen ya archivada se puede fusionar, D497);
 * grupos y tags quedan fuera. Renombrar, alias, icono, color, orden, grupo, categoría por defecto, `MERGED_FROM` y
 * `MOVED` son anotaciones. Única fuente de las transiciones: cada agregado valida contra su máquina. Los recorridos de
 * la versión 1 se leen igual.
 */
function classificationMachine(input: {
  readonly aggregateType: 'Category' | 'Counterparty';
  readonly createGuard: string;
  readonly archiveGuard: string;
  readonly unarchiveGuard: string;
  readonly mergeGuard: string;
  readonly archiveEvents?: readonly string[];
  readonly mergeEvents: readonly string[];
}): ClassificationLifecycleMachine {
  return LifecycleMachine.define({
    aggregateType: input.aggregateType,
    machineVersion: 2,
    states: [
      { code: 'ACTIVE', terminal: false },
      { code: 'ARCHIVED', terminal: false },
    ],
    transitions: [
      { code: 'CREATE', from: [], to: ['ACTIVE'], guard: input.createGuard, events: [] },
      {
        code: 'ARCHIVE',
        from: ['ACTIVE'],
        to: ['ARCHIVED'],
        guard: input.archiveGuard,
        events: input.archiveEvents ?? [],
      },
      { code: 'UNARCHIVE', from: ['ARCHIVED'], to: ['ACTIVE'], guard: input.unarchiveGuard, events: [] },
      {
        code: 'MERGE',
        from: ['ACTIVE', 'ARCHIVED'],
        to: ['ARCHIVED'],
        guard: input.mergeGuard,
        events: input.mergeEvents,
      },
    ],
  });
}

export const CATEGORY_LIFECYCLE = classificationMachine({
  aggregateType: 'Category',
  createGuard:
    'nombre libre entre las activas del mismo padre; grupo y padre activos; un solo nivel de subcategoría',
  archiveGuard: 'no es de sistema (SYSTEM_CATEGORY_IMMUTABLE); archiva en cascada sus subcategorías activas',
  unarchiveGuard: 'grupo y padre activos (CATEGORY_ARCHIVED); nombre libre; no fusionada (CATEGORY_MERGED)',
  mergeGuard:
    'origen no de sistema ni fusionada; destino activa, distinta y del mismo tipo; sin conflictos; la origen queda archivada y marcada «fusionada en» la destino',
  archiveEvents: ['classification.CategoryArchived.v1'],
  mergeEvents: ['classification.CategoriesMerged.v1'],
});

export const COUNTERPARTY_LIFECYCLE = classificationMachine({
  aggregateType: 'Counterparty',
  createGuard: 'nombre y alias libres entre las activas; categoría por defecto activa',
  archiveGuard: '—',
  unarchiveGuard: 'nombre y alias libres entre las activas; no fusionada (COUNTERPARTY_MERGED)',
  mergeGuard:
    'origen no fusionada; destino activa y distinta; la origen queda archivada y marcada «fusionada en» la destino',
  mergeEvents: ['classification.CounterpartiesMerged.v1'],
});
