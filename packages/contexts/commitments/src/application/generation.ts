import type { LifecycleEventRefDto } from '@pf/audit/contracts';
import { LocalDate } from '@pf/shared-kernel';
import { COMMITMENTS_EVENTS, type OccurrencesGeneratedV1 } from '../contracts/index.js';
import {
  OccurrenceGenerator,
  RecurringOccurrence,
  type Candidate,
  type RecurringDefinition,
} from '../domain/index.js';
import type { CommitmentsDeps } from './ports/index.js';
import {
  DEFINITION_AGGREGATE,
  occurrenceChanges,
  occurrenceEntry,
  occurrenceSteps,
  publishEvent,
  recordOccurrences,
} from './recorder.js';

export interface GenerationResult {
  /** Ocurrencias efectivamente insertadas (las que `ON CONFLICT DO NOTHING` descartó no figuran). */
  readonly inserted: readonly RecurringOccurrence[];
  readonly window: { readonly from: string; readonly to: string } | null;
  readonly event: LifecycleEventRefDto | null;
}

const payloadOccurrence = (o: RecurringOccurrence, kind: string) => {
  const s = o.snapshot;
  return {
    occurrenceId: s.id,
    occurrenceDate: s.occurrenceDate,
    dueDate: s.dueDate,
    expected: { type: s.expected.type, amount: s.expected.amount, min: s.expected.min, max: s.expected.max },
    currency: s.currency,
    kind,
  };
};

/**
 * Inicio de la ventana de la primera generación (D131): `max(dtstart, inicio del periodo financiero que contiene hoy)`;
 * sin periodo, el primer día del mes calendario.
 */
async function firstWindowStart(
  deps: CommitmentsDeps,
  def: RecurringDefinition,
  today: LocalDate,
): Promise<LocalDate> {
  const period = await deps.periods.getPeriodContaining({
    workspaceId: def.workspaceId,
    date: today.toString(),
  });
  const periodStart = period ? LocalDate.parse(period.periodStart) : LocalDate.of(today.year, today.month, 1);
  const first = def.versions[0];
  return OccurrenceGenerator.initialStart(first ? first.schedule.startDate : today.toString(), periodStart);
}

/**
 * Generación idempotente por ventana deslizante (design decisión 6): la ventana va de la siguiente fecha al
 * high-water mark hasta `hoy + horizonte`. El repositorio hace `INSERT … ON CONFLICT DO NOTHING RETURNING` y solo las
 * filas insertadas producen hechos, auditoría y recorrido; re-ejecutar no inserta nada y no emite. El llamador ya
 * tomó `FOR UPDATE` de la definición y guarda el agregado después.
 */
export async function generateOccurrences(
  deps: CommitmentsDeps,
  def: RecurringDefinition,
  input: { readonly today: LocalDate; readonly by: string | null },
): Promise<GenerationResult> {
  if (def.status !== 'ACTIVE') return { inserted: [], window: null, event: null };
  const to = input.today.plusDays(deps.horizonDays);
  const s = def.snapshot;
  const from = s.generatedThrough
    ? LocalDate.parse(s.generatedThrough).plusDays(1)
    : await firstWindowStart(deps, def, input.today);
  if (from.compare(to) > 0) return { inserted: [], window: null, event: null };

  const at = deps.clock.now().toString();
  const existing = new Set(
    (await deps.occurrences.listExisting(s.workspaceId, s.id, from.toString())).map((o) => o.occurrenceDate),
  );
  const wanted: Candidate[] = OccurrenceGenerator.plan(def, { from, to }, existing);
  const created = wanted.map((c) =>
    RecurringOccurrence.generate({
      id: deps.ids.next(),
      workspaceId: s.workspaceId,
      definitionId: s.id,
      occurrenceDate: c.occurrenceDate.toString(),
      dueDate: c.dueDate.toString(),
      definitionVersionNo: c.versionNo,
      expected: c.expected,
      currency: c.currency,
      at,
    }),
  );
  const inserted = created.length > 0 ? await deps.occurrences.insertIfAbsent(created) : [];
  def.setGeneratedThrough(to.toString());
  if (inserted.length === 0) {
    return { inserted, window: { from: from.toString(), to: to.toString() }, event: null };
  }

  def.touch(at, input.by);
  const dv = def.snapshot;
  const payload: OccurrencesGeneratedV1 = {
    workspaceId: dv.workspaceId,
    definitionId: dv.id,
    definitionVersionNo: dv.currentVersionNo,
    window: { from: from.toString(), to: to.toString() },
    occurrences: inserted.map((o) => payloadOccurrence(o, dv.kind)) as OccurrencesGeneratedV1['occurrences'],
  };
  const event = await publishEvent(
    deps,
    {
      workspaceId: dv.workspaceId,
      aggregateType: DEFINITION_AGGREGATE,
      aggregateId: dv.id,
      aggregateVersion: dv.version,
    },
    COMMITMENTS_EVENTS.occurrencesGenerated,
    payload,
  );
  await recordOccurrences(
    deps,
    inserted.map((o) => ({
      entry: occurrenceEntry(o, 'generated', occurrenceChanges(null, o.snapshot)),
      steps: occurrenceSteps(o, [event]),
    })),
  );
  return { inserted, window: { from: from.toString(), to: to.toString() }, event };
}
