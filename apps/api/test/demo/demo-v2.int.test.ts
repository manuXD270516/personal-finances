import 'reflect-metadata';
import { fileURLToPath } from 'node:url';
import { dec } from '@pf/shared-kernel';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import golden from '../../src/demo/dataset/golden-summary.json' with { type: 'json' };
import { structuralOf, summarizeModules } from '../../src/demo/dataset/module-summary.js';
import { connect } from '../support/db.js';
import { rowsByTable, unbalancedEntries } from '../support/demo-db.js';
import { demoQueryRuntimes } from '../support/demo-runtimes.js';
import { DemoWorld, eventually, type DemoLoad } from '../support/demo-world.js';

// Dataset Demo v2 de extremo a extremo (openspec add-phase-4-demo-data, TC-IDENTITY-DEMO-007 y 015..020): la carga
// en proceso con la ancla fija 2026-09-30, el worker real (consumidores asíncronos del outbox) y las consultas
// públicas de COMMITMENTS, DEBT, GOALS y REPORTING con el reloj fijado en el día de la ancla.
const deps = inject('deps');
const FIXED = '2026-09-30';
const SECOND = '2026-10-05';
/** Catálogo de referencia FICTICIO del repositorio, para probar que la demo no adopta entradas del catálogo. */
const CATALOG_DIR = fileURLToPath(new URL('../../reference/institutions/demo', import.meta.url));

const world = new DemoWorld();
let migrator: Client;
let main: DemoLoad;
let q: ReturnType<typeof demoQueryRuntimes>;
let ws: string;
let userId: string;

const read = <T>(fn: () => Promise<T>) => q.inWs(userId, ws, fn);
const subscriptionsByName = async () =>
  new Map(
    (
      await read(() =>
        q.r.commitments.subscriptionQueries.list(ws, {
          statuses: ['ACTIVE', 'TRIAL', 'PAUSED', 'CANCELLED'],
        } as never),
      )
    ).map((s) => [s.name, s]),
  );
const goalsByName = async () =>
  new Map((await read(() => q.r.goals.queries.list(ws, {} as never))).data.map((g) => [g.name, g]));
/** Filas por tabla de negocio (sin las de plataforma: el inbox y el outbox crecen con los consumidores asíncronos). */
const businessRows = async () =>
  Object.fromEntries(
    Object.entries(await rowsByTable(migrator, ws)).filter(([table]) => !table.startsWith('platform.')),
  );
const loansByName = async () =>
  new Map(
    await Promise.all(
      (await read(() => q.r.debt.queries.list(ws, {}))).map(
        async (l) => [l.name, await read(() => q.r.debt.queries.get(ws, l.id))] as const,
      ),
    ),
  );

beforeAll(async () => {
  migrator = await connect(deps.migratorUrl);
  await world.start();
  main = await world.load({ anchor: FIXED });
  expect(main.outcome, main.failure ?? '').toBe('READY');
  ws = main.job.demoWorkspaceId;
  userId = main.user.id;
  q = demoQueryRuntimes({ databaseUrl: deps.databaseUrl, today: FIXED });
  await world.waitPublished(ws);
  // Los consumidores asíncronos convergen después de READY: cargos de suscripciones, aporte recurrente de la meta
  // "Fondo de emergencia" y las demás reacciones del outbox.
  await eventually(
    async () => {
      const emergency = (await goalsByName()).get('Fondo de emergencia');
      const cloud = (await subscriptionsByName()).get('NubeSegura Demo');
      const detail = cloud ? await read(() => q.r.commitments.subscriptionQueries.get(ws, cloud.id)) : null;
      return emergency?.progress.total.amount === '18000.00' && detail?.pendingProposal ? true : undefined;
    },
    { what: 'los aportes del fondo de emergencia y la propuesta de precio de NubeSegura' },
  );
}, 900_000);

afterAll(async () => {
  await q?.close();
  // Limpia y purga los workspaces demo de la prueba: la instalación compartida queda como estaba.
  await world.cleanupAll();
  await world.stop();
  await migrator?.end();
});

describe('dataset Demo v2: carga y determinismo', () => {
  it('[TC-IDENTITY-DEMO-007] la carga v2 coincide con el resumen de referencia y los asientos suman 0.00', async () => {
    const accounts = await read(() => q.r.accounts.accounts.listAccounts({ workspaceId: ws }));
    const balances = Object.fromEntries(accounts.data.map((a) => [a.account.name, a.balance.amount]));
    expect(balances).toEqual({
      'Banco Andino Demo — Cuenta corriente': golden.balances.bank_bob,
      'Banco Andino Demo — Ahorro USD': golden.balances.bank_usd,
      Efectivo: golden.balances.cash,
      'P2P Exchange Demo — Billetera USDT': golden.balances.usdt,
      'Cold Wallet BTC': golden.balances.btc,
      'Tarjeta Andina Demo': golden.balances.card,
      'Banco Andino Demo — Caja de ahorro BOB': golden.balances.savings_bob,
      'Tarjeta Kantuta Demo BOB': golden.balances.kantuta_bob,
      'Tarjeta Kantuta Demo USD': golden.balances.kantuta_usd,
      'Billetera Altiplano Demo': golden.balances.wallet,
      'Préstamo vehicular': golden.balances.loan_vehicular,
      'Préstamo de consumo': golden.balances.loan_consumo,
      'Préstamo familiar': golden.balances.loan_familiar,
      'Crédito educativo': golden.balances.loan_educativo,
    });
    expect(accounts.data.every((a) => a.account.notes?.startsWith('DEMO-'))).toBe(true);
    expect(await unbalancedEntries(migrator, ws)).toEqual([]);
    // El resumen estructural por módulo del plan es el de la ancla fija.
    expect(summarizeModules(FIXED)).toEqual(golden.modules);
  });

  it('[TC-IDENTITY-DEMO-007] dos cargas con la misma ancla dan los mismos saldos y los mismos estados por módulo', async () => {
    const second = await world.load({ anchor: FIXED });
    expect(second.outcome, second.failure ?? '').toBe('READY');
    const other = second.job.demoWorkspaceId;
    const balances = async (workspace: string, user: string) =>
      Object.fromEntries(
        (
          await q.inWs(user, workspace, () => q.r.accounts.accounts.listAccounts({ workspaceId: workspace }))
        ).data
          .map((a) => [a.account.name, a.balance.amount])
          .sort(),
      );
    expect(await balances(other, second.user.id)).toEqual(await balances(ws, userId));
    expect(await unbalancedEntries(migrator, other)).toEqual([]);
  }, 600_000);

  it('[TC-IDENTITY-DEMO-007] tiempo de carga de la demo v2 bajo 2 minutos (D41)', () => {
    console.info(`demo.duration_ms (carga v2, ancla ${FIXED}): ${String(main.durationMs)}`);
    expect(main.durationMs).not.toBeNull();
    expect(main.durationMs!).toBeLessThan(120_000);
  });

  it('el canal email de todos los tipos queda apagado y el in-app activo para el usuario de la demo', async () => {
    const prefs = await read(() => q.r.notifications.preferences.get(ws, userId));
    expect(prefs.types.length).toBeGreaterThan(0);
    expect(prefs.types.every((t) => t.email === false && t.inApp === true)).toBe(true);
  });
});

describe('suscripciones y compromisos recurrentes (TC-IDENTITY-DEMO-015)', () => {
  it('[TC-IDENTITY-DEMO-015] 8 suscripciones en varios estados con costo 412.94 BOB al mes y 4955.25 al año', async () => {
    const subs = await subscriptionsByName();
    expect(subs.size).toBe(8);
    const state = (name: string) => [
      subs.get(name)?.status,
      subs.get(name)?.currentPrice.amount,
      subs.get(name)?.currentPrice.currency,
    ];
    expect(state('StreamFlix Demo')).toEqual(['ACTIVE', '11.99', 'USD']);
    expect(state('NubeSegura Demo')).toEqual(['ACTIVE', '2.99', 'USD']);
    expect(state('Antivirus Escudo Demo')).toEqual(['ACTIVE', '39.99', 'USD']);
    expect(state('VPN Cóndor Demo')).toEqual(['ACTIVE', '5.000000', 'USDT']);
    expect(state('Gimnasio Sajama Demo')).toEqual(['ACTIVE', '250.00', 'BOB']);
    expect(state('Curso Kantuta Demo')[0]).toBe('TRIAL');
    expect(state('MúsicaYa Demo')[0]).toBe('PAUSED');
    expect(state('Revista Andina Demo')[0]).toBe('CANCELLED');
    const cost = await read(() => q.r.commitments.subscriptionQueries.costSummary(ws));
    expect(cost.totals.monthly.amount).toBe('412.94');
    expect(cost.totals.annual.amount).toBe('4955.25');
    expect(cost.afterTrial.monthly.amount).toBe('105.00');
    const monthlyByName = Object.fromEntries(cost.items.map((i) => [i.name, i.monthly.base?.amount]));
    expect(monthlyByName).toMatchObject({
      'StreamFlix Demo': '83.93',
      'NubeSegura Demo': '20.93',
      'VPN Cóndor Demo': '34.75',
      'Gimnasio Sajama Demo': '250.00',
    });
  });

  it('[TC-IDENTITY-DEMO-015] historial de precios de StreamFlix y propuesta de precio pendiente de NubeSegura', async () => {
    const subs = await subscriptionsByName();
    const stream = await read(() =>
      q.r.commitments.subscriptionQueries.get(ws, subs.get('StreamFlix Demo')!.id),
    );
    const history = [...(stream.priceHistory ?? [])]
      .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))
      .map((p) => [p.price.amount, p.effectiveFrom]);
    expect(history.at(-1)).toEqual(['11.99', '2025-10-03']);
    expect(history.at(-2)?.[0]).toBe('9.99');
    const cloud = await read(() =>
      q.r.commitments.subscriptionQueries.get(ws, subs.get('NubeSegura Demo')!.id),
    );
    expect(cloud.currentPrice.amount).toBe('2.99');
    expect(cloud.pendingProposal).toMatchObject({
      proposedPrice: { amount: '3.49', currency: 'USD' },
      status: 'PENDING',
    });
  });

  it('[TC-IDENTITY-DEMO-015] la ocurrencia de internet de 199.00 BOB del 2026-09-28 está por aprobar y atrasada; no hay otras sin resolver antes', async () => {
    const overdue = await read(() =>
      q.r.commitments.queries.listOccurrences(ws, { statuses: ['OVERDUE'], limit: 100 }),
    );
    const internet = overdue.filter((o) => o.definitionName === 'Internet Fibra Kantuta Demo');
    expect(internet).toHaveLength(1);
    expect(internet[0]).toMatchObject({
      occurrenceDate: '2026-09-28',
      requiresApproval: true,
      status: 'OVERDUE',
    });
    expect(internet[0]?.projectedAmount).toEqual({ amount: '199.00', currency: 'BOB' });
    // Las definiciones del usuario no tienen otras ocurrencias sin resolver anteriores a esa fecha.
    const unresolvedUser = await read(() =>
      q.r.commitments.queries.listOccurrences(ws, {
        statuses: ['SCHEDULED', 'DUE', 'OVERDUE'],
        to: '2026-09-27',
        limit: 200,
      }),
    );
    expect(unresolvedUser.filter((o) => o.managedBy === 'USER')).toEqual([]);
    const definitions = await read(() =>
      q.r.commitments.queries.listDefinitions(ws, { limit: 100 } as never),
    );
    expect(
      definitions
        .filter((d) => d.managedBy === 'USER')
        .map((d) => d.name)
        .sort(),
    ).toEqual([
      'Alquiler',
      'Internet Fibra Kantuta Demo',
      'Luz Altiplano Demo',
      'Retiro de efectivo',
      'Seguro vehicular Seguros Illampu Demo',
      'Sueldo',
    ]);
  });
});

describe('tarjetas de crédito (TC-IDENTITY-DEMO-016)', () => {
  it('[TC-IDENTITY-DEMO-016] estados de cuenta de "Tarjeta Kantuta Demo": parcial, vencido y emitido; cargos futuros de las cuotas', async () => {
    const cards = await read(() => q.r.cards.queries.list(ws, {} as never));
    const kantuta = cards.find((c) => c.name === 'Tarjeta Kantuta Demo')!;
    const statements = await read(() => q.r.cards.queries.listStatements(ws, kantuta.id));
    const at = (currency: string, closing: string) =>
      statements.find((s) => s.currency === currency && s.closingDate === closing)!;
    const bobAug = at('BOB', '2026-08-18');
    expect(bobAug.status).toBe('PARTIALLY_PAID');
    expect(bobAug.issued?.closingBalance.amount).toBe('5120.50');
    expect(bobAug.issued?.billedBalance.amount).toBe('1120.50');
    expect(bobAug.minimumDue.amount).toBe('56.02');
    expect(bobAug.remainingNoInterest.amount).toBe('620.50');
    const usdAug = at('USD', '2026-08-18');
    expect(usdAug.status).toBe('OVERDUE');
    expect(usdAug.issued?.billedBalance.amount).toBe('200.00');
    expect(usdAug.minimumDue.amount).toBe('10.00');
    expect(usdAug.remainingMinimum.amount).toBe('10.00');
    const bobSep = at('BOB', '2026-09-18');
    expect(bobSep.status).toBe('ISSUED');
    expect(bobSep.dueDate).toBe('2026-10-08');
    expect(bobSep.issued).toMatchObject({
      previousBalance: { amount: '5120.50' },
      purchases: { amount: '150.00' },
      payments: { amount: '500.00' },
      closingBalance: { amount: '4770.50' },
      billedBalance: { amount: '1570.50' },
    });
    expect(bobSep.minimumDue.amount).toBe('78.52');
    expect(at('USD', '2026-09-18').status).toBe('ISSUED');
    const future = await read(() => q.r.cards.queries.getFutureCharges(ws, kantuta.id, 8));
    expect(future.map((c) => [c.dueDate, c.total.amount])).toEqual([
      ['2026-11-08', '800.00'],
      ['2026-12-08', '800.00'],
      ['2027-01-08', '800.00'],
      ['2027-02-08', '800.00'],
    ]);
    const plans = await read(() => q.r.cards.queries.listInstallmentPlans(ws, kantuta.id));
    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({ installmentCount: 6, principal: { amount: '4800.00' } });
  });

  it('[TC-IDENTITY-DEMO-016] "Tarjeta Andina Demo": último estado emitido con su pago administrado por el total facturado', async () => {
    const cards = await read(() => q.r.cards.queries.list(ws, {} as never));
    const andina = cards.find((c) => c.name === 'Tarjeta Andina Demo')!;
    const account = andina.accounts[0]!;
    expect(account.lastStatement).toMatchObject({
      closingDate: '2026-09-25',
      dueDate: '2026-10-15',
      status: 'ISSUED',
    });
    const billed = account.lastStatement!.issued!.billedBalance.amount;
    expect(billed).toBe(golden.modules.cards.andina.last.billed);
    expect(account.paymentPlan).not.toBeNull();
    const occurrences = await read(() =>
      q.r.commitments.queries.listOccurrences(ws, {
        definitionId: account.paymentPlan!.definitionId,
        from: '2026-10-01',
        to: '2026-10-31',
        limit: 10,
      }),
    );
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0]).toMatchObject({ occurrenceDate: '2026-10-15' });
    expect(occurrences[0]?.projectedAmount?.amount).toBe(billed);
  });
});

describe('metas de ahorro (TC-IDENTITY-DEMO-017)', () => {
  it('[TC-IDENTITY-DEMO-017] Fondo de emergencia: 12 aportes de 1500.00 BOB, 60.00 % y en curso (+0.05 %)', async () => {
    const goal = (await goalsByName()).get('Fondo de emergencia')!;
    expect(goal.progress.total.amount).toBe('18000.00');
    expect(goal.progress.percent).toBe('60.00');
    expect(goal.tracking).toMatchObject({
      status: 'ON_TRACK',
      expected: { amount: '17990.12' },
      deviationPercent: '0.05',
    });
    const movements = await read(() => q.r.goals.queries.movements(ws, goal.id, { limit: 50 } as never));
    const rows = movements.data;
    expect(rows).toHaveLength(12);
    expect(rows.every((m) => m.amount.amount === '1500.00' && m.fund === 'REAL')).toBe(true);
    expect(goal.plan).toMatchObject({ monthlyAmount: { amount: '1500.00' }, automation: 'RECURRING' });
    // Los aportes recurrentes no dejan sugerencias de aporte pendientes (ya están respaldados por la meta).
    expect((await read(() => q.r.goals.queries.suggestions(ws))).pendingCount).toBe(0);
  });

  it('[TC-IDENTITY-DEMO-017] Viaje en riesgo, Laptop alcanzada y Regalos con una sola sobre-asignación resuelta', async () => {
    const goals = await goalsByName();
    const travel = goals.get('Viaje')!;
    expect(travel.progress.total).toEqual({ amount: '550.00', currency: 'USD' });
    expect(travel.tracking).toMatchObject({
      status: 'BEHIND',
      expected: { amount: '1328.47' },
      deviationPercent: '-58.60',
    });
    expect(goals.get('Laptop')?.status).toBe('ACHIEVED');
    const gifts = goals.get('Regalos')!;
    expect(gifts.progress.total.amount).toBe('500.00');
    expect(gifts.overAllocated).toBe(false);
    const { rows } = await world.workerPool.query<{ shortfall: string }>(
      `SELECT envelope->'payload'->'shortfall'->>'amount' AS shortfall FROM platform.outbox
        WHERE workspace_id = $1 AND event_type = 'goals.EarmarkExceedsBalance'`,
      [ws],
    );
    expect(rows).toEqual([{ shortfall: '200.00' }]);
    const accounts = await read(() => q.r.accounts.accounts.listAccounts({ workspaceId: ws }));
    expect(accounts.data.find((a) => a.account.name === 'Billetera Altiplano Demo')?.balance.amount).toBe(
      '700.00',
    );
  });
});

describe('préstamos (TC-IDENTITY-DEMO-018)', () => {
  it('[TC-IDENTITY-DEMO-018] vehicular francés: cuota 1589.99, cuota 1 con 375.00 de interés y 1214.99 de principal, principal pendiente 25288.74', async () => {
    const loan = (await loansByName()).get('Préstamo vehicular')!;
    expect(loan).toMatchObject({
      status: 'ACTIVE',
      method: 'FRENCH',
      principal: { amount: '50000.00' },
      annualRate: '0.09',
      termInstallments: 36,
      outstandingPrincipal: { amount: '25288.74' },
      accountBalance: { amount: '25288.74' },
      overdueInstallments: [],
    });
    expect(loan.nextInstallment).toMatchObject({ n: 20, dueDate: '2026-10-01' });
    const installments = await read(() => q.r.debt.queries.installments(ws, loan.id));
    const rows = installments.installments;
    expect(rows[0]).toMatchObject({ n: 1, interest: '375.00', principal: '1214.99', total: '1589.99' });
    expect(rows.filter((r) => r.status === 'PAID')).toHaveLength(19);
    expect(rows[19]).toMatchObject({ n: 20, interest: '189.67', principal: '1400.32' });
  });

  it('[TC-IDENTITY-DEMO-018] consumo alemán con dos cuotas en mora, familiar saldado y crédito educativo con la versión 2', async () => {
    const loans = await loansByName();
    const consumo = loans.get('Préstamo de consumo')!;
    expect(consumo.outstandingPrincipal?.amount).toBe('8000.00');
    expect(
      consumo.overdueInstallments.map((o) => [o.n, o.dueDate, dec(o.outstanding.amount).toFixed(2)]),
    ).toEqual([
      [5, '2026-08-21', '1080.00'],
      [6, '2026-09-21', '1070.00'],
    ]);
    const payments = await read(() => q.r.debt.queries.payments(ws, consumo.id));
    expect(payments.map((p) => p.amount.amount).sort()).toEqual(['1090.00', '1100.00', '1110.00', '1120.00']);
    const familiar = loans.get('Préstamo familiar')!;
    expect(familiar.status).toBe('PAID_OFF');
    const familyPayments = await read(() => q.r.debt.queries.payments(ws, familiar.id));
    expect(familyPayments.map((p) => p.amount.amount).sort()).toEqual(['340.02', '340.02', '340.03']);
    const definition = await read(() =>
      q.r.commitments.queries.getDefinition(ws, familiar.recurringDefinitionId as string),
    );
    expect(definition.status).toBe('ENDED');
    const educativo = loans.get('Crédito educativo')!;
    expect(educativo).toMatchObject({
      currentScheduleVersion: 2,
      outstandingPrincipal: { amount: '1007.15', currency: 'USD' },
    });
    const rows = (await read(() => q.r.debt.queries.installments(ws, educativo.id))).installments;
    expect(rows.filter((r) => r.status === 'PAID')).toHaveLength(8);
    expect(rows[8]).toMatchObject({ n: 9, dueDate: '2026-10-10', total: '1017.22', interest: '10.07' });
    const payment = (await read(() => q.r.debt.queries.payments(ws, educativo.id))).find(
      (p) => p.kind === 'PREPAYMENT',
    );
    expect(payment).toMatchObject({ businessDate: '2026-04-10', amount: { amount: '3000.00' } });
    const versions = await read(() => q.r.debt.amortizationQueries.versions(ws, educativo.id));
    expect(versions.map((v) => v.scheduleVersion)).toEqual([1, 2]);
  });

  it('[TC-IDENTITY-DEMO-018] la vista previa de un pago extra de 5000.00 BOB reduciendo plazo (sin persistir) deja 14 cuotas y 1118.96 BOB de interés', async () => {
    const loan = (await loansByName()).get('Préstamo vehicular')!;
    const before = JSON.stringify(await businessRows());
    const preview = await read(() =>
      q.r.debt.amortization.previewPrepayment({
        workspaceId: ws,
        loanId: loan.id,
        amount: { amount: '5000.00', currency: 'BOB' },
        businessDate: FIXED,
      }),
    );
    expect(preview.fromInstallmentNo).toBe(20);
    expect(preview.current).toMatchObject({
      installmentCount: 17,
      remainingInterest: { amount: '1740.99' },
    });
    const option = preview.options.find((o) => o.option === 'REDUCE_TERM')!;
    expect(option).toMatchObject({
      installmentCount: 14,
      remainingInterest: { amount: '1118.96' },
      interestSaved: { amount: '622.03' },
    });
    // El simulador de pagos extra parte del mismo estado y tampoco persiste nada.
    const simulation = await read(() =>
      q.r.debt.amortizationQueries.simulate(ws, {
        loanId: loan.id,
        extras: [{ type: 'ONE_TIME', installmentNo: 20, amount: '5000.00' }],
      }),
    );
    expect(simulation.type).toBe('LOAN_EXTRAS');
    if (simulation.type !== 'LOAN_EXTRAS') throw new Error('unreachable');
    expect(simulation.current).toMatchObject({ installments: 17, totalInterest: '1740.99' });
    expect(simulation.scenario.installments).toBe(14);
    expect(JSON.stringify(await businessRows())).toBe(before);
  });
});

describe('resumen de deudas y disponible para gastar (TC-IDENTITY-DEMO-019)', () => {
  it('[TC-IDENTITY-DEMO-019] resumen de deudas: USD 1207.15 consolidado en 8450.05 BOB, interés 2596.98 BOB y 536.67 USD, libre de deudas el 2028-02-01', async () => {
    const summary = await read(() => q.r.debtSummary.getDebtSummary({ workspaceId: ws, userId }));
    const ref = golden.reference.debtSummary;
    expect(summary.status).toBe('ACTIVE');
    const total = (code: string) => summary.totals.byCurrency.find((t) => t.currency === code)?.amount;
    expect(total('USD')).toBe(ref.totalUsd);
    expect(total('BOB')).toBe(ref.totalBob);
    expect(summary.totals.consolidated.amount.amount).toBe(ref.consolidatedBob);
    expect(summary.totals.consolidated.complete).toBe(true);
    expect(summary.debts.map((d) => d.name).sort()).toEqual([
      'Crédito educativo',
      'Préstamo de consumo',
      'Préstamo vehicular',
      'Tarjeta Andina Demo',
      'Tarjeta Kantuta Demo',
    ]);
    expect(summary.debts.some((d) => d.name === 'Préstamo familiar')).toBe(false);
    const interest = (code: string) =>
      summary.interestYtd.byCurrency.find((t) => t.currency === code)?.amount;
    expect(interest('BOB')).toBe(ref.interestBob);
    expect(interest('USD')).toBe(ref.interestUsd);
    const byLoan = Object.fromEntries(
      summary.interestYtd.attribution
        .filter((a) => a.kind === 'LOAN')
        .map((a) => [a.name, a.byCurrency[0]?.amount]),
    );
    expect(byLoan).toMatchObject({ 'Préstamo vehicular': '2166.91', 'Préstamo de consumo': '420.00' });
    expect(summary.debtFree.date).toBe(ref.debtFree);
  });

  it('[TC-IDENTITY-DEMO-019] disponible para gastar: comprometido 2349.00 BOB, reservado 26500.00 BOB y 550.00 USD, aportes planificados pendientes 100.00 USD', async () => {
    const result = await read(() =>
      q.r.reporting.spendable.getSpendable({ workspaceId: ws, userId } as never),
    );
    const spendable = result.spendable;
    const by = (code: string) => spendable.byCurrency.find((c) => c.currency === code)!;
    const ref = golden.reference.spendable;
    expect(spendable.period.label).toBe('2026-09');
    expect(by('BOB').committed.amount).toBe(ref.committedBob);
    expect(by('USD').committed.amount).toBe('0.00');
    expect(by('USDT').committed.amount).toBe('0.000000');
    expect(by('BOB').reservedForGoals.amount).toBe(ref.reservedBob);
    expect(by('USD').reservedForGoals.amount).toBe(ref.reservedUsd);
    expect(by('USD').plannedGoalContributions.amount).toBe(ref.plannedPendingUsd);
    expect(by('BOB').plannedGoalContributions.amount).toBe('0.00');
    // Disponible = líquido − reservado − comprometido − aportes planificados pendientes (sin plan de presupuesto).
    expect(by('BOB').spendable.amount).toBe(
      dec(by('BOB').liquid.amount).minus(ref.reservedBob).minus(ref.committedBob).toFixed(2),
    );
  });
});

describe('otra fecha ancla e independencia del catálogo (TC-IDENTITY-DEMO-020)', () => {
  it('[TC-IDENTITY-DEMO-020] con la ancla 2026-10-05 se conservan los estados y ninguna institución sale del catálogo de referencia', async () => {
    const second = await world.load({ anchor: SECOND, catalogDir: CATALOG_DIR });
    expect(second.outcome, second.failure ?? '').toBe('READY');
    const other = second.job.demoWorkspaceId;
    const q2 = demoQueryRuntimes({ databaseUrl: deps.databaseUrl, today: SECOND });
    try {
      const inOther = <T>(fn: () => Promise<T>) => q2.inWs(second.user.id, other, fn);
      await world.waitPublished(other);
      const subs = await inOther(() =>
        q2.r.commitments.subscriptionQueries.list(other, {
          statuses: ['ACTIVE', 'TRIAL', 'PAUSED', 'CANCELLED'],
        } as never),
      );
      const count = (status: string) => subs.filter((s) => s.status === status).length;
      expect([count('ACTIVE'), count('TRIAL'), count('PAUSED'), count('CANCELLED')]).toEqual([5, 1, 1, 1]);
      const cards = await inOther(() => q2.r.cards.queries.list(other, {} as never));
      const kantuta = cards.find((c) => c.name === 'Tarjeta Kantuta Demo')!;
      expect(kantuta).toMatchObject({ statementDay: 23, dueDay: 13 });
      const statements = await inOther(() => q2.r.cards.queries.listStatements(other, kantuta.id));
      const usd = statements.filter((s) => s.currency === 'USD' && s.id !== null);
      expect(usd[1]?.status).toBe('OVERDUE');
      expect(usd[0]?.status).toBe('ISSUED');
      const loansList = await inOther(() => q2.r.debt.queries.list(other, {}));
      const consumo = await inOther(() =>
        q2.r.debt.queries.get(other, loansList.find((l) => l.name === 'Préstamo de consumo')!.id),
      );
      expect(consumo.overdueInstallments.length).toBeGreaterThanOrEqual(1);
      expect(loansList.find((l) => l.name === 'Préstamo familiar')?.status).toBe('PAID_OFF');
      const goals = (await inOther(() => q2.r.goals.queries.list(other, {} as never))).data;
      expect(goals.find((g) => g.name === 'Viaje')?.tracking.status).toBe('BEHIND');
      expect(goals.find((g) => g.name === 'Laptop')?.status).toBe('ACHIEVED');
      // Ningún movimiento posterior a la ancla, salvo lo que generan los cronogramas (ocurrencias, cuotas y cargos).
      await migrator.query('BEGIN');
      let late: number;
      try {
        await migrator.query(`SELECT set_config('pf.demo_purge_workspace', $1, true)`, [other]);
        late = (
          await migrator.query<{ n: number }>(
            `SELECT count(*)::int AS n FROM txn.transaction WHERE workspace_id = $1 AND transaction_date > $2`,
            [other, SECOND],
          )
        ).rows[0]!.n;
      } finally {
        await migrator.query('ROLLBACK');
      }
      expect(late).toBe(0);
      // Instituciones ficticias, creadas a mano: sin vínculo al catálogo de referencia del entorno.
      const institutions = await inOther(() =>
        q2.r.accounts.institutions.listInstitutions({ workspaceId: other, includeArchived: true }),
      );
      expect(institutions.length).toBeGreaterThanOrEqual(5);
      expect(institutions.every((i) => i.name.endsWith('Demo') && i.catalogRef === null)).toBe(true);
      expect(await unbalancedEntries(migrator, other)).toEqual([]);
      expect(structuralOf(summarizeModules(SECOND))).toEqual(structuralOf(summarizeModules(FIXED)));
    } finally {
      await q2.close();
    }
  }, 600_000);
});
