import { LifecycleMachine, type StateTransition } from '@pf/shared-kernel';

/**
 * Estados de las categorías y contrapartes (docs/31 D52): sin eliminación (INV-019), solo archivado. Una categoría o
 * contraparte archivada no acepta asignaciones nuevas pero conserva las históricas.
 */
export const CLASSIFICATION_STATUSES = ['ACTIVE', 'ARCHIVED'] as const;
export type ClassificationStatus = (typeof CLASSIFICATION_STATUSES)[number];

export const CLASSIFICATION_TRANSITIONS = ['CREATE', 'ARCHIVE', 'UNARCHIVE'] as const;
export type ClassificationTransition = (typeof CLASSIFICATION_TRANSITIONS)[number];
export type ClassificationTransitionRecord = StateTransition<ClassificationStatus, ClassificationTransition>;

export type ClassificationLifecycleMachine = LifecycleMachine<ClassificationStatus, ClassificationTransition>;

/** Estado derivado del agregado (`archivedAt`), el mismo que audita el campo `status`. */
export const classificationStatus = (archivedAt: string | null): ClassificationStatus =>
  archivedAt === null ? 'ACTIVE' : 'ARCHIVED';

/**
 * Máquinas `Category` y `Counterparty` (openspec add-lifecycle-timeline, docs/31 D52). Declaradas SOLO con las
 * operaciones existentes (crear, archivar, desarchivar; no hay fusión; grupos y tags quedan fuera). Renombrar, alias,
 * icono, color, orden, grupo y categoría por defecto son anotaciones. Única fuente de las transiciones: cada agregado
 * valida contra su máquina.
 */
function classificationMachine(input: {
  readonly aggregateType: 'Category' | 'Counterparty';
  readonly createGuard: string;
  readonly archiveGuard: string;
  readonly unarchiveGuard: string;
  readonly archiveEvents?: readonly string[];
}): ClassificationLifecycleMachine {
  return LifecycleMachine.define({
    aggregateType: input.aggregateType,
    machineVersion: 1,
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
    ],
  });
}

export const CATEGORY_LIFECYCLE = classificationMachine({
  aggregateType: 'Category',
  createGuard:
    'nombre libre entre las activas del mismo padre; grupo y padre activos; un solo nivel de subcategoría',
  archiveGuard: 'no es de sistema (SYSTEM_CATEGORY_IMMUTABLE); archiva en cascada sus subcategorías activas',
  unarchiveGuard: 'grupo y padre activos (CATEGORY_ARCHIVED); nombre libre',
  archiveEvents: ['classification.CategoryArchived.v1'],
});

export const COUNTERPARTY_LIFECYCLE = classificationMachine({
  aggregateType: 'Counterparty',
  createGuard: 'nombre y alias libres entre las activas; categoría por defecto activa',
  archiveGuard: '—',
  unarchiveGuard: 'nombre y alias libres entre las activas',
});
