import { DomainError } from '@pf/shared-kernel';
import { describe, expect, it } from 'vitest';
import { CardActivityService } from './card-activity.handler.js';
import { CardDailyService } from './card-daily.runner.js';
import { CardsQueries } from './cards.queries.js';
import { CardsService, type RegisterCardCommand } from './cards.service.js';
import { InstallmentsService } from './installments.service.js';
import { CardWorld } from './testing/card-world.js';

const WS = 'ws-1';
const USER = 'user-1';
const rule = (floor: string) => ({ type: 'PERCENT', percent: '5.00', floor });

/** Estado de cuenta emitido del ciclo que cierra el 25-10. */
const october = (world: CardWorld) => world.statementStore.find((s) => s.closingDate === '2026-10-25');
const issuedEvents = (world: CardWorld) =>
  world.outbox.filter(
    (e) =>
      e.eventType === 'debt.CardStatementIssued' &&
      (e.payload as { closingDate?: string }).closingDate === '2026-10-25',
  );

const codeOf = async (fn: () => Promise<unknown>): Promise<string> => {
  try {
    await fn();
    return 'ok';
  } catch (err) {
    return err instanceof DomainError ? err.code : `other:${String(err)}`;
  }
};

function setup(now = '2026-10-20T14:00:00.000Z') {
  const world = new CardWorld(now);
  world.addAccount('acct-bob', 'Visa Oro BOB', 'CREDIT_CARD', 'BOB');
  world.addAccount('acct-usd', 'Visa Oro USD', 'CREDIT_CARD', 'USD');
  world.addAccount('bank', 'Banco BOB', 'BANK', 'BOB');
  const svc = new CardsService(world.deps);
  const queries = new CardsQueries(world.deps);
  const daily = new CardDailyService(world.deps);
  const activity = new CardActivityService(world.deps);
  const installments = new InstallmentsService(world.deps);
  return { world, svc, queries, daily, activity, installments };
}

const registerBob = (extra: Partial<RegisterCardCommand> = {}): RegisterCardCommand => ({
  workspaceId: WS,
  userId: USER,
  name: 'Visa Oro',
  accounts: [{ accountId: 'acct-bob', creditLimit: { amount: '10000.00' }, minimumRule: rule('50.00') }],
  statementDay: 25,
  dueDay: 15,
  ...extra,
});

/** Historia del ciclo de octubre de Visa Oro BOB (TC-DEBT-CARD-009). */
function octoberHistory(world: CardWorld) {
  world.addEntry({ accountId: 'acct-bob', date: '2026-09-01', cls: 'OTHER', amount: '1200.00' });
  world.addEntry({ accountId: 'acct-bob', date: '2026-10-03', cls: 'PURCHASE', amount: '350.00' });
  world.addEntry({ accountId: 'acct-bob', date: '2026-10-10', cls: 'PAYMENT', amount: '-1200.00' });
  world.addEntry({ accountId: 'acct-bob', date: '2026-10-18', cls: 'PURCHASE', amount: '820.50' });
  world.addEntry({ accountId: 'acct-bob', date: '2026-10-20', cls: 'REFUND', amount: '-50.00' });
}

describe('RegisterCreditCard (add-credit-cards)', () => {
  it('[TC-DEBT-CARD-001] registra Visa Oro sin crear asientos y audita en la misma unidad de trabajo', async () => {
    const { world, svc, queries } = setup();
    world.addEntry({ accountId: 'acct-bob', date: '2026-09-01', cls: 'OTHER', amount: '1200.00' });
    const { id } = await svc.register(registerBob());
    const card = await queries.get(WS, id);
    expect(card.status).toBe('ACTIVE');
    expect([card.statementDay, card.dueDay]).toEqual([25, 15]);
    expect(card.accounts[0]?.balance).toEqual({ amount: '1200.00', currency: 'BOB' });
    expect(world.entries).toHaveLength(1);
    expect(world.audit.map((a) => a.action)).toContain('debt.credit_card.created');
  });

  it('[TC-DEBT-CARD-002] cuenta bancaria ⇒ CREDIT_CARD_ACCOUNT_INVALID; cuenta ya vinculada ⇒ IN_USE; cierre 32 ⇒ VALIDATION_FAILED', async () => {
    const { svc, world } = setup();
    expect(
      await codeOf(() =>
        svc.register(
          registerBob({
            accounts: [{ accountId: 'bank', creditLimit: { amount: '1000.00' }, minimumRule: rule('1.00') }],
          }),
        ),
      ),
    ).toBe('CREDIT_CARD_ACCOUNT_INVALID');
    await svc.register(registerBob());
    expect(await codeOf(() => svc.register(registerBob({ name: 'Visa Oro 2' })))).toBe(
      'CREDIT_CARD_ACCOUNT_IN_USE',
    );
    world.addAccount('acct-other', 'Otra', 'CREDIT_CARD', 'BOB');
    expect(
      await codeOf(() =>
        svc.register(
          registerBob({
            name: 'Otra',
            statementDay: 32,
            accounts: [
              { accountId: 'acct-other', creditLimit: { amount: '100.00' }, minimumRule: rule('1.00') },
            ],
          }),
        ),
      ),
    ).toBe('VALIDATION_FAILED');
    expect(world.cardStore.size).toBe(1);
  });

  it('[TC-DEBT-CARD-003] la tarjeta bimoneda tiene un estado de cuenta por moneda, sin sumar monedas', async () => {
    const { world, svc, queries, daily } = setup('2026-09-20T14:00:00.000Z');
    world.addEntry({ accountId: 'acct-bob', date: '2026-10-05', cls: 'PURCHASE', amount: '100.00' });
    world.addEntry({ accountId: 'acct-usd', date: '2026-10-06', cls: 'PURCHASE', amount: '10.00' });
    const { id } = await svc.register({
      ...registerBob(),
      limitMode: 'SHARED',
      sharedLimit: { amount: '15000.00', currency: 'BOB' },
      accounts: [
        { accountId: 'acct-bob', minimumRule: rule('50.00') },
        { accountId: 'acct-usd', minimumRule: rule('10.00') },
      ],
    });
    world.setNow('2026-10-26T14:00:00.000Z');
    await daily.runWorkspace(WS);
    const statements = (await queries.listStatements(WS, id)).filter(
      (s) => s.id !== null && s.closingDate === '2026-10-25',
    );
    expect(statements.map((s) => [s.currency, s.closingDate, s.dueDate]).sort()).toEqual([
      ['BOB', '2026-10-25', '2026-11-15'],
      ['USD', '2026-10-25', '2026-11-15'],
    ]);
  });
});

describe('Emisión única y recálculo (decisión 5)', () => {
  it('[TC-DEBT-CARD-008] a las 23:30 de La Paz el ciclo sigue abierto; a las 00:05 está emitido; correr dos veces no duplica', async () => {
    const { world, svc, daily, queries } = setup('2026-09-20T14:00:00.000Z');
    octoberHistory(world);
    const { id } = await svc.register(registerBob());
    world.setNow('2026-10-26T03:30:00.000Z');
    await daily.runWorkspace(WS);
    expect(october(world)).toBeUndefined();
    // Una compra del 25-10 registrada a esa hora todavía pertenece al ciclo abierto.
    world.addEntry({ accountId: 'acct-bob', date: '2026-10-25', cls: 'PURCHASE', amount: '10.00' });
    world.setNow('2026-10-26T04:05:00.000Z');
    await daily.runWorkspace(WS);
    await daily.runWorkspace(WS);
    expect(world.statementStore.filter((s) => s.closingDate === '2026-10-25')).toHaveLength(1);
    expect(october(world)?.billedBalance).toBe('1130.50');
    expect(issuedEvents(world)).toHaveLength(1);
    const versions = world.outbox.map((e) => e.aggregateVersion);
    expect(new Set(versions).size).toBe(versions.length);
    void queries;
    void id;
  });

  it('[TC-DEBT-CARD-013] emite una vez con las cifras congeladas y muestra el recálculo con la diferencia de una compra retroactiva', async () => {
    const { world, svc, daily, queries } = setup('2026-09-20T14:00:00.000Z');
    octoberHistory(world);
    const { id } = await svc.register(registerBob());
    world.setNow('2026-10-26T14:00:00.000Z');
    await daily.runWorkspace(WS);
    await daily.runWorkspace(WS);
    const issued = october(world);
    expect(issued).toMatchObject({
      previousBalance: '1200.00',
      purchases: '1170.50',
      refunds: '50.00',
      payments: '1200.00',
      closingBalance: '1120.50',
      billedBalance: '1120.50',
      minimumDue: '56.02',
      dueDate: '2026-11-15',
    });
    expect(issuedEvents(world)).toHaveLength(1);
    // Compra retroactiva del 24-10 registrada el 28-10.
    world.setNow('2026-10-28T14:00:00.000Z');
    world.addEntry({ accountId: 'acct-bob', date: '2026-10-24', cls: 'PURCHASE', amount: '45.00' });
    const statement = (await queries.listStatements(WS, id)).find((s) => s.closingDate === '2026-10-25');
    expect(statement?.current.billedBalance.amount).toBe('1165.50');
    expect(statement?.current.minimumDue.amount).toBe('58.28');
    expect(statement?.issued?.billedBalance.amount).toBe('1120.50');
    expect(statement?.difference?.billedBalance.amount).toBe('45.00');
    await daily.runWorkspace(WS);
    expect(issuedEvents(world)).toHaveLength(1);
    expect(world.statementStore.filter((s) => s.closingDate === '2026-10-25')).toHaveLength(1);
  });

  it('[TC-DEBT-CARD-014] los montos del banco prevalecen, muestran la diferencia 4.80 y no crean asientos', async () => {
    const { world, svc, daily, queries } = setup('2026-09-20T14:00:00.000Z');
    octoberHistory(world);
    const { id } = await svc.register(registerBob());
    world.setNow('2026-10-26T14:00:00.000Z');
    await daily.runWorkspace(WS);
    const record = october(world)!;
    const entries = world.entries.length;
    await svc.recordReported({
      workspaceId: WS,
      userId: USER,
      cardId: id,
      statementId: record.id,
      expectedVersion: record.version,
      reportedBilledBalance: { amount: '1125.30', currency: 'BOB' },
      reportedMinimumDue: { amount: '56.30', currency: 'BOB' },
    });
    const statement = await queries.getStatement(WS, id, record.id);
    expect(statement.noInterestPayment.amount).toBe('1125.30');
    expect(statement.minimumDue.amount).toBe('56.30');
    expect(statement.remainingNoInterest.amount).toBe('1125.30');
    expect(statement.reportedDifference?.amount).toBe('4.80');
    expect(world.entries).toHaveLength(entries);
    expect(
      await codeOf(() =>
        svc.recordReported({
          workspaceId: WS,
          userId: USER,
          cardId: id,
          statementId: record.id,
          expectedVersion: 1,
          reportedBilledBalance: null,
        }),
      ),
    ).toBe('PRECONDITION_FAILED');
  });
});

describe('Estados, pagos y recordatorios', () => {
  it('[TC-DEBT-CARD-012] PAID, PARTIALLY_PAID y OVERDUE al vencer', async () => {
    const { world, svc, daily, queries } = setup('2026-09-20T14:00:00.000Z');
    octoberHistory(world);
    const { id } = await svc.register(registerBob());
    world.setNow('2026-10-26T14:00:00.000Z');
    await daily.runWorkspace(WS);
    const status = async () =>
      (await queries.listStatements(WS, id)).find((s) => s.closingDate === '2026-10-25');
    world.setNow('2026-11-16T14:00:00.000Z');
    world.addEntry({ accountId: 'acct-bob', date: '2026-11-01', cls: 'PAYMENT', amount: '-30.00' });
    expect((await status())?.status).toBe('OVERDUE');
    expect((await status())?.remainingMinimum.amount).toBe('26.02');
    world.addEntry({ accountId: 'acct-bob', date: '2026-11-01', cls: 'PAYMENT', amount: '-470.00' });
    expect((await status())?.status).toBe('PARTIALLY_PAID');
    expect((await status())?.remainingNoInterest.amount).toBe('620.50');
    world.addEntry({ accountId: 'acct-bob', date: '2026-11-10', cls: 'PAYMENT', amount: '-620.50' });
    expect((await status())?.status).toBe('PAID');
    await daily.runWorkspace(WS);
    expect(october(world)?.status).toBe('PAID');
  });

  it('[TC-DEBT-CARD-019] el recordatorio sale una sola vez, con lo que falta, y nunca para un estado pagado', async () => {
    const { world, svc, daily } = setup('2026-09-20T14:00:00.000Z');
    octoberHistory(world);
    await svc.register(registerBob());
    world.setNow('2026-10-26T14:00:00.000Z');
    await daily.runWorkspace(WS);
    world.setNow('2026-11-11T14:00:00.000Z');
    await daily.runWorkspace(WS);
    expect(world.outbox.filter((e) => e.eventType === 'debt.CardPaymentDue')).toHaveLength(0);
    world.setNow('2026-11-12T14:00:00.000Z');
    await daily.runWorkspace(WS);
    world.setNow('2026-11-13T14:00:00.000Z');
    await daily.runWorkspace(WS);
    const due = world.outbox.filter((e) => e.eventType === 'debt.CardPaymentDue');
    expect(due).toHaveLength(1);
    expect(due[0]?.payload).toMatchObject({
      closingDate: '2026-10-25',
      dueDate: '2026-11-15',
      daysBefore: 3,
      remainingNoInterest: { amount: '1120.50', currency: 'BOB' },
      remainingMinimum: { amount: '56.02', currency: 'BOB' },
    });
  });

  it('[TC-DEBT-CARD-019] un estado pagado antes de la ventana no se recuerda', async () => {
    const { world, svc, daily } = setup('2026-09-20T14:00:00.000Z');
    octoberHistory(world);
    await svc.register(registerBob());
    world.setNow('2026-10-26T14:00:00.000Z');
    await daily.runWorkspace(WS);
    world.addEntry({ accountId: 'acct-bob', date: '2026-11-10', cls: 'PAYMENT', amount: '-1120.50' });
    world.setNow('2026-11-12T14:00:00.000Z');
    await daily.runWorkspace(WS);
    expect(world.outbox.filter((e) => e.eventType === 'debt.CardPaymentDue')).toHaveLength(0);
  });
});

describe('Plan de pago administrado (decisión 7)', () => {
  const plan = (extra: { policy?: string } = {}) => ({ sourceAccountId: 'bank', ...extra });

  it('[TC-DEBT-CARD-017] estima antes del cierre, fija el monto exacto después y con MINIMUM fija el mínimo', async () => {
    const { world, svc, daily } = setup('2026-10-20T14:00:00.000Z');
    octoberHistory(world);
    const { id } = await svc.register(
      registerBob({
        accounts: [
          {
            accountId: 'acct-bob',
            creditLimit: { amount: '10000.00' },
            minimumRule: rule('50.00'),
            paymentPlan: plan(),
          },
        ],
      }),
    );
    const def = [...world.definitions.values()][0]!;
    expect(def.monthDays).toEqual([15]);
    expect(def.toAccountId).toBe('acct-bob');
    expect(world.occurrence(def.id, '2026-11-15').expected).toEqual({ type: 'ESTIMATED', amount: '1120.50' });
    world.setNow('2026-10-26T14:00:00.000Z');
    await daily.runWorkspace(WS);
    expect(world.occurrence(def.id, '2026-11-15').expected).toEqual({ type: 'FIXED', amount: '1120.50' });
    // Sin cambios no hay escrituras redundantes.
    const calls = world.calls.length;
    await daily.runWorkspace(WS);
    expect(world.calls.length).toBe(calls);
    // Política MINIMUM.
    await svc.enablePlan({
      workspaceId: WS,
      userId: USER,
      cardId: id,
      accountId: 'acct-bob',
      expectedVersion: world.cardStore.get(id)!.version,
      request: plan({ policy: 'MINIMUM' }),
    });
    expect(world.occurrence(def.id, '2026-11-15').expected).toEqual({ type: 'FIXED', amount: '56.02' });
  });

  it('[TC-DEBT-CARD-017] una ocurrencia cuyo estado no tiene nada que pagar se omite con motivo', async () => {
    const { world, svc, daily } = setup('2026-09-20T14:00:00.000Z');
    world.addEntry({ accountId: 'acct-bob', date: '2026-10-05', cls: 'PURCHASE', amount: '100.00' });
    world.addAccount('bank-usd', 'Banco USD', 'BANK', 'USD');
    await svc.register({
      ...registerBob(),
      accounts: [
        { accountId: 'acct-bob', minimumRule: rule('50.00'), paymentPlan: plan() },
        { accountId: 'acct-usd', minimumRule: rule('10.00'), paymentPlan: { sourceAccountId: 'bank-usd' } },
      ],
      limitMode: 'SHARED',
      sharedLimit: { amount: '15000.00', currency: 'BOB' },
    });
    world.setNow('2026-10-26T14:00:00.000Z');
    await daily.runWorkspace(WS);
    const usdDef = [...world.definitions.values()].find((d) => d.toAccountId === 'acct-usd')!;
    const occ = world.occurrence(usdDef.id, '2026-11-15');
    expect(occ.status).toBe('SKIPPED');
    expect(occ.skipReason).toBe('NOTHING_BILLED');
    const bobDef = [...world.definitions.values()].find((d) => d.toAccountId === 'acct-bob')!;
    expect(world.occurrence(bobDef.id, '2026-11-15').expected).toEqual({ type: 'FIXED', amount: '100.00' });
  });

  it('[TC-DEBT-CARD-018] con una transferencia recurrente activa hacia la tarjeta el plan se rechaza y la tarjeta se registra sin plan', async () => {
    const { world, svc } = setup();
    world.userTransfers.push({ definitionId: 'def-user', name: 'Pago Visa', accountId: 'acct-bob' });
    const result = await svc.register(
      registerBob({
        accounts: [
          {
            accountId: 'acct-bob',
            creditLimit: { amount: '10000.00' },
            minimumRule: rule('50.00'),
            paymentPlan: plan(),
          },
        ],
      }),
    );
    expect(result.conflicts).toEqual([
      { accountId: 'acct-bob', conflictingDefinitions: [{ definitionId: 'def-user', name: 'Pago Visa' }] },
    ]);
    expect(world.definitions.size).toBe(0);
    const card = world.cardStore.get(result.id)!;
    expect(
      await codeOf(() =>
        svc.enablePlan({
          workspaceId: WS,
          userId: USER,
          cardId: result.id,
          accountId: 'acct-bob',
          expectedVersion: card.version,
          request: plan(),
        }),
      ),
    ).toBe('CARD_PAYMENT_PLAN_CONFLICT');
    // Tras terminar la transferencia del usuario el plan se activa.
    world.userTransfers.length = 0;
    await svc.enablePlan({
      workspaceId: WS,
      userId: USER,
      cardId: result.id,
      accountId: 'acct-bob',
      expectedVersion: world.cardStore.get(result.id)!.version,
      request: plan(),
    });
    expect(world.definitions.size).toBe(1);
    expect([...world.definitions.values()][0]?.startDate).toBe('2026-11-15');
  });

  it('[TC-DEBT-CARD-026] cambiar el cierre revisa el plan de pago y conserva el vencimiento del estado emitido', async () => {
    const { world, svc, daily, queries } = setup('2026-09-20T14:00:00.000Z');
    octoberHistory(world);
    const { id } = await svc.register(
      registerBob({
        accounts: [
          {
            accountId: 'acct-bob',
            creditLimit: { amount: '10000.00' },
            minimumRule: rule('50.00'),
            paymentPlan: plan(),
          },
        ],
      }),
    );
    world.setNow('2026-10-26T14:00:00.000Z');
    await daily.runWorkspace(WS);
    world.setNow('2026-10-27T14:00:00.000Z');
    await svc.update({
      workspaceId: WS,
      userId: USER,
      cardId: id,
      expectedVersion: world.cardStore.get(id)!.version,
      edit: { statementDay: 20, dueDay: 10 },
    });
    const revise = world.calls.find((c) => c.method === 'revise');
    expect(revise?.input).toMatchObject({ monthDays: [10] });
    const statements = await queries.listStatements(WS, id);
    expect(statements.find((s) => s.closingDate === '2026-10-25')?.dueDate).toBe('2026-11-15');
    const open = statements.find((s) => s.status === 'OPEN');
    expect([open?.cycleStart, open?.closingDate, open?.dueDate]).toEqual([
      '2026-10-26',
      '2026-11-20',
      '2026-12-10',
    ]);
  });

  it('[TC-DEBT-CARD-027] archivar termina el plan, conserva los estados y libera la cuenta', async () => {
    const { world, svc, daily, queries } = setup('2026-09-20T14:00:00.000Z');
    octoberHistory(world);
    const { id } = await svc.register(
      registerBob({
        accounts: [
          {
            accountId: 'acct-bob',
            creditLimit: { amount: '10000.00' },
            minimumRule: rule('50.00'),
            paymentPlan: plan(),
          },
        ],
      }),
    );
    world.setNow('2026-10-26T14:00:00.000Z');
    await daily.runWorkspace(WS);
    await svc.archive({
      workspaceId: WS,
      userId: USER,
      cardId: id,
      expectedVersion: world.cardStore.get(id)!.version,
    });
    expect([...world.definitions.values()][0]?.ended).toBe(true);
    const card = await queries.get(WS, id);
    expect(card.status).toBe('ARCHIVED');
    expect(card.accounts[0]?.paymentPlan).toBeNull();
    expect((await queries.listStatements(WS, id)).some((s) => s.id !== null)).toBe(true);
    // La cuenta puede vincularse a otra tarjeta.
    await expect(svc.register(registerBob({ name: 'Visa Plata' }))).resolves.toBeDefined();
  });
});

describe('Utilización y alertas (decisiones 10 y 11)', () => {
  const sharedCard = (): RegisterCardCommand => ({
    ...registerBob(),
    limitMode: 'SHARED',
    sharedLimit: { amount: '15000.00', currency: 'BOB' },
    accounts: [
      { accountId: 'acct-bob', minimumRule: rule('50.00') },
      { accountId: 'acct-usd', minimumRule: rule('10.00') },
    ],
  });
  const posted = (accountId: string) => ({
    workspaceId: WS,
    eventType: 'ledger.JournalEntryPosted',
    eventId: `e-${Math.random()}`,
    payload: { postings: [{ accountId }] },
  });

  it('[TC-DEBT-CARD-020] límite compartido: usado 4580.00 BOB, 30.53 % y disponible 10420.00 BOB', async () => {
    const { world, svc, queries } = setup();
    world.rates.set('USD/BOB', '9.80');
    world.addEntry({ accountId: 'acct-bob', date: '2026-10-01', cls: 'PURCHASE', amount: '3600.00' });
    world.addEntry({ accountId: 'acct-usd', date: '2026-10-01', cls: 'PURCHASE', amount: '100.00' });
    const { id } = await svc.register(sharedCard());
    const u = (await queries.get(WS, id)).utilization[0];
    expect(u).toMatchObject({
      scope: 'SHARED',
      used: { amount: '4580.00', currency: 'BOB' },
      available: { amount: '10420.00', currency: 'BOB' },
      utilization: '30.53',
    });
  });

  it('[TC-DEBT-CARD-020] sin tasa USD/BOB la utilización compartida no se calcula (nunca 1:1) y no hay disponible', async () => {
    const { world, svc, queries } = setup();
    world.addEntry({ accountId: 'acct-usd', date: '2026-10-01', cls: 'PURCHASE', amount: '100.00' });
    const { id } = await svc.register(sharedCard());
    const u = (await queries.get(WS, id)).utilization[0];
    expect(u?.utilization).toBeNull();
    expect(u?.available).toBeNull();
    expect(u?.missingRates).toEqual(['USD']);
  });

  it('[TC-DEBT-CARD-020] separado: la compra pendiente usa crédito (1195.50 BOB, 11.96 %, disponible 8804.50 BOB)', async () => {
    const { world, svc, queries } = setup();
    world.addEntry({ accountId: 'acct-bob', date: '2026-10-01', cls: 'PURCHASE', amount: '1120.50' });
    world.pending.push({
      transactionId: 'tx-p',
      kind: 'EXPENSE',
      businessDate: '2026-10-19',
      accountId: 'acct-bob',
      toAccountId: null,
      direction: 'OUT',
      amount: { amount: '75.00', currency: 'BOB' },
      description: null,
      source: 'MANUAL',
      externalRef: null,
    });
    const { id } = await svc.register(registerBob());
    const u = (await queries.get(WS, id)).utilization[0];
    expect(u).toMatchObject({
      used: { amount: '1195.50' },
      available: { amount: '8804.50' },
      utilization: '11.96',
    });
  });

  it('[TC-DEBT-CARD-021] un hecho por cruce, sin repetir arriba y de nuevo tras bajar del umbral', async () => {
    const { world, svc, activity } = setup();
    world.rates.set('USD/BOB', '9.80');
    world.addEntry({ accountId: 'acct-bob', date: '2026-10-01', cls: 'PURCHASE', amount: '2999.50' });
    world.addEntry({ accountId: 'acct-usd', date: '2026-10-01', cls: 'PURCHASE', amount: '100.00' });
    await svc.register(sharedCard());
    const reached = () =>
      world.outbox.filter((e) => e.eventType === 'debt.CreditUtilizationThresholdReached');
    // 26.53 % + compra de 600.00 ⇒ 30.53 %.
    world.addEntry({ accountId: 'acct-bob', date: '2026-10-20', cls: 'PURCHASE', amount: '600.00' });
    await activity.onEvent(posted('acct-bob'));
    expect(reached()).toHaveLength(1);
    expect(reached()[0]?.payload).toMatchObject({
      threshold: '30.00',
      alsoCrossed: [],
      scope: 'SHARED',
      crossingNo: 1,
    });
    // Sigue arriba: 31.20 %.
    world.addEntry({ accountId: 'acct-bob', date: '2026-10-20', cls: 'PURCHASE', amount: '100.00' });
    await activity.onEvent(posted('acct-bob'));
    expect(reached()).toHaveLength(1);
    // Un pago la baja a ~12 % y luego las compras la suben a 30.10 %.
    world.addEntry({ accountId: 'acct-bob', date: '2026-10-20', cls: 'PAYMENT', amount: '-2800.00' });
    await activity.onEvent(posted('acct-bob'));
    world.addEntry({ accountId: 'acct-bob', date: '2026-10-20', cls: 'PURCHASE', amount: '2735.00' });
    await activity.onEvent(posted('acct-bob'));
    expect(reached()).toHaveLength(2);
    expect(reached()[1]?.payload).toMatchObject({ threshold: '30.00', crossingNo: 2 });
  });

  it('[TC-DEBT-CARD-021] dos umbrales en un solo cambio: un único hecho con 80.00 y también cruzado el 30.00', async () => {
    const { world, svc, activity } = setup();
    world.addEntry({ accountId: 'acct-usd', date: '2026-10-01', cls: 'PURCHASE', amount: '200.00' });
    await svc.register({
      ...registerBob({ name: 'Visa USD' }),
      accounts: [{ accountId: 'acct-usd', creditLimit: { amount: '1000.00' }, minimumRule: rule('10.00') }],
    });
    world.addEntry({ accountId: 'acct-usd', date: '2026-10-20', cls: 'PURCHASE', amount: '650.00' });
    await activity.onEvent({
      workspaceId: WS,
      eventType: 'ledger.JournalEntryPosted',
      eventId: 'e-1',
      payload: { postings: [{ accountId: 'acct-usd' }] },
    });
    const events = world.outbox.filter((e) => e.eventType === 'debt.CreditUtilizationThresholdReached');
    expect(events).toHaveLength(1);
    expect(events[0]?.payload).toMatchObject({
      threshold: '80.00',
      alsoCrossed: ['30.00'],
      utilization: '85.00',
      scope: 'ACCOUNT',
    });
  });
});

describe('Cuotas (decisión 13)', () => {
  const laptop = (world: CardWorld) => {
    world.transactions.set('tx-laptop', {
      transactionId: 'tx-laptop',
      kind: 'EXPENSE',
      status: 'POSTED',
      businessDate: '2026-10-05',
      amount: { amount: '1000.00', currency: 'BOB' },
      accountId: 'acct-bob',
      toAccountId: null,
      counterpartyId: null,
      source: 'MANUAL',
      externalRef: null,
    });
    world.addEntry({
      accountId: 'acct-bob',
      date: '2026-10-05',
      cls: 'PURCHASE',
      amount: '1000.00',
      transactionId: 'tx-laptop',
    });
  };

  it('[TC-DEBT-CARD-022] 3 cuotas sin interés; un gasto de otra cuenta se rechaza con INSTALLMENT_PLAN_INVALID', async () => {
    const { world, svc, installments, queries } = setup();
    laptop(world);
    world.transactions.set('tx-bank', {
      ...world.transactions.get('tx-laptop')!,
      transactionId: 'tx-bank',
      accountId: 'bank',
    });
    const { id } = await svc.register(registerBob());
    const plan = await installments.create({
      workspaceId: WS,
      userId: USER,
      cardId: id,
      purchaseTransactionId: 'tx-laptop',
      installmentCount: 3,
    });
    expect(plan.installments.map((i) => [i.total.amount, i.billingClosingDate])).toEqual([
      ['333.33', '2026-10-25'],
      ['333.33', '2026-11-25'],
      ['333.34', '2026-12-25'],
    ]);
    expect(
      await codeOf(() =>
        installments.create({
          workspaceId: WS,
          userId: USER,
          cardId: id,
          purchaseTransactionId: 'tx-bank',
          installmentCount: 3,
        }),
      ),
    ).toBe('INSTALLMENT_PLAN_INVALID');
    expect(
      await codeOf(() =>
        installments.create({
          workspaceId: WS,
          userId: USER,
          cardId: id,
          purchaseTransactionId: 'tx-laptop',
          installmentCount: 3,
        }),
      ),
    ).toBe('INSTALLMENT_PLAN_INVALID');
    expect(world.entries).toHaveLength(1);
    void queries;
  });

  it('[TC-DEBT-CARD-024] el saldo facturado descuenta las cuotas futuras y el calendario lista los cargos', async () => {
    const { world, svc, installments, queries } = setup();
    laptop(world);
    const { id } = await svc.register(registerBob());
    await installments.create({
      workspaceId: WS,
      userId: USER,
      cardId: id,
      purchaseTransactionId: 'tx-laptop',
      installmentCount: 3,
    });
    const card = await queries.get(WS, id);
    const open = card.accounts[0]!.openCycle;
    expect(open.current.closingBalance.amount).toBe('1000.00');
    expect(open.current.billedBalance.amount).toBe('333.33');
    expect(open.current.minimumDue.amount).toBe('50.00');
    expect(card.utilization[0]?.utilization).toBe('10.00');
    const charges = await queries.getFutureCharges(WS, id, 6);
    expect(charges.map((c) => [c.dueDate, c.total.amount])).toEqual([
      ['2026-11-15', '333.33'],
      ['2026-12-15', '333.33'],
      ['2027-01-15', '333.34'],
    ]);
  });

  it('[TC-DEBT-CARD-025] anular la compra cancela el plan y las cuotas dejan el calendario; el emitido conserva sus cifras', async () => {
    const { world, svc, installments, queries, daily, activity } = setup('2026-10-20T14:00:00.000Z');
    laptop(world);
    const { id } = await svc.register(registerBob());
    await installments.create({
      workspaceId: WS,
      userId: USER,
      cardId: id,
      purchaseTransactionId: 'tx-laptop',
      installmentCount: 3,
    });
    world.setNow('2026-10-26T14:00:00.000Z');
    await daily.runWorkspace(WS);
    expect(october(world)?.unbilledInstallments).toBe('666.67');
    world.setNow('2026-11-02T14:00:00.000Z');
    await activity.onEvent({
      workspaceId: WS,
      eventType: 'transactions.TransactionVoided',
      eventId: 'e-void',
      payload: { transactionId: 'tx-laptop', legs: [{ accountId: 'acct-bob' }] },
    });
    const plans = await queries.listInstallmentPlans(WS, id);
    expect(plans[0]).toMatchObject({ status: 'CANCELLED', cancelReason: 'PURCHASE_VOIDED' });
    expect(await queries.getFutureCharges(WS, id, 6)).toEqual([]);
    expect(october(world)?.unbilledInstallments).toBe('666.67');
  });
});
