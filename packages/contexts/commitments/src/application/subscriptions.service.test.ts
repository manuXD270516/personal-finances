import { DomainError } from '@pf/shared-kernel';
import { describe, expect, it } from 'vitest';
import { GenerateOccurrencesService } from './generate-occurrences.service.js';
import { OccurrencesService } from './occurrences.service.js';
import { SubscriptionChargesService } from './subscription-charges.service.js';
import { SubscriptionDailyService } from './subscription-daily.service.js';
import { SubscriptionsQueries } from './subscriptions.queries.js';
import { SubscriptionsService, type CreateSubscriptionCommand } from './subscriptions.service.js';
import { CARD, USER, VISA_USD, WALLET_USDT, WS, BANK } from './testing/in-memory.js';
import {
  CLOUDDRIVE,
  DIARIO,
  GYM,
  InMemorySubscriptions,
  MUSICBOX,
  OLDTV,
  PHOTOLAB,
  STREAMLY,
  VPN_PRO,
} from './testing/in-memory-subscriptions.js';

const usd = (amount: string) => ({ amount, currency: 'USD' });
const bob = (amount: string) => ({ amount, currency: 'BOB' });
/** 12:00 en America/La_Paz = 16:00Z. */
const noon = (date: string) => `${date}T16:00:00Z`;

/** Campos del hecho del motor que lee el consumidor. */
interface Fact {
  occurrenceId: string;
  definitionId: string;
  occurrenceDate: string;
  managedBy: string;
  transactionId: string;
  amount: { amount: string; currency: string };
  transition: string;
}

function setup(now = '2026-10-20') {
  const mem = new InMemorySubscriptions();
  mem.setNow(noon(now));
  mem.rateTable.set('USD/BOB', '9.80');
  mem.rateTable.set('USDT/BOB', '9.70');
  const deps = mem.subscriptionDeps();
  const subs = new SubscriptionsService(deps);
  const charges = new SubscriptionChargesService(deps);
  const daily = new SubscriptionDailyService(deps);
  const queries = new SubscriptionsQueries(deps);
  const occs = new OccurrencesService(deps);
  const engine = new GenerateOccurrencesService(deps, occs);
  let delivered = 0;
  /** Entrega al consumidor los hechos del motor que aún no recibió (como el worker). */
  const deliver = async () => {
    while (delivered < mem.events.length) {
      const event = mem.events[delivered]!;
      delivered += 1;
      const p = event.payload as unknown as Fact;
      if (event.eventType === 'commitments.RecurringOccurrenceMaterialized') {
        await charges.onOccurrenceMaterialized({
          workspaceId: WS,
          occurrenceId: p.occurrenceId,
          definitionId: p.definitionId,
          occurrenceDate: p.occurrenceDate,
          managedBy: p.managedBy,
          transactionId: p.transactionId,
          amount: p.amount,
        });
      } else if (event.eventType === 'commitments.RecurringOccurrenceChanged') {
        await charges.onOccurrenceChanged({
          workspaceId: WS,
          occurrenceId: p.occurrenceId,
          definitionId: p.definitionId,
          managedBy: p.managedBy,
          transition: p.transition,
        });
      }
    }
  };
  return { mem, deps, subs, charges, daily, queries, occs, engine, deliver };
}
type S = ReturnType<typeof setup>;

function cmd(over: Partial<CreateSubscriptionCommand> = {}): CreateSubscriptionCommand {
  return {
    workspaceId: WS,
    userId: USER,
    counterpartyId: STREAMLY,
    name: 'Streamly',
    planName: 'Premium',
    price: usd('10.99'),
    billingCycle: { cadence: 'MONTHLY' },
    firstRenewalOn: '2026-11-15',
    paymentAccountId: VISA_USD,
    materialization: { mode: 'PENDING_APPROVAL', leadDays: 3 },
    ...over,
  };
}

const codeOf = async (fn: () => Promise<unknown>): Promise<string | undefined> => {
  try {
    await fn();
  } catch (err) {
    return err instanceof DomainError ? err.code : `no-domain:${String(err)}`;
  }
  return undefined;
};

const occurrenceOn = (s: S, definitionId: string, date: string) =>
  s.mem.forDefinition(definitionId).find((o) => o.occurrenceDate === date);
const pendingOf = (s: S, definitionId: string) =>
  s.mem.forDefinition(definitionId).filter((o) => ['SCHEDULED', 'DUE', 'OVERDUE'].includes(o.status));
const approve = async (
  s: S,
  definitionId: string,
  date: string,
  amount?: { amount: string; currency: string },
) => {
  const occ = occurrenceOn(s, definitionId, date);
  if (!occ) throw new Error(`no occurrence on ${date}`);
  await s.occs.materialize({
    workspaceId: WS,
    userId: USER,
    occurrenceId: occ.id,
    ...(amount ? { amount } : {}),
  });
  await s.deliver();
};

describe('Alta de suscripciones', () => {
  it('[TC-COMMITMENTS-SUBS-001] registrar Streamly 10.99 USD con Visa USD crea la definición y el primer precio', async () => {
    const s = setup();
    const sub = await s.subs.create(cmd());
    expect(sub.status).toBe('ACTIVE');
    expect(sub.nextRenewalOn).toBe('2026-11-15');
    expect(sub.currentPrice).toEqual(usd('10.99'));
    expect(sub.priceHistory).toHaveLength(1);
    expect(sub.priceHistory?.[0]).toMatchObject({ effectiveFrom: '2026-11-15', origin: 'INITIAL' });
    const def = await s.mem.definitions.findById(WS, sub.definitionId);
    expect(def?.snapshot).toMatchObject({ kind: 'EXPENSE', managedBy: 'SUBSCRIPTION', managedRef: sub.id });
    expect(def?.current).toMatchObject({
      accountId: VISA_USD,
      counterpartyId: STREAMLY,
      amount: { type: 'FIXED', amount: '10.99' },
      currency: 'USD',
    });
    expect(def?.current.schedule).toMatchObject({ cadence: 'MONTHLY', startDate: '2026-11-15' });
    expect(def?.current.materialization.mode).toBe('PENDING_APPROVAL');
    const audited = s.mem.recordedFor(sub.id);
    expect(audited[0]?.entry.action).toBe('commitments.subscription.created');
    expect(audited[0]?.steps[0]).toMatchObject({
      kind: 'TRANSITION',
      transition: 'CREATE',
      toState: 'ACTIVE',
    });
    expect(sub.providerName).toBe('Streamly');
    expect(sub.paymentAccountName).toBe('Visa USD');
  });

  it('[TC-COMMITMENTS-SUBS-002] contraparte archivada, cuenta cerrada o precio cero no crean nada', async () => {
    const s = setup();
    expect(await codeOf(() => s.subs.create(cmd({ counterpartyId: OLDTV, name: 'OldTV' })))).toBe(
      'COUNTERPARTY_ARCHIVED',
    );
    expect(await codeOf(() => s.subs.create(cmd({ price: usd('0.00') })))).toBe('AMOUNT_NOT_POSITIVE');
    expect(await codeOf(() => s.subs.create(cmd({ price: usd('10.999') })))).toBe('AMOUNT_SCALE_EXCEEDED');
    expect(await codeOf(() => s.subs.create(cmd({ price: { amount: '1.00', currency: 'EUR' } })))).toBe(
      'CURRENCY_NOT_ENABLED',
    );
    s.mem.accountList.push({
      ...(s.mem.accountList.find((a) => a.accountId === VISA_USD) as never as Record<string, unknown>),
      accountId: '0190a000-0000-7000-8000-0000000acc99',
      status: 'CLOSED',
    } as never);
    expect(
      await codeOf(() => s.subs.create(cmd({ paymentAccountId: '0190a000-0000-7000-8000-0000000acc99' }))),
    ).toBe('ACCOUNT_CLOSED');
    expect(
      await codeOf(() => s.subs.create(cmd({ trialEndsOn: '2026-11-20', firstRenewalOn: '2026-11-01' }))),
    ).toBe('VALIDATION_FAILED');
    expect(s.mem.all()).toHaveLength(0);
    expect(await s.queries.list(WS, {})).toHaveLength(0);
  });

  it('[TC-COMMITMENTS-SUBS-003] USD pagado con tarjeta BOB estima cada cargo en BOB con la tasa paralela', async () => {
    const s = setup();
    const sub = await s.subs.create(cmd({ paymentAccountId: CARD }));
    expect(sub.currentPrice).toEqual(usd('10.99'));
    const def = await s.mem.definitions.findById(WS, sub.definitionId);
    expect(def?.current.amount).toEqual({ type: 'VARIABLE', amount: null, min: null, max: null });
    expect(def?.current.indexedPrice).toEqual({ amount: '10.99', currency: 'USD' });
    const first = occurrenceOn(s, sub.definitionId, '2026-11-15');
    expect(first?.expected).toMatchObject({ type: 'ESTIMATED', amount: '107.70' });
    expect(first?.currency).toBe('BOB');
    expect(sub.definition?.indexed).toBe(true);
  });

  it('[TC-COMMITMENTS-SUBS-035] sin tasa al generar el cargo queda sin monto, nunca 1:1', async () => {
    const s = setup();
    const sub = await s.subs.create(cmd({ paymentAccountId: CARD }));
    s.mem.rateTable.delete('USD/BOB');
    s.mem.setNow(noon('2026-11-20'));
    await s.engine.runWorkspace(WS);
    const generated = s.mem.forDefinition(sub.definitionId).filter((o) => o.occurrenceDate > '2027-01-18');
    expect(generated.length).toBeGreaterThan(0);
    for (const occ of generated) {
      expect(occ.expected).toEqual({ type: 'VARIABLE', amount: null, min: null, max: null });
    }
    expect(s.mem.forDefinition(sub.definitionId).some((o) => o.expected.amount === '10.99')).toBe(false);
    // Una ocurrencia sin monto pide el monto real al aprobarla.
    expect(
      await codeOf(() =>
        s.occs.materialize({ workspaceId: WS, userId: USER, occurrenceId: generated[0]!.id }),
      ),
    ).toBe('OCCURRENCE_AMOUNT_REQUIRED');
  });

  it('[TC-COMMITMENTS-SUBS-004] USDT desde una billetera USDT conserva la escala de 6 decimales', async () => {
    const s = setup();
    const sub = await s.subs.create(
      cmd({
        counterpartyId: VPN_PRO,
        name: 'VPN Pro',
        price: { amount: '5.000000', currency: 'USDT' },
        firstRenewalOn: '2026-11-03',
        paymentAccountId: WALLET_USDT,
      }),
    );
    const def = await s.mem.definitions.findById(WS, sub.definitionId);
    expect(def?.current.amount).toMatchObject({ type: 'FIXED', amount: '5.000000' });
    expect(def?.current.currency).toBe('USDT');
    expect(sub.priceHistory?.[0]?.price).toEqual({ amount: '5.000000', currency: 'USDT' });
    expect(
      await codeOf(() =>
        s.subs.create(
          cmd({ price: { amount: '5.0000001', currency: 'USDT' }, paymentAccountId: WALLET_USDT }),
        ),
      ),
    ).toBe('AMOUNT_SCALE_EXCEEDED');
  });

  it('[TC-COMMITMENTS-SUBS-005] el listado excluye las canceladas salvo al filtrar por ese estado', async () => {
    const s = setup();
    await s.subs.create(cmd());
    await s.subs.create(
      cmd({
        counterpartyId: CLOUDDRIVE,
        name: 'CloudDrive',
        trialEndsOn: '2026-11-20',
        firstRenewalOn: '2026-11-20',
      }),
    );
    const music = await s.subs.create(
      cmd({ counterpartyId: MUSICBOX, name: 'MusicBox', firstRenewalOn: '2026-11-05' }),
    );
    const old = await s.subs.create(
      cmd({ counterpartyId: DIARIO, name: 'OldTV', firstRenewalOn: '2026-11-10' }),
    );
    await s.subs.pause({
      workspaceId: WS,
      userId: USER,
      subscriptionId: music.id,
      expectedVersion: music.version,
    });
    await s.subs.cancel({
      workspaceId: WS,
      userId: USER,
      subscriptionId: old.id,
      expectedVersion: old.version,
    });
    const names = async (statuses?: Parameters<S['queries']['list']>[1]['statuses']) =>
      (await s.queries.list(WS, { statuses })).map((x) => `${x.name}:${x.status}`).sort();
    expect(await names()).toEqual(['CloudDrive:TRIAL', 'MusicBox:PAUSED', 'Streamly:ACTIVE']);
    expect(await names(['CANCELLED'])).toEqual(['OldTV:CANCELLED']);
  });
});

describe('Editar, estados y próxima renovación', () => {
  it('[TC-COMMITMENTS-SUBS-006] cambiar la tarjeta aplica desde la fecha de efecto sin tocar la transacción anterior', async () => {
    const s = setup('2026-10-10');
    const sub = await s.subs.create(cmd({ firstRenewalOn: '2026-10-15' }));
    s.mem.setNow(noon('2026-10-15'));
    await s.engine.runWorkspace(WS);
    await approve(s, sub.definitionId, '2026-10-15');
    const txn = [...s.mem.transactionsStore.values()][0]!;
    expect(txn.amount).toEqual(usd('10.99'));
    expect(txn.accountId).toBe(VISA_USD);

    const current = await s.queries.get(WS, sub.id);
    const updated = await s.subs.update({
      workspaceId: WS,
      userId: USER,
      subscriptionId: sub.id,
      expectedVersion: current.version,
      paymentAccountId: CARD,
      effectiveFrom: '2026-11-15',
    });
    expect(updated.paymentAccountId).toBe(CARD);
    const next = occurrenceOn(s, sub.definitionId, '2026-11-15');
    const view = await s.mem.occurrences.findView(WS, next!.id);
    expect(view?.accountId).toBe(CARD);
    expect(next?.expected).toMatchObject({ type: 'ESTIMATED', amount: '107.70' });
    // la transacción ya registrada sigue en Visa USD por 10.99 USD
    expect([...s.mem.transactionsStore.values()][0]).toMatchObject({
      accountId: VISA_USD,
      amount: usd('10.99'),
    });
    expect(occurrenceOn(s, sub.definitionId, '2026-10-15')?.status).toBe('MATERIALIZED');
    // sin fecha de efecto el cambio de cuenta se rechaza
    expect(
      await codeOf(() =>
        s.subs.update({
          workspaceId: WS,
          userId: USER,
          subscriptionId: sub.id,
          expectedVersion: updated.version,
          paymentAccountId: VISA_USD,
        }),
      ),
    ).toBe('VALIDATION_FAILED');
  });

  it('[TC-COMMITMENTS-SUBS-006] una suscripción cancelada no se edita y el If-Match se verifica', async () => {
    const s = setup();
    const sub = await s.subs.create(cmd());
    expect(
      await codeOf(() =>
        s.subs.update({
          workspaceId: WS,
          userId: USER,
          subscriptionId: sub.id,
          expectedVersion: 99,
          planName: 'x',
        }),
      ),
    ).toBe('PRECONDITION_FAILED');
    const cancelled = await s.subs.cancel({
      workspaceId: WS,
      userId: USER,
      subscriptionId: sub.id,
      expectedVersion: sub.version,
    });
    expect(
      await codeOf(() =>
        s.subs.update({
          workspaceId: WS,
          userId: USER,
          subscriptionId: sub.id,
          expectedVersion: cancelled.version,
          planName: 'Estándar',
        }),
      ),
    ).toBe('INVALID_STATUS_TRANSITION');
  });

  it('[TC-COMMITMENTS-SUBS-016] cada cambio queda auditado con el diff (plan Premium → Estándar)', async () => {
    const s = setup();
    const sub = await s.subs.create(cmd());
    const updated = await s.subs.update({
      workspaceId: WS,
      userId: USER,
      subscriptionId: sub.id,
      expectedVersion: sub.version,
      planName: 'Estándar',
      name: 'Streamly TV',
    });
    expect(updated.planName).toBe('Estándar');
    const def = await s.mem.definitions.findById(WS, sub.definitionId);
    expect(def?.snapshot.name).toBe('Streamly TV');
    const entry = s.mem
      .recordedFor(sub.id)
      .find((r) => r.entry.action === 'commitments.subscription.updated');
    expect(entry?.entry.changes).toEqual(
      expect.arrayContaining([
        { field: 'planName', before: 'Premium', after: 'Estándar' },
        { field: 'name', before: 'Streamly', after: 'Streamly TV' },
      ]),
    );
    expect(entry?.steps[0]).toMatchObject({ kind: 'ANNOTATION', changedFields: ['name', 'planName'] });
  });

  it('[TC-COMMITMENTS-SUBS-008] el fin de trial pasa a ACTIVE una sola vez, a las 00:05 de La Paz', async () => {
    const s = setup();
    const sub = await s.subs.create(
      cmd({
        counterpartyId: CLOUDDRIVE,
        name: 'CloudDrive',
        price: usd('99.99'),
        billingCycle: { cadence: 'ANNUAL' },
        firstRenewalOn: '2026-11-20',
        trialEndsOn: '2026-11-20',
      }),
    );
    expect(sub.status).toBe('TRIAL');
    // 23:30 del 19 en La Paz = 03:30Z del 20: aún es el día 19
    s.mem.setNow('2026-11-20T03:30:00Z');
    expect((await s.daily.runWorkspace(WS)).trialsEnded).toBe(0);
    expect(s.mem.subscription(sub.id).status).toBe('TRIAL');
    // 00:05 del 20
    s.mem.setNow('2026-11-20T04:05:00Z');
    expect((await s.daily.runWorkspace(WS)).trialsEnded).toBe(1);
    expect(s.mem.subscription(sub.id)).toMatchObject({ status: 'ACTIVE', nextRenewalOn: '2026-11-20' });
    expect((await s.queries.get(WS, sub.id)).currentPrice).toEqual(usd('99.99'));
    // una segunda corrida no vuelve a pasarla
    expect((await s.daily.runWorkspace(WS)).trialsEnded).toBe(0);
    const transitions = s.mem
      .recordedFor(sub.id)
      .flatMap((r) => r.steps)
      .filter((st) => st.kind === 'TRANSITION')
      .map((st) => (st as { transition: string }).transition);
    expect(transitions).toEqual(['CREATE', 'END_TRIAL']);
  });

  it('[TC-COMMITMENTS-SUBS-009] cancelar durante el trial no deja cargos esperados ni transacciones', async () => {
    const s = setup();
    const sub = await s.subs.create(
      cmd({
        counterpartyId: CLOUDDRIVE,
        name: 'CloudDrive',
        price: usd('99.99'),
        billingCycle: { cadence: 'ANNUAL' },
        firstRenewalOn: '2026-11-20',
        trialEndsOn: '2026-11-20',
      }),
    );
    s.mem.setNow(noon('2026-11-10'));
    const cancelled = await s.subs.cancel({
      workspaceId: WS,
      userId: USER,
      subscriptionId: sub.id,
      expectedVersion: sub.version,
    });
    expect(cancelled).toMatchObject({ status: 'CANCELLED', cancelledOn: '2026-11-10', nextRenewalOn: null });
    expect(pendingOf(s, sub.definitionId)).toHaveLength(0);
    expect(s.mem.transactionsStore.size).toBe(0);
    const def = await s.mem.definitions.findById(WS, sub.definitionId);
    expect(def?.status).toBe('ENDED');
  });

  it('[TC-COMMITMENTS-SUBS-010] la próxima renovación omite lo pagado y lo omitido y respeta el fin de mes', async () => {
    const s = setup('2026-10-20');
    const sub = await s.subs.create(cmd());
    const next = (today: string) =>
      s.deps.managed.nextRenewal({ workspaceId: WS, definitionId: sub.definitionId, today });
    // pagada: hoy 2026-11-15 con el cargo del 15 materializado
    s.mem.setNow(noon('2026-11-15'));
    await s.engine.runWorkspace(WS);
    await approve(s, sub.definitionId, '2026-11-15');
    expect(await next('2026-11-15')).toBe('2026-12-15');
    // omitida: el cargo del 2026-12-15 se omite y hoy es 2026-12-01
    await s.occs.skip({
      workspaceId: WS,
      userId: USER,
      occurrenceId: occurrenceOn(s, sub.definitionId, '2026-12-15')!.id,
      reason: 'viaje',
    });
    expect(await next('2026-12-01')).toBe('2027-01-15');
    // la proyección se refresca con los hechos del motor
    await s.deliver();
    expect((await s.queries.get(WS, sub.id)).nextRenewalOn).toBe('2027-01-15');

    // día 31 en un mes corto
    const gym = await s.subs.create(
      cmd({
        counterpartyId: GYM,
        name: 'Gimnasio Centro',
        price: bob('250.00'),
        paymentAccountId: BANK,
        firstRenewalOn: '2026-12-31',
      }),
    );
    s.mem.setNow(noon('2027-02-10'));
    expect(
      await s.deps.managed.nextRenewal({
        workspaceId: WS,
        definitionId: gym.definitionId,
        today: '2027-02-10',
      }),
    ).toBe('2027-02-28');
  });

  it('[TC-COMMITMENTS-SUBS-010] un ciclo anual más largo que el horizonte también tiene próxima renovación', async () => {
    const s = setup('2026-10-20');
    const sub = await s.subs.create(
      cmd({
        counterpartyId: CLOUDDRIVE,
        name: 'CloudDrive',
        billingCycle: { cadence: 'ANNUAL' },
        firstRenewalOn: '2027-08-01',
      }),
    );
    expect(sub.nextRenewalOn).toBe('2027-08-01');
    expect(pendingOf(s, sub.definitionId)).toHaveLength(0);
  });

  it('[TC-COMMITMENTS-SUBS-011] pausar y reanudar no genera cargos de las fechas transcurridas durante la pausa', async () => {
    const s = setup('2026-10-20');
    const sub = await s.subs.create(
      cmd({ counterpartyId: MUSICBOX, name: 'MusicBox', price: usd('9.99'), firstRenewalOn: '2026-11-05' }),
    );
    expect(pendingOf(s, sub.definitionId).length).toBeGreaterThan(0);
    s.mem.setNow(noon('2026-11-01'));
    const paused = await s.subs.pause({
      workspaceId: WS,
      userId: USER,
      subscriptionId: sub.id,
      expectedVersion: sub.version,
    });
    expect(paused).toMatchObject({ status: 'PAUSED', nextRenewalOn: null });
    expect(pendingOf(s, sub.definitionId)).toHaveLength(0);
    s.mem.setNow(noon('2027-01-10'));
    const resumed = await s.subs.resume({
      workspaceId: WS,
      userId: USER,
      subscriptionId: sub.id,
      expectedVersion: paused.version,
    });
    expect(resumed).toMatchObject({ status: 'ACTIVE', nextRenewalOn: '2027-02-05' });
    const dates = pendingOf(s, sub.definitionId).map((o) => o.occurrenceDate);
    expect(dates).not.toContain('2026-11-05');
    expect(dates).not.toContain('2026-12-05');
    expect(dates).not.toContain('2027-01-05');
    expect(dates[0]).toBe('2027-02-05');
    expect(s.mem.transactionsStore.size).toBe(0);
  });

  it('[TC-COMMITMENTS-SUBS-015] cancelar finaliza la definición y conserva transacciones e historial', async () => {
    const s = setup('2026-09-10');
    const sub = await s.subs.create(cmd({ firstRenewalOn: '2026-09-15' }));
    s.mem.setNow(noon('2026-09-15'));
    await approve(s, sub.definitionId, '2026-09-15');
    s.mem.setNow(noon('2026-10-15'));
    await s.engine.runWorkspace(WS);
    await approve(s, sub.definitionId, '2026-10-15');
    s.mem.setNow(noon('2026-11-02'));
    const current = await s.queries.get(WS, sub.id);
    const cancelled = await s.subs.cancel({
      workspaceId: WS,
      userId: USER,
      subscriptionId: sub.id,
      expectedVersion: current.version,
      reason: 'ya no lo uso',
    });
    expect(cancelled).toMatchObject({
      status: 'CANCELLED',
      cancelledOn: '2026-11-02',
      nextRenewalOn: null,
      cancellationReason: 'ya no lo uso',
    });
    expect(occurrenceOn(s, sub.definitionId, '2026-11-15')).toMatchObject({
      status: 'CANCELLED',
      cancelReason: 'ENDED',
    });
    expect((await s.mem.definitions.findById(WS, sub.definitionId))?.status).toBe('ENDED');
    const txns = [...s.mem.transactionsStore.values()];
    expect(txns.map((t) => t.amount)).toEqual([usd('10.99'), usd('10.99')]);
    expect(cancelled.priceHistory).toHaveLength(1);
    const event = s.mem.eventsOf('commitments.SubscriptionCancelled')[0]?.payload;
    expect(event).toMatchObject({
      subscriptionId: sub.id,
      cancelledOn: '2026-11-02',
      scheduled: false,
      reason: 'ya no lo uso',
    });
    // cancelar dos veces
    expect(
      await codeOf(() =>
        s.subs.cancel({
          workspaceId: WS,
          userId: USER,
          subscriptionId: sub.id,
          expectedVersion: cancelled.version,
        }),
      ),
    ).toBe('INVALID_STATUS_TRANSITION');
  });

  it('[TC-COMMITMENTS-SUBS-019] una cancelación programada mantiene el estado hasta la fecha y puede deshacerse', async () => {
    const s = setup('2026-10-20');
    const sub = await s.subs.create(cmd());
    s.mem.setNow(noon('2026-11-15'));
    await s.engine.runWorkspace(WS);
    await approve(s, sub.definitionId, '2026-11-15');
    s.mem.setNow(noon('2026-11-20'));
    const before = await s.queries.get(WS, sub.id);
    const scheduled = await s.subs.cancel({
      workspaceId: WS,
      userId: USER,
      subscriptionId: sub.id,
      expectedVersion: before.version,
      effectiveOn: '2026-12-15',
    });
    expect(scheduled).toMatchObject({ status: 'ACTIVE', scheduledCancellationOn: '2026-12-15' });
    expect(pendingOf(s, sub.definitionId).filter((o) => o.occurrenceDate >= '2026-12-15')).toHaveLength(0);
    // el job del motor no termina la definición ni regenera fechas posteriores
    s.mem.setNow(noon('2026-12-01'));
    await s.engine.runWorkspace(WS);
    expect((await s.mem.definitions.findById(WS, sub.definitionId))?.status).toBe('ACTIVE');
    expect(pendingOf(s, sub.definitionId).filter((o) => o.occurrenceDate >= '2026-12-15')).toHaveLength(0);

    // deshacer el 2026-12-01
    const undone = await s.subs.undoScheduledCancellation({
      workspaceId: WS,
      userId: USER,
      subscriptionId: sub.id,
      expectedVersion: scheduled.version,
    });
    expect(undone).toMatchObject({
      status: 'ACTIVE',
      scheduledCancellationOn: null,
      nextRenewalOn: '2026-12-15',
    });
    const dates = pendingOf(s, sub.definitionId).map((o) => o.occurrenceDate);
    expect(dates[0]).toBe('2026-12-15');
    expect(dates.length).toBeGreaterThan(2);
    expect(
      await codeOf(() =>
        s.subs.undoScheduledCancellation({
          workspaceId: WS,
          userId: USER,
          subscriptionId: sub.id,
          expectedVersion: undone.version,
        }),
      ),
    ).toBe('INVALID_STATUS_TRANSITION');

    // programar de nuevo y dejar que llegue la fecha (00:05 de La Paz)
    const again = await s.subs.cancel({
      workspaceId: WS,
      userId: USER,
      subscriptionId: sub.id,
      expectedVersion: undone.version,
      effectiveOn: '2026-12-15',
      reason: 'fin del mes pagado',
    });
    s.mem.setNow('2026-12-15T03:30:00Z');
    expect((await s.daily.runWorkspace(WS)).cancelled).toBe(0);
    s.mem.setNow('2026-12-15T04:05:00Z');
    expect((await s.daily.runWorkspace(WS)).cancelled).toBe(1);
    expect(s.mem.subscription(sub.id)).toMatchObject({
      status: 'CANCELLED',
      cancelledOn: '2026-12-15',
      scheduledCancellationOn: null,
    });
    expect((await s.mem.definitions.findById(WS, sub.definitionId))?.status).toBe('ENDED');
    expect((await s.daily.runWorkspace(WS)).cancelled).toBe(0);
    expect(s.mem.eventsOf('commitments.SubscriptionCancelled')).toHaveLength(1);
    expect(s.mem.eventsOf('commitments.SubscriptionCancelled')[0]?.payload).toMatchObject({
      scheduled: true,
      cancelledOn: '2026-12-15',
      reason: 'fin del mes pagado',
    });
    expect(again.scheduledCancellationOn).toBe('2026-12-15');
  });

  it('[TC-COMMITMENTS-SUBS-019] reprogramar la cancelación reinstaura los cargos de la fecha anterior', async () => {
    const s = setup('2026-10-20');
    const sub = await s.subs.create(cmd());
    const first = await s.subs.cancel({
      workspaceId: WS,
      userId: USER,
      subscriptionId: sub.id,
      expectedVersion: sub.version,
      effectiveOn: '2026-12-15',
    });
    expect(pendingOf(s, sub.definitionId).map((o) => o.occurrenceDate)).toEqual(['2026-11-15']);
    const second = await s.subs.cancel({
      workspaceId: WS,
      userId: USER,
      subscriptionId: sub.id,
      expectedVersion: first.version,
      effectiveOn: '2027-01-15',
    });
    expect(second.scheduledCancellationOn).toBe('2027-01-15');
    expect(pendingOf(s, sub.definitionId).map((o) => o.occurrenceDate)).toEqual(['2026-11-15', '2026-12-15']);
  });
});

describe('Precios', () => {
  it('[TC-COMMITMENTS-SUBS-013] un cambio manual aplica a renovaciones futuras y publica el hecho con origen manual', async () => {
    const s = setup('2026-10-20');
    const sub = await s.subs.create(cmd());
    s.mem.setNow(noon('2026-11-15'));
    await s.engine.runWorkspace(WS);
    await approve(s, sub.definitionId, '2026-11-15');
    const current = await s.queries.get(WS, sub.id);
    const changed = await s.subs.changePrice({
      workspaceId: WS,
      userId: USER,
      subscriptionId: sub.id,
      expectedVersion: current.version,
      price: usd('12.99'),
      effectiveFrom: '2027-03-15',
    });
    expect(changed.priceHistory?.map((p) => [p.effectiveFrom, p.price.amount, p.origin])).toEqual([
      ['2026-11-15', '10.99', 'INITIAL'],
      ['2027-03-15', '12.99', 'MANUAL'],
    ]);
    expect(changed.currentPrice).toEqual(usd('10.99'));
    s.mem.setNow(noon('2027-02-20'));
    await s.engine.runWorkspace(WS);
    expect(occurrenceOn(s, sub.definitionId, '2027-03-15')?.expected).toMatchObject({
      type: 'FIXED',
      amount: '12.99',
    });
    expect(occurrenceOn(s, sub.definitionId, '2027-02-15')?.expected).toMatchObject({ amount: '10.99' });
    expect([...s.mem.transactionsStore.values()][0]?.amount).toEqual(usd('10.99'));
    const event = s.mem.eventsOf('commitments.SubscriptionPriceChanged');
    expect(event).toHaveLength(1);
    expect(event[0]?.payload).toMatchObject({
      origin: 'MANUAL',
      previousPrice: usd('10.99'),
      newPrice: usd('12.99'),
      effectiveFrom: '2027-03-15',
      changePercentage: '+18.20',
      providerName: 'Streamly',
      proposalId: null,
    });
  });

  it('[TC-COMMITMENTS-SUBS-014] una vigencia anterior a la última entrada se rechaza', async () => {
    const s = setup('2026-10-20');
    const sub = await s.subs.create(cmd());
    const changed = await s.subs.changePrice({
      workspaceId: WS,
      userId: USER,
      subscriptionId: sub.id,
      expectedVersion: sub.version,
      price: usd('12.99'),
      effectiveFrom: '2027-03-15',
    });
    expect(
      await codeOf(() =>
        s.subs.changePrice({
          workspaceId: WS,
          userId: USER,
          subscriptionId: sub.id,
          expectedVersion: changed.version,
          price: usd('11.99'),
          effectiveFrom: '2027-01-15',
        }),
      ),
    ).toBe('SUBSCRIPTION_PRICE_NOT_CHRONOLOGICAL');
    expect(
      await codeOf(() =>
        s.subs.changePrice({
          workspaceId: WS,
          userId: USER,
          subscriptionId: sub.id,
          expectedVersion: changed.version,
          price: { amount: '11.99', currency: 'BOB' },
          effectiveFrom: '2027-06-15',
        }),
      ),
    ).toBe('CURRENCY_MISMATCH');
    expect(s.mem.pricesOf(sub.id)).toHaveLength(2);
  });

  it('[TC-COMMITMENTS-SUBS-018] corregir un precio tipeado mal lo reemplaza y conserva la entrada original', async () => {
    const s = setup('2026-10-20');
    const sub = await s.subs.create(cmd());
    const typo = await s.subs.changePrice({
      workspaceId: WS,
      userId: USER,
      subscriptionId: sub.id,
      expectedVersion: sub.version,
      price: usd('129.90'),
      effectiveFrom: '2027-03-15',
    });
    const wrong = typo.priceHistory!.find((p) => p.price.amount === '129.90')!;
    const fixed = await s.subs.supersedePrice({
      workspaceId: WS,
      userId: USER,
      subscriptionId: sub.id,
      expectedVersion: typo.version,
      priceId: wrong.id,
      price: usd('12.99'),
    });
    expect(fixed.priceHistory?.map((p) => [p.price.amount, p.origin, p.supersededBy !== null])).toEqual([
      ['10.99', 'INITIAL', false],
      ['129.90', 'MANUAL', true],
      ['12.99', 'CORRECTION', false],
    ]);
    s.mem.setNow(noon('2027-02-20'));
    await s.engine.runWorkspace(WS);
    expect(occurrenceOn(s, sub.definitionId, '2027-03-15')?.expected).toMatchObject({ amount: '12.99' });
    const events = s.mem.eventsOf('commitments.SubscriptionPriceChanged');
    expect(events.map((e) => e.payload['origin'])).toEqual(['MANUAL', 'CORRECTION']);
    expect(
      await codeOf(() =>
        s.subs.supersedePrice({
          workspaceId: WS,
          userId: USER,
          subscriptionId: sub.id,
          expectedVersion: fixed.version,
          priceId: wrong.id,
          price: usd('13.00'),
        }),
      ),
    ).toBe('INVALID_STATUS_TRANSITION');
  });

  it('[TC-COMMITMENTS-SUBS-018] corregir una entrada pasada cuyo precio ya no rige no publica el hecho', async () => {
    const s = setup('2026-10-20');
    const sub = await s.subs.create(cmd());
    const two = await s.subs.changePrice({
      workspaceId: WS,
      userId: USER,
      subscriptionId: sub.id,
      expectedVersion: sub.version,
      price: usd('12.99'),
      effectiveFrom: '2026-12-15',
    });
    s.mem.setNow(noon('2027-05-01'));
    const published = s.mem.eventsOf('commitments.SubscriptionPriceChanged').length;
    await s.subs.supersedePrice({
      workspaceId: WS,
      userId: USER,
      subscriptionId: sub.id,
      expectedVersion: two.version,
      priceId: two.priceHistory![0]!.id,
      price: usd('11.49'),
    });
    expect(s.mem.eventsOf('commitments.SubscriptionPriceChanged')).toHaveLength(published);
  });
});

describe('Detección de cambio de precio', () => {
  async function musicbox(s: S, price = '9.99') {
    return s.subs.create(
      cmd({ counterpartyId: MUSICBOX, name: 'MusicBox', price: usd(price), firstRenewalOn: '2026-10-05' }),
    );
  }

  it('[TC-COMMITMENTS-SUBS-020] un cargo que supera la tolerancia crea una propuesta y publica el hecho detectado', async () => {
    const s = setup('2026-10-01');
    const sub = await musicbox(s);
    s.mem.setNow(noon('2026-11-05'));
    await s.engine.runWorkspace(WS);
    await approve(s, sub.definitionId, '2026-10-05');
    expect(s.mem.proposalsOf(sub.id)).toHaveLength(0);
    await approve(s, sub.definitionId, '2026-11-05', usd('11.99'));
    const [charge] = s.mem.chargesOf(sub.id).filter((c) => c.occurrenceDate === '2026-11-05');
    expect(charge).toMatchObject({ outcome: 'PRICE_CHANGE_DETECTED', deviationPercent: '+20.02' });
    const [proposal] = s.mem.proposalsOf(sub.id);
    expect(proposal).toMatchObject({
      status: 'PENDING',
      effectiveFrom: '2026-11-05',
      changePercent: '+20.02',
    });
    expect(proposal?.proposedPrice.toJSON()).toEqual(usd('11.99'));
    const events = s.mem.eventsOf('commitments.SubscriptionPriceChanged');
    expect(events).toHaveLength(1);
    expect(events[0]?.payload).toMatchObject({
      origin: 'DETECTED',
      previousPrice: usd('9.99'),
      newPrice: usd('11.99'),
      changePercentage: '+20.02',
      proposalId: proposal?.id,
      chargeId: charge?.id,
    });
    const detail = await s.queries.get(WS, sub.id);
    expect(detail.currentPrice).toEqual(usd('9.99'));
    expect(detail.pendingProposal).toMatchObject({ proposedPrice: usd('11.99'), status: 'PENDING' });
  });

  it('[TC-COMMITMENTS-SUBS-021] una diferencia dentro de la tolerancia o exactamente en el límite no crea propuesta', async () => {
    const s = setup('2026-10-01');
    const music = await musicbox(s);
    const gym = await s.subs.create(
      cmd({
        counterpartyId: GYM,
        name: 'Gimnasio Centro',
        price: bob('250.00'),
        paymentAccountId: BANK,
        firstRenewalOn: '2026-10-05',
      }),
    );
    s.mem.setNow(noon('2026-10-05'));
    await approve(s, music.definitionId, '2026-10-05', usd('10.05'));
    await approve(s, gym.definitionId, '2026-10-05', bob('252.50'));
    expect(s.mem.proposalsOf(music.id)).toHaveLength(0);
    expect(s.mem.proposalsOf(gym.id)).toHaveLength(0);
    expect(s.mem.chargesOf(music.id)[0]?.outcome).toBe('WITHIN_TOLERANCE');
    expect(s.mem.eventsOf('commitments.SubscriptionPriceChanged')).toHaveLength(0);
  });

  it('[TC-COMMITMENTS-SUBS-021] la tolerancia es configurable por suscripción', async () => {
    const s = setup('2026-10-01');
    const sub = await musicbox(s);
    const updated = await s.subs.update({
      workspaceId: WS,
      userId: USER,
      subscriptionId: sub.id,
      expectedVersion: sub.version,
      priceTolerancePercent: '25.00',
    });
    expect(updated.priceTolerancePercent).toBe('25.00');
    s.mem.setNow(noon('2026-10-05'));
    await approve(s, sub.definitionId, '2026-10-05', usd('11.99'));
    expect(s.mem.proposalsOf(sub.id)).toHaveLength(0);
  });

  it('[TC-COMMITMENTS-SUBS-022] la detección es idempotente ante el hecho reentregado', async () => {
    const s = setup('2026-10-01');
    const sub = await musicbox(s);
    s.mem.setNow(noon('2026-10-05'));
    await approve(s, sub.definitionId, '2026-10-05', usd('11.99'));
    const event = s.mem.eventsOf('commitments.RecurringOccurrenceMaterialized')[0]!;
    const p = event.payload as unknown as Fact;
    const fact = {
      workspaceId: WS,
      occurrenceId: p.occurrenceId,
      definitionId: p.definitionId,
      occurrenceDate: p.occurrenceDate,
      managedBy: p.managedBy,
      transactionId: p.transactionId,
      amount: p.amount,
    };
    await s.charges.onOccurrenceMaterialized(fact);
    await s.charges.onOccurrenceMaterialized(fact);
    await Promise.all([s.charges.onOccurrenceMaterialized(fact), s.charges.onOccurrenceMaterialized(fact)]);
    expect(s.mem.chargesOf(sub.id)).toHaveLength(1);
    expect(s.mem.proposalsOf(sub.id)).toHaveLength(1);
    expect(s.mem.eventsOf('commitments.SubscriptionPriceChanged')).toHaveLength(1);
  });

  it('[TC-COMMITMENTS-SUBS-022] una detección con otro monto reemplaza la propuesta pendiente; con el mismo no crea nada', async () => {
    const s = setup('2026-10-01');
    const sub = await musicbox(s);
    s.mem.setNow(noon('2026-12-05'));
    await s.engine.runWorkspace(WS);
    await approve(s, sub.definitionId, '2026-10-05', usd('11.99'));
    await approve(s, sub.definitionId, '2026-11-05', usd('11.99'));
    expect(s.mem.proposalsOf(sub.id).map((x) => x.status)).toEqual(['PENDING']);
    await approve(s, sub.definitionId, '2026-12-05', usd('12.49'));
    const statuses = s.mem.proposalsOf(sub.id).map((x) => [x.effectiveFrom, x.status]);
    expect(statuses).toEqual([
      ['2026-10-05', 'SUPERSEDED'],
      ['2026-12-05', 'PENDING'],
    ]);
    expect(s.mem.eventsOf('commitments.SubscriptionPriceChanged')).toHaveLength(2);
  });

  it('[TC-COMMITMENTS-SUBS-022] liberar el cargo (transacción anulada) lo anula y retira la propuesta sin hecho', async () => {
    const s = setup('2026-10-01');
    const sub = await musicbox(s);
    s.mem.setNow(noon('2026-10-05'));
    await approve(s, sub.definitionId, '2026-10-05', usd('11.99'));
    const txnId = [...s.mem.transactionsStore.keys()][0]!;
    s.mem.voidTransaction(txnId);
    await s.occs.onTransactionVoided({ workspaceId: WS, transactionId: txnId });
    await s.deliver();
    expect(s.mem.chargesOf(sub.id)[0]?.outcome).toBe('VOIDED');
    expect(s.mem.proposalsOf(sub.id)[0]?.status).toBe('WITHDRAWN');
    expect(s.mem.eventsOf('commitments.SubscriptionPriceChanged')).toHaveLength(1);
    // vincular otra transacción crea un cargo nuevo y revive la propuesta con el nuevo monto
    const other = s.mem.addTransaction({
      kind: 'EXPENSE',
      accountId: VISA_USD,
      amount: usd('12.49'),
      businessDate: '2026-10-05',
    });
    await s.occs.link({
      workspaceId: WS,
      userId: USER,
      occurrenceId: occurrenceOn(s, sub.definitionId, '2026-10-05')!.id,
      transactionId: other,
    });
    await s.deliver();
    const charges = s.mem.chargesOf(sub.id);
    expect(charges.map((c) => c.outcome)).toEqual(['VOIDED', 'PRICE_CHANGE_DETECTED']);
    const [proposal] = s.mem.proposalsOf(sub.id);
    expect(proposal).toMatchObject({ status: 'PENDING', chargeId: charges[1]?.id });
    expect(proposal?.proposedPrice.toJSON()).toEqual(usd('12.49'));
  });

  it('[TC-COMMITMENTS-SUBS-023] aceptar agrega el precio al historial sin un segundo hecho; rechazar no lo cambia', async () => {
    const s = setup('2026-10-01');
    const sub = await musicbox(s);
    s.mem.setNow(noon('2026-11-05'));
    await s.engine.runWorkspace(WS);
    await approve(s, sub.definitionId, '2026-10-05');
    await approve(s, sub.definitionId, '2026-11-05', usd('11.99'));
    const [proposal] = s.mem.proposalsOf(sub.id);
    const current = await s.queries.get(WS, sub.id);
    const accepted = await s.subs.acceptProposal({
      workspaceId: WS,
      userId: USER,
      subscriptionId: sub.id,
      expectedVersion: current.version,
      proposalId: proposal!.id,
    });
    expect(accepted.priceHistory?.map((p) => [p.effectiveFrom, p.price.amount, p.origin])).toEqual([
      ['2026-10-05', '9.99', 'INITIAL'],
      ['2026-11-05', '11.99', 'PROPOSAL'],
    ]);
    expect(accepted.priceHistory?.[1]?.proposalId).toBe(proposal!.id);
    expect(accepted.pendingProposal).toBeNull();
    expect(s.mem.proposalsOf(sub.id)[0]?.status).toBe('ACCEPTED');
    expect(occurrenceOn(s, sub.definitionId, '2026-12-05')?.expected).toMatchObject({ amount: '11.99' });
    expect(s.mem.eventsOf('commitments.SubscriptionPriceChanged')).toHaveLength(1);
    // decidir otra vez
    expect(
      await codeOf(() =>
        s.subs.rejectProposal({
          workspaceId: WS,
          userId: USER,
          subscriptionId: sub.id,
          expectedVersion: accepted.version,
          proposalId: proposal!.id,
        }),
      ),
    ).toBe('SUBSCRIPTION_PROPOSAL_NOT_PENDING');
  });

  it('[TC-COMMITMENTS-SUBS-023] rechazar deja el precio vigente y la propuesta no se puede aceptar después', async () => {
    const s = setup('2026-10-01');
    const sub = await musicbox(s);
    s.mem.setNow(noon('2026-10-05'));
    await approve(s, sub.definitionId, '2026-10-05', usd('11.99'));
    const [proposal] = s.mem.proposalsOf(sub.id);
    const current = await s.queries.get(WS, sub.id);
    const rejected = await s.subs.rejectProposal({
      workspaceId: WS,
      userId: USER,
      subscriptionId: sub.id,
      expectedVersion: current.version,
      proposalId: proposal!.id,
    });
    expect(rejected.currentPrice).toEqual(usd('9.99'));
    expect(rejected.pendingProposal).toBeNull();
    expect(s.mem.proposalsOf(sub.id)[0]?.status).toBe('REJECTED');
    expect(
      await codeOf(() =>
        s.subs.acceptProposal({
          workspaceId: WS,
          userId: USER,
          subscriptionId: sub.id,
          expectedVersion: rejected.version,
          proposalId: proposal!.id,
        }),
      ),
    ).toBe('SUBSCRIPTION_PROPOSAL_NOT_PENDING');
  });

  it('[TC-COMMITMENTS-SUBS-023] aceptar con una vigencia no cronológica exige una fecha posterior explícita', async () => {
    const s = setup('2026-10-01');
    const sub = await musicbox(s);
    s.mem.setNow(noon('2026-10-05'));
    await approve(s, sub.definitionId, '2026-10-05', usd('11.99'));
    const [proposal] = s.mem.proposalsOf(sub.id);
    // el usuario registró a mano un precio más nuevo entre medio
    const manual = await s.subs.changePrice({
      workspaceId: WS,
      userId: USER,
      subscriptionId: sub.id,
      expectedVersion: (await s.queries.get(WS, sub.id)).version,
      price: usd('10.49'),
      effectiveFrom: '2026-11-05',
    });
    const accept = (effectiveFrom?: string) => () =>
      s.subs.acceptProposal({
        workspaceId: WS,
        userId: USER,
        subscriptionId: sub.id,
        expectedVersion: manual.version,
        proposalId: proposal!.id,
        effectiveFrom,
      });
    expect(await codeOf(accept())).toBe('SUBSCRIPTION_PRICE_NOT_CHRONOLOGICAL');
    expect(await codeOf(accept('2026-11-05'))).toBe('SUBSCRIPTION_PRICE_NOT_CHRONOLOGICAL');
    const done = await accept('2026-12-05')();
    expect(done.priceHistory?.at(-1)).toMatchObject({ effectiveFrom: '2026-12-05', origin: 'PROPOSAL' });
  });

  it('[TC-COMMITMENTS-SUBS-024] un cargo en BOB de una suscripción en USD registra la tasa implícita y detecta solo con el monto del extracto', async () => {
    const s = setup('2026-10-20');
    const sub = await s.subs.create(cmd({ paymentAccountId: CARD }));
    s.mem.setNow(noon('2026-11-15'));
    await approve(s, sub.definitionId, '2026-11-15', bob('108.50'));
    const [charge] = s.mem.chargesOf(sub.id);
    expect(charge).toMatchObject({ outcome: 'NOT_COMPARABLE', deviationPercent: null });
    const dto = (await s.queries.listCharges(WS, sub.id, 10))[0];
    expect(dto).toMatchObject({
      impliedRate: '9.8726',
      charged: bob('108.50'),
      expectedPrice: usd('10.99'),
      outcome: 'NOT_COMPARABLE',
    });
    expect(s.mem.proposalsOf(sub.id)).toHaveLength(0);
    expect(s.mem.eventsOf('commitments.SubscriptionPriceChanged')).toHaveLength(0);

    // el EDITOR indica el monto del extracto
    const updated = await s.charges.recordOriginalAmount({
      workspaceId: WS,
      userId: USER,
      subscriptionId: sub.id,
      chargeId: charge!.id,
      amount: usd('12.99'),
      expectedVersion: s.mem.subscription(sub.id).version,
    });
    expect(updated).toMatchObject({ outcome: 'PRICE_CHANGE_DETECTED', deviationPercent: '+18.20' });
    const [proposal] = s.mem.proposalsOf(sub.id);
    expect(proposal).toMatchObject({
      status: 'PENDING',
      effectiveFrom: '2026-11-15',
      changePercent: '+18.20',
    });
    expect(proposal?.proposedPrice.toJSON()).toEqual(usd('12.99'));
    expect(s.mem.eventsOf('commitments.SubscriptionPriceChanged')).toHaveLength(1);

    // validaciones del monto del extracto
    expect(
      await codeOf(() =>
        s.charges.recordOriginalAmount({
          workspaceId: WS,
          userId: USER,
          subscriptionId: sub.id,
          chargeId: charge!.id,
          amount: bob('1.00'),
          expectedVersion: s.mem.subscription(sub.id).version,
        }),
      ),
    ).toBe('CURRENCY_MISMATCH');
  });
});

describe('Costo de las suscripciones', () => {
  async function owner(s: S, extra = true) {
    await s.subs.create(cmd({ firstRenewalOn: '2026-11-15' }));
    await s.subs.create(
      cmd({
        counterpartyId: CLOUDDRIVE,
        name: 'CloudDrive',
        price: usd('99.99'),
        billingCycle: { cadence: 'ANNUAL' },
        firstRenewalOn: '2027-03-01',
      }),
    );
    await s.subs.create(
      cmd({
        counterpartyId: VPN_PRO,
        name: 'VPN Pro',
        price: { amount: '5.000000', currency: 'USDT' },
        firstRenewalOn: '2026-11-03',
        paymentAccountId: WALLET_USDT,
      }),
    );
    await s.subs.create(
      cmd({
        counterpartyId: GYM,
        name: 'Gimnasio Centro',
        price: bob('250.00'),
        paymentAccountId: BANK,
        firstRenewalOn: '2026-11-25',
      }),
    );
    if (extra) {
      const music = await s.subs.create(
        cmd({ counterpartyId: MUSICBOX, name: 'MusicBox', price: usd('9.99'), firstRenewalOn: '2026-11-05' }),
      );
      await s.subs.pause({
        workspaceId: WS,
        userId: USER,
        subscriptionId: music.id,
        expectedVersion: music.version,
      });
      await s.subs.create(
        cmd({
          counterpartyId: PHOTOLAB,
          name: 'PhotoLab',
          price: usd('4.99'),
          firstRenewalOn: '2026-12-10',
          trialEndsOn: '2026-12-10',
        }),
      );
    }
  }

  it('[TC-COMMITMENTS-SUBS-025] las suscripciones del owner suman 487.86 BOB al mes y 5854.33 BOB al año', async () => {
    const s = setup('2026-11-10');
    await owner(s, false);
    const cost = await s.queries.costSummary(WS);
    const byName = Object.fromEntries(cost.items.map((i) => [i.name, i]));
    expect(byName['Streamly']).toMatchObject({
      monthly: { native: usd('10.99'), base: bob('107.70') },
      annual: { native: usd('131.88'), base: bob('1292.42') },
      complete: true,
    });
    expect(byName['CloudDrive']).toMatchObject({
      monthly: { base: bob('81.66') },
      annual: { native: usd('99.99'), base: bob('979.90') },
    });
    expect(byName['VPN Pro']).toMatchObject({
      monthly: { native: { amount: '5.000000', currency: 'USDT' }, base: bob('48.50') },
      annual: { base: bob('582.00') },
    });
    expect(byName['Gimnasio Centro']).toMatchObject({
      monthly: { base: bob('250.00') },
      annual: { base: bob('3000.00') },
    });
    expect(cost.totals).toMatchObject({
      monthly: bob('487.86'),
      annual: bob('5854.33'),
      complete: true,
      unconverted: [],
    });
    expect(cost.baseCurrency).toBe('BOB');
    expect(cost.meta.ratesUsed.map((r) => `${r.rate.base}/${r.rate.quote}`).sort()).toEqual([
      'USD/BOB',
      'USDT/BOB',
    ]);
    expect(cost.meta.rateWindowDays).toBe(7);
  });

  it('[TC-COMMITMENTS-SUBS-025] cadencia semanal, trial aparte y pausadas fuera del total', async () => {
    const s = setup('2026-11-10');
    await owner(s, true);
    const weekly = await s.subs.create(
      cmd({
        counterpartyId: DIARIO,
        name: 'Diario Semanal',
        price: bob('20.00'),
        paymentAccountId: BANK,
        billingCycle: { cadence: 'WEEKLY' },
        firstRenewalOn: '2026-11-12',
      }),
    );
    const cost = await s.queries.costSummary(WS);
    const week = cost.items.find((i) => i.subscriptionId === weekly.id);
    expect(week).toMatchObject({ annual: { base: bob('1040.00') }, monthly: { base: bob('86.67') } });
    // 487.86 + 86.67 = 574.53
    expect(cost.totals.monthly).toEqual(bob('574.53'));
    expect(cost.items.some((i) => i.name === 'MusicBox')).toBe(false);
    expect(cost.afterTrial.items.map((i) => i.name)).toEqual(['PhotoLab']);
    expect(cost.afterTrial.items[0]?.monthly.base).toEqual(bob('48.90'));
    expect(cost.afterTrial.monthly).toEqual(bob('48.90'));
  });

  it('[TC-COMMITMENTS-SUBS-026] sin tasa para una moneda el total queda incompleto con la parte sin convertir', async () => {
    const s = setup('2026-11-10');
    await owner(s, false);
    s.mem.rateTable.delete('USDT/BOB');
    const cost = await s.queries.costSummary(WS);
    expect(cost.totals.monthly).toEqual(bob('439.36'));
    expect(cost.totals.complete).toBe(false);
    expect(cost.totals.unconverted).toEqual([
      {
        monthly: { amount: '5.000000', currency: 'USDT' },
        annual: { amount: '60.000000', currency: 'USDT' },
      },
    ]);
    const vpn = cost.items.find((i) => i.name === 'VPN Pro');
    expect(vpn).toMatchObject({ complete: false, monthly: { base: null } });
  });
});

describe('Recordatorios', () => {
  it('[TC-COMMITMENTS-SUBS-027] el recordatorio de renovación se publica una sola vez N días antes en La Paz', async () => {
    const s = setup('2026-11-01');
    const sub = await s.subs.create(cmd());
    const reminders = () => s.mem.eventsOf('commitments.SubscriptionRenewalUpcoming');
    // 23:30 del 11 en La Paz = 03:30Z del 12: faltan 4 días
    s.mem.setNow('2026-11-12T03:30:00Z');
    await s.daily.runWorkspace(WS);
    expect(reminders()).toHaveLength(0);
    // 00:05 del 12 (faltan 3)
    s.mem.setNow('2026-11-12T04:05:00Z');
    await s.daily.runWorkspace(WS);
    expect(reminders()).toHaveLength(1);
    expect(reminders()[0]?.payload).toMatchObject({
      subscriptionId: sub.id,
      providerName: 'Streamly',
      planName: 'Premium',
      renewalDate: '2026-11-15',
      daysBefore: 3,
      expectedPrice: usd('10.99'),
      expectedCharge: usd('10.99'),
      paymentAccountName: 'Visa USD',
      requiresApproval: true,
    });
    // evaluación repetida el 12 y el 13
    await s.daily.runWorkspace(WS);
    s.mem.setNow(noon('2026-11-12'));
    await s.daily.runWorkspace(WS);
    s.mem.setNow(noon('2026-11-13'));
    await s.daily.runWorkspace(WS);
    expect(reminders()).toHaveLength(1);
    // una renovación ya pasada no se recuerda
    s.mem.setNow(noon('2026-11-16'));
    await s.daily.runWorkspace(WS);
    expect(reminders()).toHaveLength(1);
  });

  it('[TC-COMMITMENTS-SUBS-027] una renovación en otra moneda indica el cargo estimado en la moneda de la cuenta', async () => {
    const s = setup('2026-11-01');
    await s.subs.create(cmd({ paymentAccountId: CARD }));
    s.mem.setNow(noon('2026-11-13'));
    await s.daily.runWorkspace(WS);
    expect(s.mem.eventsOf('commitments.SubscriptionRenewalUpcoming')[0]?.payload).toMatchObject({
      expectedPrice: usd('10.99'),
      expectedCharge: bob('107.70'),
    });
  });

  it('[TC-COMMITMENTS-SUBS-027] una suscripción creada dentro de la ventana se recuerda en la siguiente evaluación', async () => {
    const s = setup('2026-11-14');
    await s.subs.create(
      cmd({ counterpartyId: DIARIO, name: 'Diario Digital', firstRenewalOn: '2026-11-15' }),
    );
    await s.daily.runWorkspace(WS);
    expect(s.mem.eventsOf('commitments.SubscriptionRenewalUpcoming')).toHaveLength(1);
  });

  it('[TC-COMMITMENTS-SUBS-027] sin recordatorios activados o con otro N, el job respeta los ajustes', async () => {
    const s = setup('2026-11-01');
    const off = await s.subs.create(cmd({ reminder: { enabled: false } }));
    const wide = await s.subs.create(
      cmd({
        counterpartyId: MUSICBOX,
        name: 'MusicBox',
        firstRenewalOn: '2026-11-20',
        reminder: { daysBefore: 10 },
      }),
    );
    s.mem.setNow(noon('2026-11-12'));
    await s.daily.runWorkspace(WS);
    const events = s.mem.eventsOf('commitments.SubscriptionRenewalUpcoming');
    expect(events.map((e) => e.payload['subscriptionId'])).toEqual([wide.id]);
    expect(off.reminder).toEqual({ enabled: false, daysBefore: 3 });
  });

  it('[TC-COMMITMENTS-SUBS-027] si la fecha de renovación cambia, la nueva fecha puede recordarse otra vez', async () => {
    const s = setup('2026-11-01');
    const sub = await s.subs.create(cmd());
    s.mem.setNow(noon('2026-11-13'));
    await s.daily.runWorkspace(WS);
    await s.occs.skip({
      workspaceId: WS,
      userId: USER,
      occurrenceId: occurrenceOn(s, sub.definitionId, '2026-11-15')!.id,
    });
    await s.deliver();
    s.mem.setNow(noon('2026-12-13'));
    await s.engine.runWorkspace(WS);
    await s.daily.runWorkspace(WS);
    expect(
      s.mem.eventsOf('commitments.SubscriptionRenewalUpcoming').map((e) => e.payload['renewalDate']),
    ).toEqual(['2026-11-15', '2026-12-15']);
  });

  it('[TC-COMMITMENTS-SUBS-028] el recordatorio de fin de trial se publica una sola vez con el precio del primer cobro', async () => {
    const s = setup('2026-10-20');
    await s.subs.create(
      cmd({
        counterpartyId: CLOUDDRIVE,
        name: 'CloudDrive',
        price: usd('99.99'),
        billingCycle: { cadence: 'ANNUAL' },
        firstRenewalOn: '2026-11-20',
        trialEndsOn: '2026-11-20',
      }),
    );
    s.mem.setNow(noon('2026-11-17'));
    await s.daily.runWorkspace(WS);
    const events = () => s.mem.eventsOf('commitments.SubscriptionTrialEnding');
    expect(events()).toHaveLength(1);
    expect(events()[0]?.payload).toMatchObject({
      providerName: 'CloudDrive',
      trialEndsOn: '2026-11-20',
      daysBefore: 3,
      firstChargePrice: usd('99.99'),
      paymentAccountName: 'Visa USD',
    });
    s.mem.setNow(noon('2026-11-18'));
    await s.daily.runWorkspace(WS);
    expect(events()).toHaveLength(1);
    // un trial no recibe el recordatorio de renovación
    expect(s.mem.eventsOf('commitments.SubscriptionRenewalUpcoming')).toHaveLength(0);
  });
});

describe('Recorrido', () => {
  it('[TC-COMMITMENTS-SUBS-029] las transiciones de una suscripción con trial quedan en orden', async () => {
    const s = setup('2026-10-20');
    const sub = await s.subs.create(
      cmd({
        counterpartyId: CLOUDDRIVE,
        name: 'CloudDrive',
        price: usd('99.99'),
        billingCycle: { cadence: 'ANNUAL' },
        firstRenewalOn: '2026-11-20',
        trialEndsOn: '2026-11-20',
      }),
    );
    s.mem.setNow('2026-11-20T04:05:00Z');
    await s.daily.runWorkspace(WS);
    s.mem.setNow(noon('2027-01-03'));
    const current = await s.queries.get(WS, sub.id);
    await s.subs.pause({
      workspaceId: WS,
      userId: USER,
      subscriptionId: sub.id,
      expectedVersion: current.version,
    });
    const steps = s.mem
      .recordedFor(sub.id)
      .flatMap((r) => r.steps)
      .filter((st) => st.kind === 'TRANSITION')
      .map((st) => {
        const t = st as { transition: string; fromState: string | null; toState: string };
        return `${t.transition}:${t.fromState ?? '∅'}→${t.toState}`;
      });
    expect(steps).toEqual(['CREATE:∅→TRIAL', 'END_TRIAL:TRIAL→ACTIVE', 'PAUSE:ACTIVE→PAUSED']);
  });

  it('[TC-COMMITMENTS-SUBS-029] los cambios de precio y de plan son anotaciones, no transiciones', async () => {
    const s = setup('2026-10-20');
    const sub = await s.subs.create(cmd());
    const a = await s.subs.update({
      workspaceId: WS,
      userId: USER,
      subscriptionId: sub.id,
      expectedVersion: sub.version,
      planName: 'Estándar',
    });
    await s.subs.changePrice({
      workspaceId: WS,
      userId: USER,
      subscriptionId: sub.id,
      expectedVersion: a.version,
      price: usd('12.99'),
      effectiveFrom: '2027-03-15',
    });
    const kinds = s.mem.recordedFor(sub.id).flatMap((r) => r.steps.map((st) => st.kind));
    expect(kinds).toEqual(['TRANSITION', 'ANNOTATION', 'ANNOTATION']);
  });
});
