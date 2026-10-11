import { randomUUID } from 'node:crypto';
import { runWithRequestContext } from '@pf/platform/api';
import { Money, currency } from '@pf/shared-kernel';
import { Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import {
  PgChargeRepository,
  PgProposalRepository,
  PgReminderRepository,
  PgSubscriptionRepository,
} from '../../src/infrastructure/pg-subscriptions.js';
import { PgCommitmentsUnitOfWork, PgDefinitionRepository } from '../../src/infrastructure/pg-commitments.js';
import {
  RecurringDefinition,
  Subscription,
  buildDefinitionVersion,
  type PriceChangeProposal,
  type SubscriptionCharge,
} from '../../src/domain/index.js';

declare module 'vitest' {
  export interface ProvidedContext {
    deps: { readonly databaseUrl: string; readonly migratorUrl: string; readonly workerDatabaseUrl: string };
  }
}

const deps = inject('deps');

// `commitments.subscription*` contra PostgreSQL 18 real (rol pf_app, RLS forzada; openspec add-subscriptions tarea 4.1):
// aislamiento entre workspaces (TC-017), historial de precios append-only (TC-012), una sola propuesta pendiente y un
// solo cargo por ocurrencia bajo concurrencia (TC-022), CHECK de estados y relajación del `managed_by`.
const USD = currency('USD', 2);
const BOB = currency('BOB', 2);
let app: Pool;
let migrator: Pool;
let user: string;
const w1 = randomUUID();
const w2 = randomUUID();
let uow: PgCommitmentsUnitOfWork;
const defs = new PgDefinitionRepository();
const subs = new PgSubscriptionRepository();
const proposals = new PgProposalRepository();
const charges = new PgChargeRepository();
const reminders = new PgReminderRepository();

const asUser = <T>(fn: () => Promise<T>): Promise<T> =>
  runWithRequestContext({ actor: { type: 'USER', userId: user }, origin: 'api' }, fn);

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

/** Definición administrada (la FK de la suscripción) con precio indexado opcional. */
async function newDefinition(workspaceId: string, subscriptionId: string, indexed = false) {
  const version = buildDefinitionVersion({
    kind: 'EXPENSE',
    versionNo: 1,
    effectiveFrom: '2026-11-15',
    currency: { code: 'BOB', scale: 2 },
    template: {
      accountId: randomUUID(),
      amount: indexed ? { type: 'VARIABLE' } : { type: 'FIXED', amount: '107.70' },
      schedule: { cadence: 'MONTHLY', interval: 1, startDate: '2026-11-15' },
      ...(indexed ? { indexedPrice: { amount: '10.99', currency: 'USD' } } : {}),
    },
  });
  const def = RecurringDefinition.create({
    id: randomUUID(),
    workspaceId,
    name: 'Streamly',
    kind: 'EXPENSE',
    managedBy: 'SUBSCRIPTION',
    managedRef: subscriptionId,
    version1: version,
    at: '2026-10-10T16:00:00.000Z',
    by: user,
  });
  await asUser(() => uow.run(workspaceId, () => defs.insert(def)));
  return def;
}

async function newSubscription(workspaceId: string, over: { indexed?: boolean } = {}) {
  const id = randomUUID();
  const def = await newDefinition(workspaceId, id, over.indexed ?? false);
  const sub = Subscription.create({
    id,
    workspaceId,
    definitionId: def.id,
    counterpartyId: randomUUID(),
    name: 'Streamly',
    planName: 'Premium',
    price: Money.parse('10.99', USD),
    priceEntryId: randomUUID(),
    firstRenewalOn: '2026-11-15',
    at: '2026-10-10T16:00:00.000Z',
    by: user,
  });
  await asUser(() => uow.run(workspaceId, () => subs.insert(sub)));
  return { sub, def };
}

const charge = (
  subscriptionId: string,
  occurrenceId: string,
  over: Partial<SubscriptionCharge> = {},
): SubscriptionCharge => ({
  id: randomUUID(),
  subscriptionId,
  occurrenceId,
  occurrenceDate: '2026-11-15',
  transactionId: randomUUID(),
  charged: Money.parse('108.50', BOB),
  priceCurrencyAmount: null,
  expectedPrice: Money.parse('10.99', USD),
  impliedRate: '9.872611464968152866',
  deviationPercent: null,
  outcome: 'NOT_COMPARABLE',
  ...over,
});

const proposal = (
  subscriptionId: string,
  chargeId: string,
  effectiveFrom: string,
  status: PriceChangeProposal['status'] = 'PENDING',
): PriceChangeProposal => ({
  id: randomUUID(),
  subscriptionId,
  chargeId,
  effectiveFrom,
  previousPrice: Money.parse('9.99', USD),
  proposedPrice: Money.parse('11.99', USD),
  changePercent: '+20.02',
  status,
  decidedAt: null,
  decidedBy: null,
  eventId: null,
});

beforeAll(async () => {
  app = new Pool({ connectionString: deps.databaseUrl, max: 6 });
  migrator = new Pool({ connectionString: deps.migratorUrl, max: 1 });
  const { rows } = await migrator.query<{ id: string }>(
    `SELECT iam.provision_user('https://idp.test/subs', $1, $2, 'subs') AS id`,
    [`sub-${randomUUID()}`, `subs-${randomUUID()}@demo.pfos.test`],
  );
  user = rows[0]!.id;
  for (const ws of [w1, w2]) {
    await inCtx(
      ws,
      async (c) => {
        await c.query(
          `INSERT INTO iam.workspace (id, name, base_currency, time_zone, locale, fiscal_month_start_day)
           VALUES ($1, 'Subs', 'BOB', 'America/La_Paz', 'es-BO', 1)`,
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
});

afterAll(async () => {
  await app?.end();
  await migrator?.end();
});

describe('Suscripciones sobre PostgreSQL', () => {
  it('[TC-COMMITMENTS-SUBS-001] inserta la cabecera con su primer precio y la relee íntegra', async () => {
    const { sub } = await newSubscription(w1);
    const back = await asUser(() => uow.run(w1, async () => (await subs.findById(w1, sub.id))!));
    expect(back.snapshot).toMatchObject({
      name: 'Streamly',
      planName: 'Premium',
      status: 'ACTIVE',
      priceCurrency: 'USD',
      tolerancePercent: '1.00',
      reminder: { enabled: true, daysBefore: 3 },
      nextRenewalOn: '2026-11-15',
      version: 1,
    });
    expect(back.history.entries).toHaveLength(1);
    expect(back.history.entries[0]?.price.toJSON()).toEqual({ amount: '10.99', currency: 'USD' });
    const byDef = await asUser(() =>
      uow.run(w1, async () => (await subs.findByDefinition(w1, sub.snapshot.definitionId))!),
    );
    expect(byDef.id).toBe(sub.id);
  });

  it('[TC-COMMITMENTS-SUBS-004] una definición con precio indexado conserva el precio y su moneda', async () => {
    const { def } = await newSubscription(w1, { indexed: true });
    const back = await asUser(() => uow.run(w1, async () => (await defs.findById(w1, def.id))!));
    expect(back.current.indexedPrice).toEqual({ amount: '10.99', currency: 'USD' });
    expect(back.current.amount).toEqual({ type: 'VARIABLE', amount: null, min: null, max: null });
    expect(back.snapshot).toMatchObject({ managedBy: 'SUBSCRIPTION' });
  });

  it('[TC-COMMITMENTS-SUBS-012] el historial de precios es append-only: sin UPDATE ni DELETE para la app', async () => {
    const { sub } = await newSubscription(w1);
    const priceId = sub.history.entries[0]!.id;
    expect(
      await sqlState(() =>
        inCtx(w1, (c) =>
          c.query(`UPDATE commitments.subscription_price SET amount = 99 WHERE id = $1`, [priceId]),
        ),
      ),
    ).toBe('42501');
    expect(
      await sqlState(() =>
        inCtx(w1, (c) => c.query(`DELETE FROM commitments.subscription_price WHERE id = $1`, [priceId])),
      ),
    ).toBe('42501');
    // además del privilegio, la base tiene el trigger que rechaza cualquier edición (PF003)
    const { rows: triggers } = await migrator.query<{ tgname: string }>(
      `SELECT tgname FROM pg_trigger
        WHERE tgrelid IN ('commitments.subscription_price'::regclass, 'commitments.subscription_reminder'::regclass)
          AND NOT tgisinternal ORDER BY tgname`,
    );
    expect(triggers.map((t) => t.tgname)).toEqual([
      'subscription_price_immutable_trg',
      'subscription_price_no_truncate_trg',
      'subscription_reminder_immutable_trg',
      'subscription_reminder_no_truncate_trg',
    ]);
    // una corrección es otra entrada que referencia a la original (un solo reemplazo por entrada)
    const first = await asUser(() => uow.run(w1, async () => (await subs.findById(w1, sub.id))!));
    first.supersedePrice(
      { entryId: randomUUID(), supersedesId: priceId, price: Money.parse('12.99', USD) },
      '2026-10-11T00:00:00.000Z',
      user,
    );
    expect(await asUser(() => uow.run(w1, () => subs.save(first)))).toBe(true);
    const dup = await sqlState(() =>
      inCtx(w1, (c) =>
        c.query(
          `INSERT INTO commitments.subscription_price
             (id, workspace_id, subscription_id, effective_from, amount, currency, origin, supersedes_id)
           VALUES ($1, $2, $3, '2026-11-15', 13, 'USD', 'CORRECTION', $4)`,
          [randomUUID(), w1, sub.id, priceId],
        ),
      ),
    );
    expect(dup).toBe('23505');
    const reread = await asUser(() => uow.run(w1, async () => (await subs.findById(w1, sub.id))!));
    expect(reread.history.entries.map((e) => e.price.toFixed())).toEqual(['10.99', '12.99']);
    expect(reread.history.isSuperseded(priceId)).toBe(true);
    expect(reread.history.at('2026-11-15')?.price.toFixed()).toBe('12.99');
  });

  it('el control optimista rechaza una versión vieja y los CHECK protegen los estados', async () => {
    const { sub } = await newSubscription(w1);
    const stale = await asUser(() => uow.run(w1, async () => (await subs.findById(w1, sub.id))!));
    const fresh = await asUser(() => uow.run(w1, async () => (await subs.findById(w1, sub.id))!));
    fresh.annotate({ planName: 'Estándar' }, '2026-10-11T00:00:00.000Z', user);
    expect(await asUser(() => uow.run(w1, () => subs.save(fresh)))).toBe(true);
    stale.annotate({ planName: 'Otro' }, '2026-10-11T00:00:00.000Z', user);
    expect(await asUser(() => uow.run(w1, () => subs.save(stale)))).toBe(false);
    // CANCELLED ⇔ cancelled_on; TRIAL exige trial_ends_on; recordatorio y tolerancia en rango
    const update = (set: string) => () =>
      inCtx(w1, (c) => c.query(`UPDATE commitments.subscription SET ${set} WHERE id = $1`, [sub.id]));
    expect(await sqlState(update(`status = 'CANCELLED'`))).toBe('23514');
    expect(await sqlState(update(`status = 'TRIAL'`))).toBe('23514');
    expect(await sqlState(update(`reminder_days = 31`))).toBe('23514');
    expect(await sqlState(update(`price_tolerance_percent = 50.01`))).toBe('23514');
    expect(await sqlState(update(`status = 'EXPIRED'`))).toBe('23514');
  });

  it('[TC-COMMITMENTS-SUBS-017] una suscripción de otro workspace es inexistente y sin contexto la consulta falla (PF002)', async () => {
    const { sub } = await newSubscription(w1);
    expect(await asUser(() => uow.run(w2, () => subs.findById(w2, sub.id)))).toBeNull();
    expect(await asUser(() => uow.run(w2, () => subs.list(w2, {})))).toEqual([]);
    const insertForeign = () =>
      inCtx(w2, (c) =>
        c.query(
          `INSERT INTO commitments.subscription
             (id, workspace_id, definition_id, counterparty_id, name, price_currency, status)
           VALUES ($1, $2, $3, $4, 'x', 'USD', 'ACTIVE')`,
          [randomUUID(), w1, sub.snapshot.definitionId, randomUUID()],
        ),
      );
    expect(await sqlState(insertForeign)).toBe('42501');
    const client = await app.connect();
    try {
      for (const table of [
        'subscription',
        'subscription_price',
        'subscription_charge',
        'subscription_price_proposal',
        'subscription_reminder',
      ]) {
        expect(await sqlState(() => client.query(`SELECT 1 FROM commitments.${table}`)), table).toBe('PF002');
      }
    } finally {
      client.release();
    }
  });

  it('[TC-COMMITMENTS-SUBS-022] bajo concurrencia hay un solo cargo vigente por ocurrencia y una sola propuesta pendiente', async () => {
    const { sub } = await newSubscription(w1);
    const occurrenceId = randomUUID();
    const attempt = () =>
      asUser(() => uow.run(w1, () => charges.insertIfAbsent(charge(sub.id, occurrenceId))));
    const results = await Promise.all([attempt(), attempt(), attempt()]);
    expect(results.filter(Boolean)).toHaveLength(1);
    const active = await asUser(() =>
      uow.run(w1, () => charges.findActiveByOccurrence(w1, sub.id, occurrenceId)),
    );
    expect(active).toMatchObject({ outcome: 'NOT_COMPARABLE', impliedRate: '9.872611464968152866' });
    expect(active?.charged.toJSON()).toEqual({ amount: '108.50', currency: 'BOB' });

    // un cargo anulado deja pasar al siguiente para la misma ocurrencia
    await asUser(() => uow.run(w1, () => charges.update(w1, { ...active!, outcome: 'VOIDED' })));
    expect(await asUser(() => uow.run(w1, () => charges.insertIfAbsent(charge(sub.id, occurrenceId))))).toBe(
      true,
    );
    expect((await asUser(() => uow.run(w1, () => charges.list(w1, sub.id, 10)))).length).toBe(1);

    // una sola propuesta pendiente por suscripción y una por vigencia
    const base = await asUser(() =>
      uow.run(w1, () => charges.findActiveByOccurrence(w1, sub.id, occurrenceId)),
    );
    await asUser(() => uow.run(w1, () => proposals.insert(proposal(sub.id, base!.id, '2026-11-15'))));
    const again = await sqlState(() =>
      asUser(() => uow.run(w1, () => proposals.insert(proposal(sub.id, base!.id, '2026-12-15')))),
    );
    expect(again).toBe('23505');
    const sameDate = await sqlState(() =>
      asUser(() =>
        uow.run(w1, () => proposals.insert(proposal(sub.id, base!.id, '2026-11-15', 'WITHDRAWN'))),
      ),
    );
    expect(sameDate).toBe('23505');
    const list = await asUser(() => uow.run(w1, () => proposals.listForSubscription(w1, sub.id)));
    expect(list.map((p) => p.status)).toEqual(['PENDING']);
    expect(list[0]?.changePercent).toBe('+20.02');
    expect(list[0]?.proposedPrice.toJSON()).toEqual({ amount: '11.99', currency: 'USD' });
  });

  it('[TC-COMMITMENTS-SUBS-027] el recordatorio se inserta una sola vez por suscripción, tipo y fecha, y no se edita', async () => {
    const { sub } = await newSubscription(w1);
    const insert = (kind: 'RENEWAL' | 'TRIAL_END', targetDate: string) =>
      asUser(() =>
        uow.run(w1, () =>
          reminders.insertIfAbsent({
            workspaceId: w1,
            subscriptionId: sub.id,
            kind,
            targetDate,
            eventId: randomUUID(),
            emittedAt: '2026-11-12T10:00:00.000Z',
          }),
        ),
      );
    const results = await Promise.all([insert('RENEWAL', '2026-11-15'), insert('RENEWAL', '2026-11-15')]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await insert('RENEWAL', '2026-12-15')).toBe(true);
    expect(await insert('TRIAL_END', '2026-11-15')).toBe(true);
    expect(await insert('RENEWAL', '2026-11-15')).toBe(false);
    expect(
      await sqlState(() =>
        inCtx(w1, (c) =>
          c.query(`DELETE FROM commitments.subscription_reminder WHERE subscription_id = $1`, [sub.id]),
        ),
      ),
    ).toBe('42501');
  });

  it('managed_by admite SUBSCRIPTION y DEBT con su referencia y rechaza otro administrador y una referencia en una definición de usuario', async () => {
    const insert = (managedBy: string, ref: string | null) => () =>
      inCtx(w1, (c) =>
        c.query(
          `INSERT INTO commitments.recurring_definition (id, workspace_id, name, kind, status, managed_by, managed_ref)
           VALUES ($1, $2, 'x', 'EXPENSE', 'ACTIVE', $3, $4)`,
          [randomUUID(), w1, managedBy, ref],
        ),
      );
    expect(await sqlState(insert('SUBSCRIPTION', randomUUID()))).toBeUndefined();
    expect(await sqlState(insert('SUBSCRIPTION', null))).toBe('23514');
    expect(await sqlState(insert('USER', randomUUID()))).toBe('23514');
    expect(await sqlState(insert('DEBT', randomUUID()))).toBeUndefined();
    expect(await sqlState(insert('GOAL', randomUUID()))).toBe('23514');
  });
});
