import { randomUUID } from 'node:crypto';
import { runWithRequestContext } from '@pf/platform/api';
import { Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import {
  MatchSuggestion,
  OccurrenceMatcher,
  RecurringDefinition,
  RecurringOccurrence,
  buildDefinitionVersion,
  type MatchCandidate,
} from '../../src/domain/index.js';
import {
  PgCommitmentsUnitOfWork,
  PgDefinitionRepository,
  PgOccurrenceRepository,
} from '../../src/infrastructure/pg-commitments.js';
import { PgMatchSuggestionRepository } from '../../src/infrastructure/pg-matching.js';

declare module 'vitest' {
  export interface ProvidedContext {
    deps: { readonly databaseUrl: string; readonly migratorUrl: string; readonly workerDatabaseUrl: string };
  }
}

const deps = inject('deps');

// `commitments.occurrence_match_suggestion` contra PostgreSQL 18 real (rol pf_app, RLS forzada; openspec
// add-commitment-matching, tarea 4.2): UNIQUE del par bajo concurrencia (TC-001), descarte permanente, expiración
// masiva, lecturas de candidatas, aislamiento entre workspaces y CHECK de estados.
let app: Pool;
let migrator: Pool;
let user: string;
const w1 = randomUUID();
const w2 = randomUUID();
let uow: PgCommitmentsUnitOfWork;
const defs = new PgDefinitionRepository();
const occs = new PgOccurrenceRepository();
const repo = new PgMatchSuggestionRepository();
const bankAccount = randomUUID();
const AT = '2026-10-19T16:00:00.000Z';

const asUser = <T>(fn: () => Promise<T>): Promise<T> =>
  runWithRequestContext({ actor: { type: 'USER', userId: user }, origin: 'api' }, fn);
const inWs = <T>(ws: string, fn: () => Promise<T>): Promise<T> => asUser(() => uow.run(ws, fn));

async function sqlState(fn: () => Promise<unknown>): Promise<string | undefined> {
  try {
    await fn();
  } catch (err) {
    return (err as { code?: string }).code;
  }
  return undefined;
}

async function inCtx<T>(workspaceId: string, fn: (c: PoolClient) => Promise<T>, commit = false): Promise<T> {
  const c = await app.connect();
  try {
    await c.query('BEGIN');
    await c.query(`SELECT set_config('app.user_id', $1, true), set_config('app.workspace_id', $2, true)`, [
      user,
      workspaceId,
    ]);
    const result = await fn(c);
    await c.query(commit ? 'COMMIT' : 'ROLLBACK');
    return result;
  } catch (err) {
    await c.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    c.release();
  }
}

/** Definición + una ocurrencia no resuelta con vencimiento `dueDate`. */
async function newOccurrence(
  workspaceId: string,
  over: { dueDate?: string; amount?: string; counterpartyId?: string | null; name?: string } = {},
) {
  const dueDate = over.dueDate ?? '2026-10-20';
  const version = buildDefinitionVersion({
    kind: 'EXPENSE',
    versionNo: 1,
    effectiveFrom: dueDate,
    currency: { code: 'BOB', scale: 2 },
    template: {
      accountId: bankAccount,
      amount: { type: 'FIXED', amount: over.amount ?? '199.00' },
      counterpartyId: over.counterpartyId ?? null,
      schedule: { cadence: 'MONTHLY', interval: 1, startDate: dueDate },
    },
  });
  const def = RecurringDefinition.create({
    id: randomUUID(),
    workspaceId,
    name: over.name ?? 'Internet',
    kind: 'EXPENSE',
    version1: version,
    at: AT,
    by: user,
  });
  const occ = RecurringOccurrence.generate({
    id: randomUUID(),
    workspaceId,
    definitionId: def.id,
    occurrenceDate: dueDate,
    dueDate,
    definitionVersionNo: 1,
    expected: version.amount,
    currency: 'BOB',
    at: AT,
  });
  await inWs(workspaceId, async () => {
    await defs.insert(def);
    await occs.insertIfAbsent([occ]);
  });
  return { def, occ };
}

const candidate = (
  occurrenceId: string,
  definitionId: string,
  over: Partial<MatchCandidate> = {},
): MatchCandidate => ({
  occurrenceId,
  definitionId,
  transactionId: randomUUID(),
  score: '85.00',
  confidence: 'HIGH',
  amountDelta: '0.00',
  currency: 'BOB',
  dateDeltaDays: 1,
  counterparty: 'UNKNOWN',
  ambiguous: false,
  businessDate: '2026-10-19',
  dueDate: '2026-10-20',
  ...over,
});

const propose = (workspaceId: string, c: MatchCandidate) =>
  MatchSuggestion.propose({
    id: randomUUID(),
    workspaceId,
    candidate: c,
    sourceEventId: randomUUID(),
    at: AT,
  });

beforeAll(async () => {
  app = new Pool({ connectionString: deps.databaseUrl, max: 8 });
  migrator = new Pool({ connectionString: deps.migratorUrl, max: 1 });
  const { rows } = await migrator.query<{ id: string }>(
    `SELECT iam.provision_user('https://idp.test/match', $1, $2, 'match') AS id`,
    [`match-${randomUUID()}`, `match-${randomUUID()}@demo.pfos.test`],
  );
  user = rows[0]!.id;
  for (const ws of [w1, w2]) {
    await inCtx(
      ws,
      async (c) => {
        await c.query(
          `INSERT INTO iam.workspace (id, name, base_currency, time_zone, locale, fiscal_month_start_day)
           VALUES ($1, 'Match', 'BOB', 'America/La_Paz', 'es-BO', 1)`,
          [ws],
        );
        await c.query(
          `INSERT INTO iam.workspace_membership (workspace_id, user_id, role) VALUES ($1, $2, 'OWNER')`,
          [ws, user],
        );
      },
      true,
    );
  }
  uow = new PgCommitmentsUnitOfWork(app);
}, 120_000);

afterAll(async () => {
  await app?.end();
  await migrator?.end();
});

describe('Sugerencias de coincidencia sobre PostgreSQL', () => {
  it('[TC-COMMITMENTS-MATCH-001] inserta y relee íntegra la sugerencia; el mismo par no se duplica', async () => {
    const { occ, def } = await newOccurrence(w1);
    const s = propose(w1, candidate(occ.id, def.id));
    expect(await inWs(w1, () => repo.insertIfAbsent(s))).toBe(true);
    const back = await inWs(w1, async () => (await repo.findById(w1, s.id))!);
    expect(back.snapshot).toMatchObject({
      occurrenceId: occ.id,
      definitionId: def.id,
      transactionId: s.transactionId,
      score: '85.00',
      confidence: 'HIGH',
      amountDelta: '0.00',
      currency: 'BOB',
      dateDeltaDays: 1,
      counterparty: 'UNKNOWN',
      ambiguous: false,
      status: 'PROPOSED',
      expireReason: null,
      version: 1,
    });
    // el mismo par con otro id (otra entrega del mismo hecho) no inserta
    const dup = MatchSuggestion.propose({
      id: randomUUID(),
      workspaceId: w1,
      candidate: candidate(occ.id, def.id, { transactionId: s.transactionId }),
      sourceEventId: randomUUID(),
      at: AT,
    });
    expect(await inWs(w1, () => repo.insertIfAbsent(dup))).toBe(false);
    expect(await inWs(w1, () => repo.listByTransaction(w1, s.transactionId))).toHaveLength(1);
  });

  it('[TC-COMMITMENTS-MATCH-001] dos entregas en paralelo del mismo hecho dejan exactamente una sugerencia', async () => {
    const { occ, def } = await newOccurrence(w1, { dueDate: '2026-11-20' });
    const transactionId = randomUUID();
    const attempt = () =>
      inWs(w1, () =>
        repo.insertIfAbsent(
          propose(
            w1,
            candidate(occ.id, def.id, { transactionId, dueDate: '2026-11-20', businessDate: '2026-11-19' }),
          ),
        ),
      );
    const results = await Promise.all([attempt(), attempt(), attempt(), attempt()]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await inWs(w1, () => repo.listByTransaction(w1, transactionId))).toHaveLength(1);
  });

  it('[TC-COMMITMENTS-MATCH-008] un par descartado sigue descartado: reinsertar no lo cambia', async () => {
    const { occ, def } = await newOccurrence(w1, { dueDate: '2026-12-20' });
    const c = candidate(occ.id, def.id, { dueDate: '2026-12-20', businessDate: '2026-12-19' });
    const s = propose(w1, c);
    await inWs(w1, () => repo.insertIfAbsent(s));
    const loaded = await inWs(w1, async () => (await repo.findById(w1, s.id, { lock: 'update' }))!);
    loaded.dismiss(user, AT);
    expect(await inWs(w1, () => repo.save(loaded))).toBe(true);
    const again = MatchSuggestion.propose({
      id: randomUUID(),
      workspaceId: w1,
      candidate: c,
      sourceEventId: null,
      at: AT,
    });
    expect(await inWs(w1, () => repo.insertIfAbsent(again))).toBe(false);
    const [only] = await inWs(w1, () => repo.listByTransaction(w1, c.transactionId));
    expect(only?.snapshot).toMatchObject({ status: 'DISMISSED', decidedBy: user });
  });

  it('el control optimista rechaza una versión vieja', async () => {
    const { occ, def } = await newOccurrence(w1, { dueDate: '2026-12-21' });
    const s = propose(w1, candidate(occ.id, def.id));
    await inWs(w1, () => repo.insertIfAbsent(s));
    const stale = await inWs(w1, async () => (await repo.findById(w1, s.id))!);
    const fresh = await inWs(w1, async () => (await repo.findById(w1, s.id))!);
    fresh.refresh(
      candidate(occ.id, def.id, { transactionId: s.transactionId, score: '70.00', confidence: 'MEDIUM' }),
    );
    expect(await inWs(w1, () => repo.save(fresh))).toBe(true);
    stale.dismiss(user, AT);
    expect(await inWs(w1, () => repo.save(stale))).toBe(false);
    const back = await inWs(w1, async () => (await repo.findById(w1, s.id))!);
    expect(back.snapshot).toMatchObject({
      status: 'PROPOSED',
      score: '70.00',
      confidence: 'MEDIUM',
      version: 2,
    });
  });

  it('[TC-COMMITMENTS-MATCH-007] expira en bloque las propuestas de una ocurrencia o de una transacción, salvo la confirmada', async () => {
    const a = await newOccurrence(w1, { dueDate: '2027-01-20', name: 'A' });
    const b = await newOccurrence(w1, { dueDate: '2027-01-22', name: 'B' });
    const tx1 = randomUUID();
    const tx2 = randomUUID();
    const sA1 = propose(w1, candidate(a.occ.id, a.def.id, { transactionId: tx1 }));
    const sA2 = propose(w1, candidate(a.occ.id, a.def.id, { transactionId: tx2 }));
    const sB1 = propose(w1, candidate(b.occ.id, b.def.id, { transactionId: tx1 }));
    for (const s of [sA1, sA2, sB1]) await inWs(w1, () => repo.insertIfAbsent(s));

    const expiredOfOccurrence = await inWs(w1, () =>
      repo.expireForOccurrences(w1, [a.occ.id], 'SUPERSEDED', { exceptId: sA1.id }),
    );
    expect(expiredOfOccurrence).toEqual([sA2.id]);
    const expiredOfTransaction = await inWs(w1, () =>
      repo.expireForTransaction(w1, tx1, 'SUPERSEDED', { exceptId: sA1.id }),
    );
    expect(expiredOfTransaction).toEqual([sB1.id]);
    const states = await inWs(w1, () => repo.listByOccurrences(w1, [a.occ.id, b.occ.id]));
    const byId = Object.fromEntries(states.map((s) => [s.id, s.snapshot]));
    expect(byId[sA1.id]).toMatchObject({ status: 'PROPOSED' });
    expect(byId[sA2.id]).toMatchObject({ status: 'EXPIRED', expireReason: 'SUPERSEDED', version: 2 });
    expect(byId[sB1.id]).toMatchObject({ status: 'EXPIRED', expireReason: 'SUPERSEDED' });
    // volver a expirar no cambia lo que ya no está propuesto
    expect(
      await inWs(w1, () => repo.expireForOccurrences(w1, [a.occ.id, b.occ.id], 'OCCURRENCE_CANCELLED')),
    ).toEqual([sA1.id]);
    expect(await inWs(w1, () => repo.expireForOccurrences(w1, [], 'OCCURRENCE_CANCELLED'))).toEqual([]);
  });

  it('lista por puntaje con cursor, por estado y por ocurrencia; cuenta las propuestas', async () => {
    const ws = randomUUID();
    await inCtx(
      ws,
      async (c) => {
        await c.query(
          `INSERT INTO iam.workspace (id, name, base_currency, time_zone, locale, fiscal_month_start_day)
           VALUES ($1, 'Match lista', 'BOB', 'America/La_Paz', 'es-BO', 1)`,
          [ws],
        );
        await c.query(
          `INSERT INTO iam.workspace_membership (workspace_id, user_id, role) VALUES ($1, $2, 'OWNER')`,
          [ws, user],
        );
      },
      true,
    );
    const created: MatchSuggestion[] = [];
    for (const [i, score] of ['90.00', '55.50', '85.00', '85.00'].entries()) {
      const { occ, def } = await newOccurrence(ws, { dueDate: `2027-02-${String(10 + i)}`, name: `S${i}` });
      const s = propose(
        ws,
        candidate(occ.id, def.id, { score, confidence: Number(score) >= 80 ? 'HIGH' : 'LOW' }),
      );
      await inWs(ws, () => repo.insertIfAbsent(s));
      created.push(s);
    }
    const page1 = await inWs(ws, () => repo.list(ws, { statuses: ['PROPOSED'], limit: 2 }));
    expect(page1.map((s) => s.snapshot.score)).toEqual(['90.00', '85.00']);
    const last = page1.at(-1)!.snapshot;
    const page2 = await inWs(ws, () =>
      repo.list(ws, { statuses: ['PROPOSED'], limit: 2, after: [last.score, last.id] }),
    );
    expect(page2.map((s) => s.snapshot.score)).toEqual(['85.00', '55.50']);
    expect([...page1, ...page2].map((s) => s.id).sort()).toEqual(created.map((s) => s.id).sort());
    expect(await inWs(ws, () => repo.countProposed(ws))).toBe(4);
    expect(await inWs(ws, () => repo.list(ws, { statuses: ['DISMISSED'] }))).toEqual([]);
    const one = await inWs(ws, () => repo.list(ws, { occurrenceId: created[2]!.occurrenceId }));
    expect(one.map((s) => s.id)).toEqual([created[2]!.id]);
    const byTx = await inWs(ws, () => repo.list(ws, { transactionId: created[1]!.transactionId }));
    expect(byTx.map((s) => s.id)).toEqual([created[1]!.id]);
    const byDef = await inWs(ws, () => repo.list(ws, { definitionId: created[3]!.snapshot.definitionId }));
    expect(byDef.map((s) => s.id)).toEqual([created[3]!.id]);
  });
});

describe('Lecturas de ocurrencias para el matching', () => {
  it('candidateOccurrences filtra por tipo, cuenta, estado y rango, e incluye contraparte y tolerancias de la definición', async () => {
    const ws = randomUUID();
    await inCtx(
      ws,
      async (c) => {
        await c.query(
          `INSERT INTO iam.workspace (id, name, base_currency, time_zone, locale, fiscal_month_start_day)
           VALUES ($1, 'Match cand', 'BOB', 'America/La_Paz', 'es-BO', 1)`,
          [ws],
        );
        await c.query(
          `INSERT INTO iam.workspace_membership (workspace_id, user_id, role) VALUES ($1, $2, 'OWNER')`,
          [ws, user],
        );
      },
      true,
    );
    const cp = randomUUID();
    const inRange = await newOccurrence(ws, { dueDate: '2027-03-20', counterpartyId: cp, name: 'Internet' });
    await newOccurrence(ws, { dueDate: '2027-04-20', name: 'Fuera de rango' });
    // tolerancias de la definición
    const def = await inWs(ws, async () => (await defs.findById(ws, inRange.def.id, { lock: 'update' }))!);
    def.annotate({ matchingAmountTolerancePct: '5.00', matchingDateWindowDays: 2 }, AT, user);
    expect(await inWs(ws, () => defs.save(def))).toBe(true);

    const found = await inWs(ws, () =>
      repo.candidateOccurrences(ws, {
        kind: 'EXPENSE',
        accountId: bankAccount,
        toAccountId: null,
        from: '2027-03-05',
        to: '2027-04-04',
      }),
    );
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      definitionName: 'Internet',
      occurrence: {
        occurrenceId: inRange.occ.id,
        kind: 'EXPENSE',
        accountId: bankAccount,
        counterpartyId: cp,
        expected: { type: 'FIXED', amount: '199.00' },
        currency: 'BOB',
        dueDate: '2027-03-20',
        tolerances: { amountTolerancePct: '5.00', dateWindowDays: 2 },
      },
    });
    // otra cuenta o tipo ⇒ nada
    expect(
      await inWs(ws, () =>
        repo.candidateOccurrences(ws, {
          kind: 'EXPENSE',
          accountId: randomUUID(),
          toAccountId: null,
          from: '2027-03-05',
          to: '2027-04-04',
        }),
      ),
    ).toEqual([]);
    expect(
      await inWs(ws, () =>
        repo.candidateOccurrences(ws, {
          kind: 'INCOME',
          accountId: bankAccount,
          toAccountId: null,
          from: '2027-03-05',
          to: '2027-04-04',
        }),
      ),
    ).toEqual([]);

    // la fila alimenta al matcher de dominio
    const matches = OccurrenceMatcher.forTransaction(
      {
        transactionId: randomUUID(),
        kind: 'EXPENSE',
        status: 'POSTED',
        businessDate: '2027-03-22',
        amount: { amount: '205.00', currency: 'BOB' },
        accountId: bankAccount,
        toAccountId: null,
        counterpartyId: cp,
        externalRef: null,
      },
      found.map((r) => r.occurrence),
    );
    expect(matches).toHaveLength(1);

    // una resuelta deja de ser candidata y occurrencesByIds sí la conserva
    const occ = await inWs(ws, async () => (await occs.findById(ws, inRange.occ.id, { lock: 'update' }))!);
    occ.skip({ reason: null, at: AT, by: user });
    expect(await inWs(ws, () => occs.save(occ))).toBe(true);
    expect(
      await inWs(ws, () =>
        repo.candidateOccurrences(ws, {
          kind: 'EXPENSE',
          accountId: bankAccount,
          toAccountId: null,
          from: '2027-03-05',
          to: '2027-04-04',
        }),
      ),
    ).toEqual([]);
    const byId = await inWs(ws, () => repo.occurrencesByIds(ws, [inRange.occ.id, randomUUID()]));
    expect(byId.map((r) => [r.occurrence.occurrenceId, r.occurrence.status])).toEqual([
      [inRange.occ.id, 'SKIPPED'],
    ]);
  });

  it('linkedTransactionIds devuelve solo las transacciones que ya resuelven una ocurrencia', async () => {
    const { occ } = await newOccurrence(w1, { dueDate: '2027-05-20' });
    const txId = randomUUID();
    const loaded = await inWs(w1, async () => (await occs.findById(w1, occ.id, { lock: 'update' }))!);
    loaded.link({ transactionId: txId, matchedBy: 'SUGGESTION', at: AT, by: user });
    expect(await inWs(w1, () => occs.save(loaded))).toBe(true);
    const free = randomUUID();
    const linked = await inWs(w1, () => repo.linkedTransactionIds(w1, [txId, free]));
    expect([...linked]).toEqual([txId]);
    expect((await inWs(w1, () => repo.linkedTransactionIds(w1, []))).size).toBe(0);
  });
});

describe('Aislamiento, privilegios y CHECK', () => {
  it('una sugerencia de otro workspace es inexistente y sin contexto la consulta falla (PF002)', async () => {
    const { occ, def } = await newOccurrence(w1, { dueDate: '2027-06-20' });
    const s = propose(w1, candidate(occ.id, def.id));
    await inWs(w1, () => repo.insertIfAbsent(s));
    expect(await inWs(w2, () => repo.findById(w2, s.id))).toBeNull();
    expect(await inWs(w2, () => repo.list(w2, {}))).toEqual([]);
    expect(await inWs(w2, () => repo.countProposed(w2))).toBe(0);
    expect(await inWs(w2, () => repo.expireForOccurrences(w2, [occ.id], 'SUPERSEDED'))).toEqual([]);
    const foreign = () =>
      inCtx(w2, (c) =>
        c.query(
          `INSERT INTO commitments.occurrence_match_suggestion
             (id, workspace_id, occurrence_id, definition_id, transaction_id, score, confidence, currency,
              date_delta_days, counterparty_match, status)
           VALUES ($1, $2, $3, $4, $5, 85, 'HIGH', 'BOB', 1, 'UNKNOWN', 'PROPOSED')`,
          [randomUUID(), w1, occ.id, def.id, randomUUID()],
        ),
      );
    expect(await sqlState(foreign)).toBe('42501');
    const client = await app.connect();
    try {
      expect(
        await sqlState(() => client.query('SELECT 1 FROM commitments.occurrence_match_suggestion')),
      ).toBe('PF002');
    } finally {
      client.release();
    }
  });

  it('la app no puede borrar sugerencias (sin DELETE) y los CHECK protegen estados, motivos y puntaje', async () => {
    const { occ, def } = await newOccurrence(w1, { dueDate: '2027-07-20' });
    const s = propose(w1, candidate(occ.id, def.id));
    await inWs(w1, () => repo.insertIfAbsent(s));
    const run =
      (sql: string, params: unknown[] = [s.id]) =>
      () =>
        inCtx(w1, (c) => c.query(sql, params));
    expect(await sqlState(run('DELETE FROM commitments.occurrence_match_suggestion WHERE id = $1'))).toBe(
      '42501',
    );
    const update = (set: string) =>
      run(`UPDATE commitments.occurrence_match_suggestion SET ${set} WHERE id = $1`);
    // EXPIRED ⇔ expire_reason
    expect(await sqlState(update(`status = 'EXPIRED'`))).toBe('23514');
    expect(await sqlState(update(`expire_reason = 'INCOMPATIBLE'`))).toBe('23514');
    expect(await sqlState(update(`status = 'EXPIRED', expire_reason = 'MAGIC'`))).toBe('23514');
    // CONFIRMED y DISMISSED exigen decided_at
    expect(await sqlState(update(`status = 'CONFIRMED'`))).toBe('23514');
    expect(await sqlState(update(`status = 'IGNORED'`))).toBe('23514');
    expect(await sqlState(update(`score = 100.01`))).toBe('23514');
    expect(await sqlState(update(`score = -1`))).toBe('23514');
    expect(await sqlState(update(`confidence = 'CERTAIN'`))).toBe('23514');
    expect(await sqlState(update(`counterparty_match = 'DIFFERENT'`))).toBe('23514');
    expect(await sqlState(update(`amount_delta = -0.01`))).toBe('23514');
    expect(await sqlState(update(`date_delta_days = -1`))).toBe('23514');
    // el par es único en la base
    const dup = () =>
      inCtx(w1, (c) =>
        c.query(
          `INSERT INTO commitments.occurrence_match_suggestion
             (id, workspace_id, occurrence_id, definition_id, transaction_id, score, confidence, currency,
              date_delta_days, counterparty_match, status)
           VALUES ($1, $2, $3, $4, $5, 85, 'HIGH', 'BOB', 1, 'UNKNOWN', 'PROPOSED')`,
          [randomUUID(), w1, occ.id, def.id, s.transactionId],
        ),
      );
    expect(await sqlState(dup)).toBe('23505');
  });

  it('las tolerancias de la definición se validan en la base (0..100 % y 0..15 días) y se conservan al guardar', async () => {
    const { def } = await newOccurrence(w1, { dueDate: '2027-08-20' });
    const update = (set: string) => () =>
      inCtx(w1, (c) => c.query(`UPDATE commitments.recurring_definition SET ${set} WHERE id = $1`, [def.id]));
    expect(await sqlState(update('matching_amount_tolerance_pct = 100.01'))).toBe('23514');
    expect(await sqlState(update('matching_amount_tolerance_pct = -1'))).toBe('23514');
    expect(await sqlState(update('matching_date_window_days = 16'))).toBe('23514');
    expect(await sqlState(update('matching_date_window_days = -1'))).toBe('23514');
    expect(
      await sqlState(update('matching_amount_tolerance_pct = 100, matching_date_window_days = 15')),
    ).toBeUndefined();
    const loaded = await inWs(w1, async () => (await defs.findById(w1, def.id, { lock: 'update' }))!);
    expect(loaded.snapshot).toMatchObject({ matchingAmountTolerancePct: null, matchingDateWindowDays: null });
    loaded.annotate({ matchingAmountTolerancePct: '7.50', matchingDateWindowDays: 0 }, AT, user);
    expect(await inWs(w1, () => defs.save(loaded))).toBe(true);
    const back = await inWs(w1, async () => (await defs.findById(w1, def.id))!);
    expect(back.snapshot).toMatchObject({ matchingAmountTolerancePct: '7.50', matchingDateWindowDays: 0 });
    back.annotate({ matchingAmountTolerancePct: null, matchingDateWindowDays: null }, AT, user);
    expect(await inWs(w1, () => defs.save(back))).toBe(true);
    expect((await inWs(w1, async () => (await defs.findById(w1, def.id))!)).snapshot).toMatchObject({
      matchingAmountTolerancePct: null,
      matchingDateWindowDays: null,
    });
  });

  it('la tabla está en el catálogo de purga antes que las ocurrencias y con RLS forzada', async () => {
    const { rows } = await migrator.query<{ table_name: string; purge_order: number }>(
      `SELECT table_name, purge_order FROM platform.workspace_scoped_table
        WHERE schema_name = 'commitments' AND table_name IN ('occurrence_match_suggestion', 'recurring_occurrence')`,
    );
    const order = Object.fromEntries(rows.map((r) => [r.table_name, Number(r.purge_order)]));
    expect(order['occurrence_match_suggestion']).toBeDefined();
    expect(order['occurrence_match_suggestion']!).toBeLessThan(order['recurring_occurrence']!);
    const { rows: rls } = await migrator.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `SELECT relrowsecurity, relforcerowsecurity FROM pg_class
        WHERE oid = 'commitments.occurrence_match_suggestion'::regclass`,
    );
    expect(rls[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
  });
});
