import { DomainError } from '@pf/shared-kernel';
import { describe, expect, it } from 'vitest';
import { CommitmentsQueries } from './commitments.queries.js';
import { DefinitionsService, type CreateDefinitionCommand } from './definitions.service.js';
import { MatchingQueries } from './matching.queries.js';
import { MatchingService } from './matching.service.js';
import { OccurrencesService } from './occurrences.service.js';
import {
  BANK,
  CASH,
  CATEGORY,
  InMemoryCommitments,
  SAVINGS,
  USER,
  WS,
  type FakeTransaction,
} from './testing/in-memory.js';

const bob = (amount: string) => ({ amount, currency: 'BOB' });
/** 12:00 en America/La_Paz = 16:00Z. */
const noon = (date: string) => `${date}T16:00:00Z`;
const TIGO = '0190a000-0000-7000-8000-0000000c1001';
const ENTEL = '0190a000-0000-7000-8000-0000000c1002';

function setup(now = '2026-10-19') {
  const mem = new InMemoryCommitments();
  const deps = mem.deps();
  const defs = new DefinitionsService(deps);
  const occs = new OccurrencesService(deps);
  const matching = new MatchingService(deps, occs);
  const queries = new MatchingQueries(deps);
  const committed = new CommitmentsQueries(deps);
  mem.setNow(noon(now));
  let eventSeq = 0;
  const eventId = () => `0190a000-0000-7000-8000-${String(900_000 + (eventSeq += 1)).padStart(12, '0')}`;
  /** Entrega al consumidor `occurrence-matcher` el hecho de una transacción (como el worker). */
  const created = (transactionId: string, id: string = eventId()) =>
    matching.onTransactionChanged({ workspaceId: WS, transactionId, eventId: id });
  let backfilled = 0;
  /** Entrega al consumidor `match-backfill` los hechos del motor que aún no recibió. */
  const backfill = async () => {
    while (backfilled < mem.events.length) {
      const event = mem.events[backfilled]!;
      backfilled += 1;
      const ids: string[] = [];
      if (event.eventType === 'commitments.OccurrencesGenerated') {
        for (const o of event.payload['occurrences'] as { occurrenceId: string }[]) ids.push(o.occurrenceId);
      } else if (event.eventType === 'commitments.RecurringDefinitionChanged') {
        ids.push(
          ...(event.payload['reinstatedOccurrenceIds'] as string[]),
          ...(event.payload['rewrittenOccurrenceIds'] as string[]),
        );
      } else continue;
      await matching.onOccurrencesAvailable({ workspaceId: WS, occurrenceIds: ids, eventId: eventId() });
    }
  };
  return { mem, deps, defs, occs, matching, queries, committed, created, backfill, eventId };
}
type S = ReturnType<typeof setup>;

function template(
  over: Partial<CreateDefinitionCommand['template']> = {},
): CreateDefinitionCommand['template'] {
  return {
    accountId: BANK,
    amount: { type: 'FIXED', amount: bob('199.00') },
    categoryId: CATEGORY,
    schedule: { cadence: 'MONTHLY', interval: 1, startDate: '2026-10-20' },
    materialization: { mode: 'PENDING_APPROVAL', leadDays: 3 },
    ...over,
  };
}

const create = (
  s: S,
  name: string,
  over: Partial<CreateDefinitionCommand['template']> = {},
  kind = 'EXPENSE',
) => s.defs.create({ workspaceId: WS, userId: USER, name, kind, template: template(over) });

/** El "Internet" de 199.00 BOB que vence el 2026-10-20 y su primera ocurrencia. */
async function internet(s: S, over: Partial<CreateDefinitionCommand['template']> = {}) {
  const def = await create(s, 'Internet', over);
  const occurrence = s.mem.forDefinition(def.id)[0]!;
  return { def, occurrence };
}

const expense = (s: S, over: Partial<FakeTransaction> = {}): string =>
  s.mem.addTransaction({
    kind: 'EXPENSE',
    accountId: BANK,
    amount: bob('199.00'),
    businessDate: '2026-10-19',
    ...over,
  });

const edit = (s: S, id: string, patch: Partial<FakeTransaction>) => {
  const t = s.mem.transactionsStore.get(id)!;
  s.mem.transactionsStore.set(id, { ...t, ...patch });
};

const codeOf = async (fn: () => Promise<unknown>): Promise<string | undefined> => {
  try {
    await fn();
  } catch (err) {
    return err instanceof DomainError ? err.code : `no-domain:${String(err)}`;
  }
  return undefined;
};

const suggested = (s: S) => s.mem.eventsOf('commitments.OccurrenceMatchSuggested');

describe('Sugerencia de coincidencia para una transacción registrada (FR-COMMITMENTS-010)', () => {
  it('[TC-COMMITMENTS-MATCH-001] un gasto manual compatible genera una sugerencia HIGH de 85.00 sin resolver la ocurrencia', async () => {
    const s = setup();
    const { occurrence } = await internet(s);
    const txId = expense(s);
    await s.created(txId);
    const suggestion = s.mem.suggestionFor(occurrence.id, txId);
    expect(suggestion).toMatchObject({
      status: 'PROPOSED',
      score: '85.00',
      confidence: 'HIGH',
      amountDelta: '0.00',
      currency: 'BOB',
      dateDeltaDays: 1,
      counterparty: 'UNKNOWN',
      ambiguous: false,
    });
    // la ocurrencia y la transacción siguen sin tocarse
    expect(s.mem.occurrence(occurrence.id)).toMatchObject({ transactionId: null, resolution: null });
    expect(['SCHEDULED', 'DUE']).toContain(s.mem.occurrence(occurrence.id).status);
    expect(s.mem.eventsOf('commitments.RecurringOccurrenceMaterialized')).toEqual([]);
  });

  it('[TC-COMMITMENTS-MATCH-001] el hecho entregado dos veces deja una sola sugerencia y un solo evento', async () => {
    const s = setup();
    const { occurrence } = await internet(s);
    const txId = expense(s);
    await s.created(txId);
    await s.created(txId);
    await Promise.all([s.created(txId), s.created(txId)]);
    expect(s.mem.suggestions().filter((x) => x.occurrenceId === occurrence.id)).toHaveLength(1);
    expect(suggested(s)).toHaveLength(1);
  });

  it('[TC-COMMITMENTS-MATCH-002] un gasto en una cuenta sin ocurrencias no genera sugerencias', async () => {
    const s = setup();
    await internet(s);
    await s.created(expense(s, { accountId: CASH, amount: bob('45.90') }));
    expect(s.mem.suggestions()).toEqual([]);
    expect(suggested(s)).toEqual([]);
  });

  it('[TC-COMMITMENTS-MATCH-005] una coincidencia exacta importada genera 100.00 HIGH y NO vincula nada', async () => {
    const s = setup('2026-10-20');
    const def = await create(s, 'Internet', { counterpartyId: TIGO });
    const occurrence = s.mem.forDefinition(def.id)[0]!;
    const txId = expense(s, { source: 'IMPORT', counterpartyId: TIGO, businessDate: '2026-10-20' });
    await s.created(txId);
    expect(s.mem.suggestionFor(occurrence.id, txId)).toMatchObject({ score: '100.00', confidence: 'HIGH' });
    expect(s.mem.occurrence(occurrence.id)).toMatchObject({ transactionId: null, resolution: null });
    expect(s.mem.eventsOf('commitments.RecurringOccurrenceMaterialized')).toEqual([]);
    expect(suggested(s)[0]?.payload).toMatchObject({ transactionOrigin: 'IMPORT', score: '100.00' });
  });

  it('una transacción creada por una ocurrencia, o anulada, jamás genera sugerencias', async () => {
    const s = setup();
    const { occurrence } = await internet(s);
    const approved = await s.occs.materialize({ workspaceId: WS, userId: USER, occurrenceId: occurrence.id });
    await s.created(approved.transactionId);
    const voided = expense(s, { status: 'VOIDED' });
    await s.created(voided);
    expect(s.mem.suggestions()).toEqual([]);
  });

  it('una transacción ya vinculada a otra ocurrencia no se sugiere', async () => {
    const s = setup();
    const a = await internet(s);
    const txId = expense(s);
    await s.occs.link({ workspaceId: WS, userId: USER, occurrenceId: a.occurrence.id, transactionId: txId });
    await create(s, 'Internet oficina', { schedule: { cadence: 'MONTHLY', startDate: '2026-10-21' } });
    await s.created(txId);
    expect(s.mem.suggestions()).toEqual([]);
  });
});

describe('Criterios de compatibilidad y tolerancias por definición', () => {
  it('[TC-COMMITMENTS-MATCH-003] 205.00 sobre un FIXED de 199.00 no se sugiere', async () => {
    const s = setup();
    await internet(s);
    await s.created(expense(s, { amount: bob('205.00') }));
    expect(s.mem.suggestions()).toEqual([]);
  });

  it('[TC-COMMITMENTS-MATCH-003] la luz ESTIMATED de 150.00 con un gasto de 163.40 a 2 días se sugiere', async () => {
    const s = setup('2026-10-27');
    const def = await create(s, 'Luz', {
      amount: { type: 'ESTIMATED', amount: bob('150.00') },
      schedule: { cadence: 'MONTHLY', startDate: '2026-10-25' },
    });
    const occurrence = s.mem.forDefinition(def.id)[0]!;
    const txId = expense(s, { amount: bob('163.40'), businessDate: '2026-10-27' });
    await s.created(txId);
    expect(s.mem.suggestionFor(occurrence.id, txId)).toMatchObject({
      amountDelta: '13.40',
      dateDeltaDays: 2,
    });
  });

  it('[TC-COMMITMENTS-MATCH-004] una contraparte distinta no se sugiere', async () => {
    const s = setup();
    await internet(s, { counterpartyId: TIGO });
    await s.created(expense(s, { counterpartyId: ENTEL }));
    expect(s.mem.suggestions()).toEqual([]);
  });

  it('[TC-COMMITMENTS-MATCH-004] la tolerancia y la ventana configuradas en la definición se respetan', async () => {
    const s = setup();
    const { def } = await internet(s);
    const updated = await s.defs.updateDetails({
      workspaceId: WS,
      userId: USER,
      definitionId: def.id,
      expectedVersion: def.version,
      matching: { amountTolerancePercent: '5', dateWindowDays: 2 },
    });
    expect(updated.matching).toEqual({ amountTolerancePercent: '5.00', dateWindowDays: 2 });
    const late = expense(s, { amount: bob('205.00'), businessDate: '2026-10-23' });
    await s.created(late);
    expect(s.mem.suggestions()).toEqual([]);
    const ok = expense(s, { amount: bob('205.00'), businessDate: '2026-10-21' });
    await s.created(ok);
    expect(s.mem.suggestions()).toHaveLength(1);
    expect(s.mem.suggestions()[0]).toMatchObject({ transactionId: ok, status: 'PROPOSED' });
  });

  it('SetMatchingTolerances valida los rangos, audita el cambio y `null` restablece el valor por omisión', async () => {
    const s = setup();
    const { def } = await internet(s);
    const base = { workspaceId: WS, userId: USER, definitionId: def.id };
    expect(
      await codeOf(() =>
        s.defs.updateDetails({ ...base, expectedVersion: def.version, matching: { dateWindowDays: 16 } }),
      ),
    ).toBe('VALIDATION_FAILED');
    expect(
      await codeOf(() =>
        s.defs.updateDetails({
          ...base,
          expectedVersion: def.version,
          matching: { amountTolerancePercent: '100.01' },
        }),
      ),
    ).toBe('VALIDATION_FAILED');
    const set = await s.defs.updateDetails({
      ...base,
      expectedVersion: def.version,
      matching: { amountTolerancePercent: '10', dateWindowDays: 15 },
    });
    const audit = s.mem.recordedFor(def.id).find((r) => r.entry.action.endsWith('.updated'));
    expect(audit?.entry.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'matchingAmountTolerancePct', before: null, after: '10.00' }),
        expect.objectContaining({ field: 'matchingDateWindowDays', before: null, after: 15 }),
      ]),
    );
    const reset = await s.defs.updateDetails({
      ...base,
      expectedVersion: set.version,
      matching: { amountTolerancePercent: null, dateWindowDays: null },
    });
    expect(reset.matching).toEqual({ amountTolerancePercent: null, dateWindowDays: null });
  });
});

describe('Ranking de candidatas', () => {
  async function twoInternets(s: S) {
    const casa = await create(s, 'Internet casa');
    const oficina = await create(s, 'Internet oficina', {
      schedule: { cadence: 'MONTHLY', startDate: '2026-10-22' },
    });
    return {
      casa: s.mem.forDefinition(casa.id)[0]!,
      oficina: s.mem.forDefinition(oficina.id)[0]!,
    };
  }

  it('[TC-COMMITMENTS-MATCH-009] el gasto del día 20 sugiere casa 90.00 y oficina 80.00 sin ambigüedad', async () => {
    const s = setup('2026-10-20');
    const { casa, oficina } = await twoInternets(s);
    const txId = expense(s, { businessDate: '2026-10-20' });
    await s.created(txId);
    expect(s.mem.suggestionFor(casa.id, txId)).toMatchObject({ score: '90.00', ambiguous: false });
    expect(s.mem.suggestionFor(oficina.id, txId)).toMatchObject({ score: '80.00', ambiguous: false });
    const listed = await s.queries.list(WS, { statuses: ['PROPOSED'] });
    expect(listed.data.map((d) => d.occurrence?.definitionName)).toEqual([
      'Internet casa',
      'Internet oficina',
    ]);
    expect(listed.proposedCount).toBe(2);
  });

  it('[TC-COMMITMENTS-MATCH-009] el gasto del día 21 empata en 85.00 y ambas quedan ambiguas', async () => {
    const s = setup('2026-10-21');
    const { casa, oficina } = await twoInternets(s);
    const txId = expense(s, { businessDate: '2026-10-21' });
    await s.created(txId);
    expect(s.mem.suggestionFor(casa.id, txId)).toMatchObject({ score: '85.00', ambiguous: true });
    expect(s.mem.suggestionFor(oficina.id, txId)).toMatchObject({ score: '85.00', ambiguous: true });
  });
});

describe('Confirmar y descartar (EDITOR/OWNER)', () => {
  it('[TC-COMMITMENTS-MATCH-006] confirmar vincula por sugerencia, expira las demás y saca el pago del comprometido', async () => {
    const s = setup();
    const casa = await create(s, 'Internet');
    const oficina = await create(s, 'Internet oficina', {
      schedule: { cadence: 'MONTHLY', startDate: '2026-10-22' },
    });
    const casaOcc = s.mem.forDefinition(casa.id)[0]!;
    const oficinaOcc = s.mem.forDefinition(oficina.id)[0]!;
    const txId = expense(s);
    const other = expense(s, { businessDate: '2026-10-18' });
    await s.created(txId);
    await s.created(other);
    const sug = s.mem.suggestionFor(casaOcc.id, txId)!;
    const sugOfficina = s.mem.suggestionFor(oficinaOcc.id, txId)!;
    const sugOtherTx = s.mem.suggestionFor(casaOcc.id, other)!;
    expect((await s.committed.getCommitted(WS)).byCurrency[0]?.occurrences).toEqual(bob('398.00'));

    const result = await s.matching.confirm({ workspaceId: WS, userId: USER, suggestionId: sug.id });

    expect(result.occurrence).toMatchObject({
      status: 'MATCHED',
      matchedBy: 'SUGGESTION',
      transactionId: txId,
    });
    expect(s.mem.occurrence(casaOcc.id)).toMatchObject({
      status: 'MATCHED',
      resolution: 'MATCHED',
      matchedBy: 'SUGGESTION',
      transactionId: txId,
    });
    expect(s.mem.suggestions().find((x) => x.id === sug.id)).toMatchObject({
      status: 'CONFIRMED',
      decidedBy: USER,
    });
    expect(s.mem.suggestions().find((x) => x.id === sugOfficina.id)).toMatchObject({
      status: 'EXPIRED',
      expireReason: 'SUPERSEDED',
    });
    expect(s.mem.suggestions().find((x) => x.id === sugOtherTx.id)).toMatchObject({
      status: 'EXPIRED',
      expireReason: 'SUPERSEDED',
    });
    const materialized = s.mem.eventsOf('commitments.RecurringOccurrenceMaterialized');
    expect(materialized).toHaveLength(1);
    expect(materialized[0]?.payload).toMatchObject({
      mode: 'MATCHED',
      matchedBy: 'SUGGESTION',
      transactionId: txId,
      amount: bob('199.00'),
    });
    // auditoría de la decisión + recorrido de la ocurrencia con la sugerencia
    const audit = s.mem.recorded.find((r) => r.entry.action === 'commitments.match_suggestion.confirmed');
    expect(audit?.entry).toMatchObject({ aggregateType: 'MatchSuggestion', aggregateId: sug.id });
    const matched = s.mem
      .recordedFor(casaOcc.id)
      .find((r) => r.entry.action === 'commitments.recurring_occurrence.matched');
    expect(matched?.steps[0]).toMatchObject({ detailRefs: { transactionId: txId, suggestionId: sug.id } });
    // sale del total comprometido de octubre
    expect((await s.committed.getCommitted(WS)).byCurrency[0]?.occurrences).toEqual(bob('199.00'));
    expect((await s.committed.getCommitted(WS)).items.map((i) => i.name)).toEqual(['Internet oficina']);
  });

  it('[TC-COMMITMENTS-MATCH-006] reconfirmar o confirmar una ya decidida responde MATCH_SUGGESTION_NOT_PENDING', async () => {
    const s = setup();
    const { occurrence } = await internet(s);
    const txId = expense(s);
    await s.created(txId);
    const sug = s.mem.suggestionFor(occurrence.id, txId)!;
    await s.matching.confirm({ workspaceId: WS, userId: USER, suggestionId: sug.id });
    expect(
      await codeOf(() => s.matching.confirm({ workspaceId: WS, userId: USER, suggestionId: sug.id })),
    ).toBe('MATCH_SUGGESTION_NOT_PENDING');
    expect(
      await codeOf(() => s.matching.dismiss({ workspaceId: WS, userId: USER, suggestionId: sug.id })),
    ).toBe('MATCH_SUGGESTION_NOT_PENDING');
    expect(
      await codeOf(() => s.matching.confirm({ workspaceId: WS, userId: USER, suggestionId: 'no-existe' })),
    ).toBe('RESOURCE_NOT_FOUND');
  });

  it('confirmar respeta If-Match: una versión distinta responde PRECONDITION_FAILED y no cambia nada', async () => {
    const s = setup();
    const { occurrence } = await internet(s);
    const txId = expense(s);
    await s.created(txId);
    const sug = s.mem.suggestionFor(occurrence.id, txId)!;
    expect(
      await codeOf(() =>
        s.matching.confirm({
          workspaceId: WS,
          userId: USER,
          suggestionId: sug.id,
          expectedVersion: sug.version + 1,
        }),
      ),
    ).toBe('PRECONDITION_FAILED');
    expect(s.mem.occurrence(occurrence.id).transactionId).toBeNull();
    await s.matching.confirm({
      workspaceId: WS,
      userId: USER,
      suggestionId: sug.id,
      expectedVersion: sug.version,
    });
    expect(s.mem.occurrence(occurrence.id).status).toBe('MATCHED');
  });

  it('confirmar con una transacción que cambió de cuenta responde OCCURRENCE_LINK_MISMATCH y todo queda como estaba', async () => {
    const s = setup();
    const { occurrence } = await internet(s);
    const txId = expense(s);
    await s.created(txId);
    const sug = s.mem.suggestionFor(occurrence.id, txId)!;
    edit(s, txId, { accountId: CASH });
    expect(
      await codeOf(() => s.matching.confirm({ workspaceId: WS, userId: USER, suggestionId: sug.id })),
    ).toBe('OCCURRENCE_LINK_MISMATCH');
    expect(s.mem.suggestions()[0]).toMatchObject({ status: 'PROPOSED' });
    expect(s.mem.occurrence(occurrence.id).transactionId).toBeNull();
    expect(s.mem.eventsOf('commitments.RecurringOccurrenceMaterialized')).toEqual([]);
  });

  it('[TC-COMMITMENTS-MATCH-007] aprobar la ocurrencia expira la sugerencia en la misma unidad y confirmar responde 409', async () => {
    const s = setup();
    const { occurrence } = await internet(s);
    const txId = expense(s);
    await s.created(txId);
    const sug = s.mem.suggestionFor(occurrence.id, txId)!;
    await s.occs.materialize({ workspaceId: WS, userId: USER, occurrenceId: occurrence.id });
    expect(s.mem.suggestions()[0]).toMatchObject({ status: 'EXPIRED', expireReason: 'OCCURRENCE_RESOLVED' });
    const before = s.mem.occurrence(occurrence.id);
    expect(
      await codeOf(() => s.matching.confirm({ workspaceId: WS, userId: USER, suggestionId: sug.id })),
    ).toBe('MATCH_SUGGESTION_NOT_PENDING');
    expect(s.mem.occurrence(occurrence.id)).toEqual(before);
    // y no aparece en las coincidencias por revisar
    expect((await s.queries.list(WS, { statuses: ['PROPOSED'] })).proposedCount).toBe(0);
  });

  it('[TC-COMMITMENTS-MATCH-007] omitir, vincular a mano, pausar o terminar la definición expiran sus sugerencias', async () => {
    const s = setup();
    const skipped = await internet(s);
    const linked = await create(s, 'Gimnasio', {
      amount: { type: 'FIXED', amount: bob('120.00') },
      schedule: { cadence: 'MONTHLY', startDate: '2026-10-21' },
    });
    const paused = await create(s, 'Cable', {
      amount: { type: 'FIXED', amount: bob('80.00') },
      schedule: { cadence: 'MONTHLY', startDate: '2026-10-22' },
    });
    const ended = await create(s, 'Seguro', {
      amount: { type: 'FIXED', amount: bob('60.00') },
      schedule: { cadence: 'MONTHLY', startDate: '2026-10-23' },
    });
    const txs = [
      expense(s, { amount: bob('199.00') }),
      expense(s, { amount: bob('120.00') }),
      expense(s, { amount: bob('80.00') }),
      expense(s, { amount: bob('60.00') }),
    ];
    for (const id of txs) await s.created(id);
    expect(s.mem.suggestions().filter((x) => x.status === 'PROPOSED')).toHaveLength(4);

    await s.occs.skip({ workspaceId: WS, userId: USER, occurrenceId: skipped.occurrence.id });
    await s.occs.link({
      workspaceId: WS,
      userId: USER,
      occurrenceId: s.mem.forDefinition(linked.id)[0]!.id,
      transactionId: txs[1]!,
    });
    await s.defs.pause({
      workspaceId: WS,
      userId: USER,
      definitionId: paused.id,
      expectedVersion: paused.version,
    });
    await s.defs.end({
      workspaceId: WS,
      userId: USER,
      definitionId: ended.id,
      expectedVersion: ended.version,
    });
    const reasons = Object.fromEntries(
      s.mem.suggestions().map((x) => [x.transactionId, [x.status, x.expireReason]] as const),
    );
    expect(reasons[txs[0]!]).toEqual(['EXPIRED', 'OCCURRENCE_RESOLVED']);
    expect(reasons[txs[1]!]).toEqual(['EXPIRED', 'OCCURRENCE_RESOLVED']);
    expect(reasons[txs[2]!]).toEqual(['EXPIRED', 'OCCURRENCE_CANCELLED']);
    expect(reasons[txs[3]!]).toEqual(['EXPIRED', 'OCCURRENCE_CANCELLED']);
  });

  it('vincular a mano una transacción expira (SUPERSEDED) sus propuestas con otras ocurrencias', async () => {
    const s = setup('2026-10-21');
    const casa = await create(s, 'Internet casa');
    const oficina = await create(s, 'Internet oficina', {
      schedule: { cadence: 'MONTHLY', startDate: '2026-10-22' },
    });
    const txId = expense(s, { businessDate: '2026-10-21' });
    await s.created(txId);
    expect(s.mem.suggestions().filter((x) => x.status === 'PROPOSED')).toHaveLength(2);
    await s.occs.link({
      workspaceId: WS,
      userId: USER,
      occurrenceId: s.mem.forDefinition(casa.id)[0]!.id,
      transactionId: txId,
    });
    const byOcc = Object.fromEntries(s.mem.suggestions().map((x) => [x.occurrenceId, x.expireReason]));
    expect(byOcc[s.mem.forDefinition(casa.id)[0]!.id]).toBe('OCCURRENCE_RESOLVED');
    expect(byOcc[s.mem.forDefinition(oficina.id)[0]!.id]).toBe('SUPERSEDED');
  });

  it('[TC-COMMITMENTS-MATCH-008] descartar es permanente: ni editar el gasto ni reentregar el hecho la reviven', async () => {
    const s = setup();
    const { occurrence } = await internet(s);
    const txId = expense(s);
    await s.created(txId);
    const sug = s.mem.suggestionFor(occurrence.id, txId)!;
    await s.matching.dismiss({ workspaceId: WS, userId: USER, suggestionId: sug.id });
    expect(s.mem.suggestions()[0]).toMatchObject({ status: 'DISMISSED', decidedBy: USER });
    expect(s.mem.recorded.some((r) => r.entry.action === 'commitments.match_suggestion.dismissed')).toBe(
      true,
    );
    // editar la descripción (el consumidor ni se entera) y reentregar el hecho de registro
    edit(s, txId, { description: 'Internet octubre' });
    await s.created(txId);
    // aun una edición financiera compatible o incompatible no cambia el descarte
    edit(s, txId, { amount: bob('250.00') });
    await s.created(txId);
    edit(s, txId, { amount: bob('199.00') });
    await s.created(txId);
    expect(s.mem.suggestions()).toHaveLength(1);
    expect(s.mem.suggestions()[0]).toMatchObject({ status: 'DISMISSED' });
    expect(suggested(s)).toHaveLength(1);
    expect(s.mem.occurrence(occurrence.id).transactionId).toBeNull();
    expect(s.mem.eventsOf('commitments.RecurringOccurrenceMaterialized')).toEqual([]);
  });
});

describe('Expiración y re-propuesta', () => {
  it('[TC-COMMITMENTS-MATCH-010] anular la transacción expira su sugerencia por anulación', async () => {
    const s = setup();
    const { occurrence } = await internet(s);
    const txId = expense(s);
    await s.created(txId);
    s.mem.voidTransaction(txId);
    await s.matching.onTransactionVoided({ workspaceId: WS, transactionId: txId });
    expect(s.mem.suggestionFor(occurrence.id, txId)).toMatchObject({
      status: 'EXPIRED',
      expireReason: 'TRANSACTION_VOIDED',
    });
    expect((await s.queries.list(WS, { statuses: ['PROPOSED'] })).data).toEqual([]);
    // una reentrega tardía de Created (la lee anulada) no la revive
    await s.created(txId);
    expect(s.mem.suggestionFor(occurrence.id, txId)).toMatchObject({ status: 'EXPIRED' });
  });

  it('[TC-COMMITMENTS-MATCH-010] corregir el monto fuera de tolerancia la expira y volver a 199.00 la re-propone', async () => {
    const s = setup();
    const { occurrence } = await internet(s);
    const txId = expense(s);
    await s.created(txId);
    edit(s, txId, { amount: bob('250.00') });
    await s.created(txId);
    expect(s.mem.suggestionFor(occurrence.id, txId)).toMatchObject({
      status: 'EXPIRED',
      expireReason: 'INCOMPATIBLE',
    });
    expect(suggested(s)).toHaveLength(1);
    edit(s, txId, { amount: bob('199.00') });
    await s.created(txId);
    expect(s.mem.suggestionFor(occurrence.id, txId)).toMatchObject({
      status: 'PROPOSED',
      expireReason: null,
      score: '85.00',
    });
    // una sola fila y un segundo hecho de sugerencia (re-propuesta)
    expect(s.mem.suggestions()).toHaveLength(1);
    expect(suggested(s)).toHaveLength(2);
  });

  it('una edición que mantiene la compatibilidad recalcula el puntaje sin duplicar la sugerencia', async () => {
    const s = setup();
    const { occurrence } = await internet(s);
    const txId = expense(s);
    await s.created(txId);
    edit(s, txId, { businessDate: '2026-10-20', counterpartyId: null });
    await s.created(txId);
    expect(s.mem.suggestionFor(occurrence.id, txId)).toMatchObject({
      status: 'PROPOSED',
      score: '90.00',
      dateDeltaDays: 0,
    });
    expect(s.mem.suggestions()).toHaveLength(1);
    expect(suggested(s)).toHaveLength(1);
  });

  it('una transacción que pasa a otra cuenta expira sus propuestas por incompatibilidad', async () => {
    const s = setup();
    const { occurrence } = await internet(s);
    const txId = expense(s);
    await s.created(txId);
    edit(s, txId, { accountId: SAVINGS });
    await s.created(txId);
    expect(s.mem.suggestionFor(occurrence.id, txId)).toMatchObject({
      status: 'EXPIRED',
      expireReason: 'INCOMPATIBLE',
    });
  });
});

describe('Sugerencias para ocurrencias nuevas (backfill)', () => {
  it('[TC-COMMITMENTS-MATCH-011] crear la definición después del pago sugiere la transacción ya registrada', async () => {
    const s = setup('2026-10-14');
    const txId = expense(s, { amount: bob('320.00'), businessDate: '2026-10-10' });
    const def = await create(s, 'Seguro auto', {
      amount: { type: 'FIXED', amount: bob('320.00') },
      schedule: { cadence: 'MONTHLY', startDate: '2026-10-10' },
    });
    await s.backfill();
    const occurrence = s.mem.forDefinition(def.id)[0]!;
    expect(occurrence.occurrenceDate).toBe('2026-10-10');
    expect(s.mem.suggestionFor(occurrence.id, txId)).toMatchObject({
      status: 'PROPOSED',
      confidence: 'HIGH',
      dateDeltaDays: 0,
      amountDelta: '0.00',
    });
    expect(s.mem.occurrence(occurrence.id).transactionId).toBeNull();
    // reentregar el hecho no duplica
    await s.matching.onOccurrencesAvailable({
      workspaceId: WS,
      occurrenceIds: [occurrence.id],
      eventId: s.eventId(),
    });
    expect(s.mem.suggestions()).toHaveLength(1);
  });

  it('el backfill no sugiere transacciones ya vinculadas, anuladas ni creadas por otra ocurrencia, ni pares descartados', async () => {
    const s = setup('2026-10-14');
    const linked = expense(s, { amount: bob('320.00'), businessDate: '2026-10-10' });
    const voided = expense(s, { amount: bob('320.00'), businessDate: '2026-10-10', status: 'VOIDED' });
    const dismissed = expense(s, { amount: bob('320.00'), businessDate: '2026-10-11' });
    const other = await create(s, 'Otro', {
      amount: { type: 'FIXED', amount: bob('320.00') },
      schedule: { cadence: 'MONTHLY', startDate: '2026-10-09' },
    });
    await s.occs.link({
      workspaceId: WS,
      userId: USER,
      occurrenceId: s.mem.forDefinition(other.id)[0]!.id,
      transactionId: linked,
    });
    const def = await create(s, 'Seguro auto', {
      amount: { type: 'FIXED', amount: bob('320.00') },
      schedule: { cadence: 'MONTHLY', startDate: '2026-10-10' },
    });
    const occurrence = s.mem.forDefinition(def.id)[0]!;
    await s.backfill();
    expect(s.mem.suggestionFor(occurrence.id, linked)).toBeUndefined();
    expect(s.mem.suggestionFor(occurrence.id, voided)).toBeUndefined();
    const sug = s.mem.suggestionFor(occurrence.id, dismissed)!;
    expect(sug.status).toBe('PROPOSED');
    await s.matching.dismiss({ workspaceId: WS, userId: USER, suggestionId: sug.id });
    await s.matching.onOccurrencesAvailable({
      workspaceId: WS,
      occurrenceIds: [occurrence.id],
      eventId: s.eventId(),
    });
    expect(s.mem.suggestionFor(occurrence.id, dismissed)).toMatchObject({ status: 'DISMISSED' });
  });

  it('una ocurrencia cuya ventana de fechas aún no empezó no busca transacciones', async () => {
    const s = setup('2026-10-14');
    expense(s, { amount: bob('320.00'), businessDate: '2026-10-25' });
    const def = await create(s, 'Seguro auto', {
      amount: { type: 'FIXED', amount: bob('320.00') },
      schedule: { cadence: 'MONTHLY', startDate: '2026-11-01' },
    });
    await s.backfill();
    expect(s.mem.forDefinition(def.id)[0]?.dueDate).toBe('2026-11-01');
    expect(s.mem.suggestions()).toEqual([]);
  });

  it('[TC-COMMITMENTS-MATCH-013] reanudar reinstaura la ocurrencia y sugiere el pago ya registrado', async () => {
    const s = setup('2026-10-09');
    const def = await create(s, 'Natación', {
      amount: { type: 'FIXED', amount: bob('150.00') },
      schedule: { cadence: 'MONTHLY', startDate: '2026-10-02' },
    });
    s.mem.setNow(noon('2026-11-20'));
    const paused = await s.defs.pause({
      workspaceId: WS,
      userId: USER,
      definitionId: def.id,
      expectedVersion: def.version,
    });
    const dec2 = s.mem.forDefinition(def.id).find((o) => o.occurrenceDate === '2026-12-02')!;
    expect(dec2).toMatchObject({ status: 'CANCELLED', cancelReason: 'PAUSED' });
    const txId = expense(s, { amount: bob('150.00'), businessDate: '2026-12-01' });
    s.mem.setNow(noon('2026-12-01'));
    await s.backfill();
    expect(s.mem.suggestions()).toEqual([]);
    await s.defs.resume({
      workspaceId: WS,
      userId: USER,
      definitionId: def.id,
      expectedVersion: paused.version,
    });
    await s.backfill();
    expect(s.mem.occurrence(dec2.id).status).not.toBe('CANCELLED');
    expect(s.mem.suggestionFor(dec2.id, txId)).toMatchObject({ status: 'PROPOSED', dateDeltaDays: 1 });
    expect(['SCHEDULED', 'DUE']).toContain(s.mem.occurrence(dec2.id).status);
    expect(s.mem.occurrence(dec2.id).transactionId).toBeNull();
  });
});

describe('Candidatas para filas de un import y ráfagas', () => {
  it('[TC-COMMITMENTS-MATCH-012] la vista previa devuelve la ocurrencia con su puntaje y no guarda sugerencias', async () => {
    const s = setup('2026-10-20');
    const { occurrence } = await internet(s);
    const result = await s.queries.findCandidates({
      workspaceId: WS,
      rows: [
        {
          rowRef: 'fila-1',
          kind: 'EXPENSE',
          accountId: BANK,
          amount: bob('199.00'),
          businessDate: '2026-10-20',
        },
        {
          rowRef: 'fila-2',
          kind: 'EXPENSE',
          accountId: CASH,
          amount: bob('199.00'),
          businessDate: '2026-10-20',
        },
      ],
    });
    expect(result).toHaveLength(2);
    expect(result[0]?.rowRef).toBe('fila-1');
    expect(result[0]?.candidates).toEqual([
      expect.objectContaining({
        occurrenceId: occurrence.id,
        definitionName: 'Internet',
        dueDate: '2026-10-20',
        score: '90.00',
        confidence: 'HIGH',
        amountDelta: bob('0.00'),
        dateDeltaDays: 0,
        ambiguous: false,
      }),
    ]);
    expect(result[1]?.candidates).toEqual([]);
    expect(s.mem.suggestions()).toEqual([]);
    expect(s.mem.events.filter((e) => e.eventType === 'commitments.OccurrenceMatchSuggested')).toEqual([]);
  });

  it('[TC-COMMITMENTS-MATCH-012] la vista previa rechaza más de 500 filas', async () => {
    const s = setup();
    const rows = Array.from({ length: 501 }, (_, i) => ({
      rowRef: `r${i}`,
      kind: 'EXPENSE' as const,
      accountId: BANK,
      amount: bob('10.00'),
      businessDate: '2026-10-20',
    }));
    expect(await codeOf(() => s.queries.findCandidates({ workspaceId: WS, rows }))).toBe('VALIDATION_FAILED');
  });

  it(
    '[TC-COMMITMENTS-MATCH-012] una ráfaga de 1000 importadas con 50 reentregas deja exactamente 12 sugerencias',
    { timeout: 120_000 },
    async () => {
      const s = setup('2026-10-20');
      const wanted: string[] = [];
      for (let i = 0; i < 12; i += 1) {
        // montos separados más de un 10 %: cada gasto solo es compatible con "su" definición
        const amount = (100 * 1.25 ** i).toFixed(2);
        await create(s, `Servicio ${i}`, {
          amount: { type: 'FIXED', amount: bob(amount) },
          schedule: { cadence: 'MONTHLY', startDate: '2026-10-20' },
        });
        wanted.push(amount);
      }
      const txs: string[] = [];
      for (let i = 0; i < 1000; i += 1) {
        const matches = i < 12;
        txs.push(
          expense(s, {
            source: 'IMPORT',
            amount: bob(matches ? (wanted[i] as string) : (5000 + i * 7).toFixed(2)),
            businessDate: matches ? '2026-10-20' : '2026-10-19',
          }),
        );
      }
      const delivered = [...txs, ...txs.slice(0, 50), ...txs.slice(500, 550)];
      for (const id of delivered) await s.created(id);
      expect(s.mem.suggestions().filter((x) => x.status === 'PROPOSED')).toHaveLength(12);
      expect(suggested(s)).toHaveLength(12);
    },
  );
});

describe('Confirmar una sugerencia dispara la detección de cambio de precio igual que el vínculo manual', () => {
  it('[TC-COMMITMENTS-MATCH-006] el hecho publicado por la confirmación lleva el monto real y matchedBy SUGGESTION', async () => {
    const s = setup();
    const { occurrence } = await internet(s);
    const txId = expense(s, { amount: bob('202.00') });
    await s.created(txId);
    const sug = s.mem.suggestionFor(occurrence.id, txId)!;
    await s.matching.confirm({ workspaceId: WS, userId: USER, suggestionId: sug.id });
    const [event] = s.mem.eventsOf('commitments.RecurringOccurrenceMaterialized');
    expect(event?.payload).toMatchObject({
      occurrenceId: occurrence.id,
      managedBy: 'USER',
      mode: 'MATCHED',
      matchedBy: 'SUGGESTION',
      amount: bob('202.00'),
      businessDate: '2026-10-19',
    });
  });
});
