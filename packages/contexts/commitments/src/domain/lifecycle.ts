import { LifecycleMachine, type StateTransition } from '@pf/shared-kernel';

/** Máquina `RecurringDefinition` (design decisión 8; docs/31 D37). Nombre, descripción y notas son anotaciones. */
export const DEFINITION_STATUSES = ['ACTIVE', 'PAUSED', 'ENDED'] as const;
export type DefinitionStatus = (typeof DEFINITION_STATUSES)[number];
export type DefinitionTransition = 'CREATE' | 'PAUSE' | 'RESUME' | 'REVISE' | 'END';
export type DefinitionTransitionRecord = StateTransition<DefinitionStatus, DefinitionTransition>;

const DEFINITION_EVENT = 'commitments.RecurringDefinitionChanged.v1';

export const RECURRING_DEFINITION_LIFECYCLE = LifecycleMachine.define({
  aggregateType: 'RecurringDefinition',
  machineVersion: 1,
  states: [
    { code: 'ACTIVE', terminal: false },
    { code: 'PAUSED', terminal: false },
    { code: 'ENDED', terminal: true },
  ],
  transitions: [
    {
      code: 'CREATE',
      from: [],
      to: ['ACTIVE'],
      guard: 'datos válidos y cuentas, categoría y contraparte utilizables',
      events: [DEFINITION_EVENT, 'commitments.OccurrencesGenerated.v1'],
    },
    {
      code: 'PAUSE',
      from: ['ACTIVE'],
      to: ['PAUSED'],
      guard: 'cancela las ocurrencias no resueltas desde hoy',
      events: [DEFINITION_EVENT],
    },
    {
      code: 'RESUME',
      from: ['PAUSED'],
      to: ['ACTIVE'],
      guard: 'reinstaura las canceladas por la pausa desde hoy y genera las faltantes',
      events: [DEFINITION_EVENT, 'commitments.OccurrencesGenerated.v1'],
    },
    {
      code: 'REVISE',
      from: ['ACTIVE', 'PAUSED'],
      to: ['ACTIVE', 'PAUSED'],
      guard: 'versión nueva inmutable; fecha efectiva posterior a la última ocurrencia resuelta',
      events: [DEFINITION_EVENT, 'commitments.OccurrencesGenerated.v1'],
    },
    {
      code: 'END',
      from: ['ACTIVE', 'PAUSED'],
      to: ['ENDED'],
      guard: 'fecha de fin desde hoy, o fin de la serie (COUNT/UNTIL) ya vencida',
      events: [DEFINITION_EVENT],
    },
  ],
});

/** Máquina `RecurringOccurrence` (design decisión 8). Editar monto o fecha es anotación, no transición. */
export const OCCURRENCE_STATUSES = [
  'SCHEDULED',
  'DUE',
  'OVERDUE',
  'MATERIALIZED',
  'MATCHED',
  'SKIPPED',
  'CANCELLED',
] as const;
export type OccurrenceStatus = (typeof OCCURRENCE_STATUSES)[number];
export type OccurrenceTransition =
  | 'GENERATE'
  | 'BECOME_DUE'
  | 'MARK_OVERDUE'
  | 'MATERIALIZE'
  | 'LINK'
  | 'SKIP'
  | 'RELEASE'
  | 'CANCEL'
  | 'REINSTATE';
export type OccurrenceTransitionRecord = StateTransition<OccurrenceStatus, OccurrenceTransition>;

/** Estados sin resolver: pueden aprobarse, vincularse, omitirse, editarse o cancelarse. */
export const UNRESOLVED_STATUSES = ['SCHEDULED', 'DUE', 'OVERDUE'] as const;
export type UnresolvedStatus = (typeof UNRESOLVED_STATUSES)[number];
export const isUnresolved = (status: OccurrenceStatus): status is UnresolvedStatus =>
  (UNRESOLVED_STATUSES as readonly string[]).includes(status);

export const RECURRING_OCCURRENCE_LIFECYCLE = LifecycleMachine.define({
  aggregateType: 'RecurringOccurrence',
  machineVersion: 1,
  states: [
    { code: 'SCHEDULED', terminal: false },
    { code: 'DUE', terminal: false },
    { code: 'OVERDUE', terminal: false },
    { code: 'MATERIALIZED', terminal: false },
    { code: 'MATCHED', terminal: false },
    { code: 'SKIPPED', terminal: true },
    { code: 'CANCELLED', terminal: false },
  ],
  transitions: [
    {
      code: 'GENERATE',
      from: [],
      to: ['SCHEDULED'],
      guard: 'una vez por (definición, fecha nominal)',
      events: ['commitments.OccurrencesGenerated.v1'],
    },
    {
      code: 'BECOME_DUE',
      from: ['SCHEDULED'],
      to: ['DUE'],
      guard: 'hoy ≥ vencimiento − anticipación (zona horaria del workspace)',
      events: ['commitments.RecurringOccurrenceDue.v1'],
    },
    {
      code: 'MARK_OVERDUE',
      from: ['SCHEDULED', 'DUE'],
      to: ['OVERDUE'],
      guard: 'hoy > vencimiento',
      events: ['commitments.RecurringOccurrenceChanged.v1'],
    },
    {
      code: 'MATERIALIZE',
      from: ['SCHEDULED', 'DUE', 'OVERDUE'],
      to: ['MATERIALIZED'],
      guard: 'transacción creada en la misma unidad de trabajo; periodo abierto',
      events: ['commitments.RecurringOccurrenceMaterialized.v1'],
    },
    {
      code: 'LINK',
      from: ['SCHEDULED', 'DUE', 'OVERDUE'],
      to: ['MATCHED'],
      guard: 'transacción compatible y libre',
      events: ['commitments.RecurringOccurrenceMaterialized.v1'],
    },
    {
      code: 'SKIP',
      from: ['SCHEDULED', 'DUE', 'OVERDUE'],
      to: ['SKIPPED'],
      guard: 'ocurrencia sin resolver',
      events: ['commitments.RecurringOccurrenceChanged.v1'],
    },
    {
      code: 'RELEASE',
      from: ['MATERIALIZED', 'MATCHED'],
      to: ['SCHEDULED', 'DUE', 'OVERDUE'],
      guard:
        'la transacción vinculada fue anulada (SCHEDULED solo al devolver una cuota de préstamo aún lejana)',
      events: ['commitments.RecurringOccurrenceChanged.v1'],
    },
    {
      code: 'CANCEL',
      from: ['SCHEDULED', 'DUE', 'OVERDUE'],
      to: ['CANCELLED'],
      guard: 'pausa, revisión o fin de la definición (cancelReason PAUSED|SUPERSEDED|ENDED)',
      events: ['commitments.RecurringDefinitionChanged.v1'],
    },
    {
      code: 'REINSTATE',
      from: ['CANCELLED'],
      to: ['SCHEDULED'],
      guard: 'la reanudación o una revisión vuelve a producir la fecha',
      events: ['commitments.RecurringDefinitionChanged.v1', 'commitments.OccurrencesGenerated.v1'],
    },
  ],
});
