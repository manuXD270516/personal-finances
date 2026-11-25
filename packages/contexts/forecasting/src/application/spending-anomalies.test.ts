import { describe, expect, it } from 'vitest';
import { DetectSpendingAnomalies, minusMonths } from './detect-spending-anomalies.js';
import { SpendingAnomalyQueries } from './spending-anomaly-queries.js';
import { LocalDate } from '@pf/shared-kernel';
import {
  buildAnomalyWorld,
  line,
  restaurantHistory,
  type AnomalyWorld,
} from './testing/anomaly-in-memory.js';

const W = 'w1';
const OLDER = '00000000-0000-4000-8000-000000000001';
const NEWER = '00000000-0000-4000-8000-000000000002';

/** Pasada del 2026-11-13 (mañana en La Paz) con la historia de «Restaurantes» y los gastos indicados. */
function world(now = '2026-11-13T09:15:00.000Z'): AnomalyWorld {
  const w = buildAnomalyWorld(now);
  w.lines.push(...restaurantHistory());
  return w;
}
const run = (w: AnomalyWorld) => new DetectSpendingAnomalies(w.deps).runWorkspace(W);
const open = (w: AnomalyWorld) => [...w.anomalies.rows.values()].filter((r) => r.snapshot.status === 'OPEN');

describe('DetectSpendingAnomalies', () => {
  it('[TC-FORECAST-ANOMALY-001] un gasto de 304.00 contra una mediana de 80.00 queda marcado con razón 3.8', async () => {
    const w = world();
    w.lines.push(line({ id: 'big', date: '2026-11-12', amount: '304.00' }));
    const outcome = await run(w);
    expect(outcome).toMatchObject({ evaluated: 1, flagged: 1 });
    const [anomaly] = open(w);
    expect(anomaly?.snapshot).toMatchObject({
      transactionId: 'big',
      transactionVersion: 1,
      reportingAmount: { amount: '304.00', currency: 'BOB' },
    });
    expect(anomaly?.snapshot.reasons[0]).toMatchObject({
      kind: 'CATEGORY_OUTLIER',
      ratio: '3.8',
      reference: '80.00',
      sampleSize: 12,
    });
    expect(w.metrics.evaluated).toBe(1);
    expect(w.metrics.flagged['CATEGORY_OUTLIER']).toBe(1);
    expect(w.metrics.passes).toBe(1);
  });

  it('[TC-FORECAST-ANOMALY-002] un gasto de 200.00 (razón 2.5) se evalúa pero no se marca', async () => {
    const w = world();
    w.lines.push(line({ id: 'mid', date: '2026-11-12', amount: '200.00' }));
    expect(await run(w)).toMatchObject({ evaluated: 1, flagged: 0 });
    expect(w.anomalies.rows.size).toBe(0);
  });

  it('[TC-FORECAST-ANOMALY-003] «Regalos» con 5 gastos de historia no se evalúa por categoría', async () => {
    const w = buildAnomalyWorld();
    w.categories.push({ categoryId: 'cat-regalos', uncategorized: false });
    for (let i = 0; i < 5; i += 1) {
      w.lines.push(
        line({ id: `g-${i}`, date: `2026-0${i + 1}-10`, amount: '100.00', categoryId: 'cat-regalos' }),
      );
    }
    w.lines.push(line({ id: 'gift', date: '2026-11-12', amount: '900.00', categoryId: 'cat-regalos' }));
    expect(await run(w)).toMatchObject({ evaluated: 1, flagged: 0 });
  });

  it('[TC-FORECAST-ANOMALY-005] un gasto atípico por categoría y contraparte es uno con dos motivos', async () => {
    const w = world();
    w.lines.length = 0;
    w.lines.push(...restaurantHistory({ counterpartyId: 'cp-pizzeria' }));
    w.lines.push(line({ id: 'big', date: '2026-11-12', amount: '304.00', counterpartyId: 'cp-pizzeria' }));
    await run(w);
    expect(open(w)).toHaveLength(1);
    expect(open(w)[0]?.snapshot.reasons.map((r) => r.kind)).toEqual([
      'CATEGORY_OUTLIER',
      'COUNTERPARTY_OUTLIER',
    ]);
  });

  it('[TC-FORECAST-ANOMALY-006] una contraparte nueva con un monto sobre el percentil 95 se marca', async () => {
    const w = buildAnomalyWorld();
    w.categories.push({ categoryId: 'cat-compras', uncategorized: false });
    for (let i = 0; i < 20; i += 1) {
      w.lines.push(
        line({
          id: `c-${i}`,
          date: `2026-0${(i % 9) + 1}-1${(i % 8) + 1}`,
          amount: `${(i + 1) * 40}.00`,
          categoryId: 'cat-compras',
          counterpartyId: `cp-${i}`,
        }),
      );
    }
    w.lines.push(
      line({
        id: 'new',
        date: '2026-11-12',
        amount: '1450.00',
        categoryId: 'cat-compras',
        counterpartyId: 'cp-nueva',
      }),
    );
    w.lines.push(
      line({
        id: 'small',
        date: '2026-11-12',
        amount: '120.00',
        categoryId: 'cat-compras',
        counterpartyId: 'cp-otra',
      }),
    );
    await run(w);
    expect(open(w).map((a) => a.snapshot.transactionId)).toEqual(['new']);
    expect(open(w)[0]?.snapshot.reasons[0]).toMatchObject({
      kind: 'NEW_COUNTERPARTY_HIGH_AMOUNT',
      ratio: null,
    });
  });

  it('[TC-FORECAST-ANOMALY-008] 50.00 USD con la tasa 6.96 se evalúan como 348.00 BOB con razón 4.4', async () => {
    const w = world();
    w.lines.push(line({ id: 'usd', date: '2026-11-12', amount: '50.00', currency: 'USD' }));
    await run(w);
    const [anomaly] = open(w);
    expect(anomaly?.snapshot.reportingAmount).toEqual({ amount: '348.00', currency: 'BOB' });
    expect(anomaly?.snapshot.amount).toEqual({ amount: '50.00', currency: 'USD' });
    expect(anomaly?.snapshot.reasons[0]?.ratio).toBe('4.4');
  });

  it('[TC-FORECAST-ANOMALY-009] los gastos vinculados a una ocurrencia de un compromiso no se evalúan', async () => {
    const w = world();
    w.lines.push(line({ id: 'streaming', date: '2026-11-12', amount: '900.00' }));
    w.linkedTransactions.add('streaming');
    expect(await run(w)).toMatchObject({ evaluated: 0, flagged: 0 });
    expect(w.anomalies.rows.size).toBe(0);
  });

  it('[TC-FORECAST-ANOMALY-010] un gasto en USDT sin tasa no se evalúa ni se marca y cuenta como no evaluado', async () => {
    const w = world();
    w.lines.push(line({ id: 'usdt', date: '2026-11-12', amount: '30.00', currency: 'USDT' }));
    expect(await run(w)).toMatchObject({ evaluated: 0, notRated: 1, flagged: 0 });
    expect(w.metrics.notRated).toBe(1);
    expect(w.scans.rows.size).toBe(0);
  });

  it('[TC-FORECAST-ANOMALY-010] sin tasa del dólar tampoco se evalúa, y con la tasa llegada después sí', async () => {
    const w = world();
    w.usdRate = undefined;
    w.lines.push(line({ id: 'usd', date: '2026-11-12', amount: '50.00', currency: 'USD' }));
    expect(await run(w)).toMatchObject({ evaluated: 0, notRated: 1 });
    w.usdRate = '6.96';
    expect(await run(w)).toMatchObject({ evaluated: 1, flagged: 1 });
  });

  it('[TC-FORECAST-ANOMALY-012] un gasto registrado tarde con fecha de hace 4 días se evalúa y se marca', async () => {
    const w = world('2026-11-14T09:15:00.000Z');
    w.lines.push(line({ id: 'late', date: '2026-11-09', amount: '304.00' }));
    expect(await run(w)).toMatchObject({ evaluated: 1, flagged: 1 });
  });

  it('[TC-FORECAST-ANOMALY-012] un gasto de hace más de 7 días ya no se evalúa', async () => {
    const w = world('2026-11-14T09:15:00.000Z');
    w.lines.push(line({ id: 'old', date: '2026-11-05', amount: '304.00' }));
    expect(await run(w)).toMatchObject({ evaluated: 0, flagged: 0 });
  });

  it('[TC-FORECAST-ANOMALY-011] repetir la pasada no vuelve a evaluar la misma versión ni duplica nada', async () => {
    const w = world();
    w.lines.push(line({ id: 'big', date: '2026-11-12', amount: '304.00' }));
    await run(w);
    expect(await run(w)).toMatchObject({ evaluated: 0, flagged: 0 });
    expect(w.anomalies.rows.size).toBe(1);
    expect(w.facts).toHaveLength(1);
  });

  it('[TC-FORECAST-ANOMALY-020] corregir el monto reemplaza el gasto atípico anterior y no marca la versión nueva', async () => {
    const w = world();
    w.lines.push(line({ id: 'big', date: '2026-11-12', amount: '304.00' }));
    await run(w);
    // El 2026-11-13 se corrige a 30.40 (versión 2); la pasada siguiente reemplaza la anterior.
    w.lines = w.lines.map((l) =>
      l.transactionId === 'big' ? line({ id: 'big', date: '2026-11-12', amount: '30.40', version: 2 }) : l,
    );
    w.clock.set(w.clock.now().plusMillis(86_400_000));
    expect(await run(w)).toMatchObject({ evaluated: 1, flagged: 0, superseded: 1 });
    const [first] = [...w.anomalies.rows.values()];
    expect(first?.snapshot.status).toBe('SUPERSEDED');
    expect(open(w)).toHaveLength(0);
  });

  it('[TC-FORECAST-ANOMALY-020] una versión nueva que sigue siendo atípica nace como un gasto atípico nuevo', async () => {
    const w = world();
    w.lines.push(line({ id: 'big', date: '2026-11-12', amount: '304.00' }));
    await run(w);
    w.lines = w.lines.map((l) =>
      l.transactionId === 'big' ? line({ id: 'big', date: '2026-11-12', amount: '320.00', version: 2 }) : l,
    );
    await run(w);
    const rows = [...w.anomalies.rows.values()].map((r) => [
      r.snapshot.transactionVersion,
      r.snapshot.status,
    ]);
    expect(rows).toEqual([
      [1, 'SUPERSEDED'],
      [2, 'OPEN'],
    ]);
  });

  it('[TC-FORECAST-ANOMALY-001] las porciones sin categoría no se evalúan por categoría', async () => {
    const w = world();
    w.lines.push(line({ id: 'x', date: '2026-11-12', amount: '5000.00', categoryId: 'cat-sin-categoria' }));
    expect(await run(w)).toMatchObject({ evaluated: 1, flagged: 0 });
  });

  it('[TC-FORECAST-ANOMALY-001] un gasto con dos porciones se evalúa por porción', async () => {
    const w = world();
    w.categories.push({ categoryId: 'cat-otra', uncategorized: false });
    w.lines.push(
      line({ id: 'split', date: '2026-11-12', amount: '304.00', splitIndex: 0 }),
      line({ id: 'split', date: '2026-11-12', amount: '20.00', splitIndex: 1, categoryId: 'cat-otra' }),
    );
    await run(w);
    expect(open(w)).toHaveLength(1);
    expect(open(w)[0]?.snapshot.reportingAmount.amount).toBe('324.00');
    expect(open(w)[0]?.snapshot.categoryIds).toEqual(['cat-restaurantes', 'cat-otra']);
  });

  it('[TC-NOTIFICATIONS-ANOMALY-002] una sola notificación por pasada con la cantidad y el gasto de mayor monto', async () => {
    const w = world();
    w.lines.push(
      line({ id: 'a', date: '2026-11-12', amount: '304.00' }),
      line({ id: 'b', date: '2026-11-11', amount: '500.00' }),
    );
    await run(w);
    expect(w.facts).toHaveLength(1);
    expect(w.facts[0]).toMatchObject({
      workspaceId: W,
      passDate: '2026-11-13',
      count: 2,
      top: { reportingAmount: { amount: '500.00', currency: 'BOB' }, reasons: ['CATEGORY_OUTLIER'] },
    });
  });

  it('[TC-NOTIFICATIONS-ANOMALY-003] una pasada sin gastos atípicos nuevos no avisa', async () => {
    const w = world();
    w.lines.push(line({ id: 'ok', date: '2026-11-12', amount: '85.00' }));
    await run(w);
    expect(w.facts).toHaveLength(0);
  });

  it('[TC-FORECAST-ANOMALY-011] deshabilitada, la detección no hace nada', async () => {
    const w = buildAnomalyWorld('2026-11-13T09:15:00.000Z', { enabled: false });
    w.lines.push(...restaurantHistory(), line({ id: 'big', date: '2026-11-12', amount: '304.00' }));
    expect(await new DetectSpendingAnomalies(w.deps).run()).toMatchObject({ workspaces: 0, flagged: 0 });
    expect(w.anomalies.rows.size).toBe(0);
  });

  it('[TC-FORECAST-ANOMALY-011] la falla de un workspace no corta a los demás', async () => {
    const w = world();
    w.workspaces = ['bad', W];
    w.lines.push(line({ id: 'big', date: '2026-11-12', amount: '304.00' }));
    const original = w.deps.expenses.listExpenseLines;
    let first = true;
    const deps = {
      ...w.deps,
      expenses: {
        listExpenseLines: async (ws: string, from: string, to: string) => {
          if (first) {
            first = false;
            throw new Error('boom');
          }
          return original(ws, from, to);
        },
      },
    };
    const summary = await new DetectSpendingAnomalies(deps).run();
    expect(summary).toMatchObject({ workspaces: 1, flagged: 1, failed: 1 });
  });

  it('[TC-FORECAST-ANOMALY-024] la retención purga los gastos atípicos de hace más de 25 meses y las evaluaciones viejas', async () => {
    const w = world();
    w.lines.push(line({ id: 'big', date: '2026-11-12', amount: '304.00' }));
    await run(w);
    // Pasan 26 meses: el gasto atípico y su evaluación se purgan.
    w.clock.set(w.clock.now().plusMillis(26 * 31 * 86_400_000));
    const purged = await new DetectSpendingAnomalies(w.deps).purge();
    expect(purged).toBe(2);
    expect(w.anomalies.rows.size).toBe(0);
    expect(w.scans.rows.size).toBe(0);
  });

  it('[TC-FORECAST-ANOMALY-024] minusMonths conserva el día o lo recorta al fin del mes', () => {
    expect(minusMonths(LocalDate.parse('2026-11-25'), 25).toString()).toBe('2024-10-25');
    expect(minusMonths(LocalDate.parse('2026-03-31'), 1).toString()).toBe('2026-02-28');
  });
});

describe('SpendingAnomalyQueries', () => {
  async function seeded() {
    const w = world();
    w.lines.push(
      line({ id: OLDER, date: '2026-11-12', amount: '304.00' }),
      line({ id: NEWER, date: '2026-11-13', amount: '400.00' }),
    );
    await run(w);
    return { w, queries: new SpendingAnomalyQueries(w.deps) };
  }
  const idOf = (w: AnomalyWorld, tx: string) =>
    [...w.anomalies.rows.values()].find((r) => r.snapshot.transactionId === tx)?.id as string;

  it('[TC-FORECAST-ANOMALY-016] la lista trae primero el gasto atípico más reciente y featureStatus ENABLED', async () => {
    const { queries } = await seeded();
    const page = await queries.list({ workspaceId: W });
    expect(page.featureStatus).toBe('ENABLED');
    expect(page.items.map((i) => i.transactionDate)).toEqual(['2026-11-13', '2026-11-12']);
    expect(page.items[0]?.reasons[0]).toMatchObject({
      kind: 'CATEGORY_OUTLIER',
      reference: { amount: '80.00', currency: 'BOB' },
    });
    expect(page.nextCursor).toBeNull();
  });

  it('[TC-FORECAST-ANOMALY-016] pagina con cursor y filtra por rango de fechas', async () => {
    const { queries } = await seeded();
    const first = await queries.list({ workspaceId: W, limit: 1 });
    expect(first.items).toHaveLength(1);
    expect(first.nextCursor).not.toBeNull();
    const [date, id] = (first.nextCursor as string).split('|');
    const second = await queries.list({
      workspaceId: W,
      limit: 1,
      cursor: { date: date as string, id: id as string },
    });
    expect(second.items.map((i) => i.transactionDate)).toEqual(['2026-11-12']);
    const ranged = await queries.list({ workspaceId: W, from: '2026-11-13', to: '2026-11-13' });
    expect(ranged.items.map((i) => i.transactionDate)).toEqual(['2026-11-13']);
  });

  it('[TC-FORECAST-ANOMALY-016] los filtros inválidos se rechazan con INVALID_FILTER', async () => {
    const { queries } = await seeded();
    await expect(queries.list({ workspaceId: W, status: 'X' })).rejects.toMatchObject({
      code: 'INVALID_FILTER',
    });
    await expect(
      queries.list({ workspaceId: W, from: '2026-11-14', to: '2026-11-01' }),
    ).rejects.toMatchObject({
      code: 'INVALID_FILTER',
    });
    await expect(queries.list({ workspaceId: W, transactionIds: [] })).rejects.toMatchObject({
      code: 'INVALID_FILTER',
    });
  });

  it('[TC-FORECAST-ANOMALY-018] descartar saca el gasto de los abiertos, queda auditado una vez y repetir es inocuo', async () => {
    const { w, queries } = await seeded();
    const id = idOf(w, OLDER);
    await queries.dismiss({ userId: 'u1', workspaceId: W, anomalyId: id, reason: 'EXPECTED_ONE_OFF' });
    await queries.dismiss({ userId: 'u1', workspaceId: W, anomalyId: id, reason: 'EXPECTED_ONE_OFF' });
    expect((await queries.list({ workspaceId: W })).items.map((i) => i.transactionId)).toEqual([NEWER]);
    const dismissed = await queries.list({ workspaceId: W, status: 'DISMISSED' });
    expect(dismissed.items[0]).toMatchObject({
      status: 'DISMISSED',
      decidedBy: 'u1',
      dismissReason: 'EXPECTED_ONE_OFF',
    });
    expect(dismissed.items[0]?.decidedAt).not.toBeNull();
    expect(w.audits.filter((a) => a.action === 'forecasting.spending_anomaly.dismissed')).toHaveLength(1);
    expect(w.audits[0]).toMatchObject({ aggregateType: 'SpendingAnomaly', aggregateId: id });
    expect(w.metrics.decided).toEqual(['DISMISS']);
  });

  it('[TC-FORECAST-ANOMALY-018] un motivo desconocido o una nota demasiado larga se rechazan', async () => {
    const { w, queries } = await seeded();
    const id = idOf(w, OLDER);
    expect(() => queries.dismiss({ userId: 'u1', workspaceId: W, anomalyId: id, reason: 'RARO' })).toThrow();
    await expect(
      queries.dismiss({ userId: 'u1', workspaceId: W, anomalyId: id, note: 'x'.repeat(201) }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('[TC-FORECAST-ANOMALY-019] restaurar vuelve a abrir el gasto con su marca y queda auditado', async () => {
    const { w, queries } = await seeded();
    const id = idOf(w, OLDER);
    await queries.dismiss({ userId: 'u1', workspaceId: W, anomalyId: id });
    await queries.restore({ userId: 'u2', workspaceId: W, anomalyId: id });
    await queries.restore({ userId: 'u2', workspaceId: W, anomalyId: id });
    expect((await queries.list({ workspaceId: W })).items.map((i) => i.transactionId).sort()).toEqual([
      OLDER,
      NEWER,
    ]);
    expect(w.audits.filter((a) => a.action === 'forecasting.spending_anomaly.restored')).toHaveLength(1);
  });

  it('[TC-FORECAST-ANOMALY-019] un gasto descartado no se marca otra vez en la misma versión', async () => {
    const { w, queries } = await seeded();
    await queries.dismiss({ userId: 'u1', workspaceId: W, anomalyId: idOf(w, OLDER) });
    // Las evaluaciones se purgaron pero el gasto sigue en la ventana: la unicidad impide marcarlo de nuevo.
    w.scans.rows.clear();
    await run(w);
    expect(w.anomalies.rows.size).toBe(2);
    expect((await queries.list({ workspaceId: W })).items.map((i) => i.transactionId)).toEqual([NEWER]);
  });

  it('[TC-FORECAST-ANOMALY-023] un gasto atípico de otro workspace o inexistente responde RESOURCE_NOT_FOUND', async () => {
    const { w, queries } = await seeded();
    await expect(
      queries.dismiss({ userId: 'u1', workspaceId: 'w2', anomalyId: idOf(w, OLDER) }),
    ).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
    await expect(queries.restore({ userId: 'u1', workspaceId: W, anomalyId: 'nope' })).rejects.toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
    });
  });

  it('[TC-FORECAST-ANOMALY-021] una transacción anulada deja de aparecer en la lista y en la consulta por transactionId', async () => {
    const { w, queries } = await seeded();
    w.states.set(OLDER, { version: 1, status: 'VOIDED' });
    expect((await queries.list({ workspaceId: W })).items.map((i) => i.transactionId)).toEqual([NEWER]);
    expect(
      (await queries.list({ workspaceId: W, transactionIds: [OLDER, NEWER] })).items.map(
        (i) => i.transactionId,
      ),
    ).toEqual([NEWER]);
  });

  it('[TC-FORECAST-ANOMALY-020] una transacción editada después de la detección indica transactionChanged', async () => {
    const { w, queries } = await seeded();
    w.states.set(OLDER, { version: 2, status: 'POSTED' });
    const items = (await queries.list({ workspaceId: W })).items;
    expect(items.find((i) => i.transactionId === OLDER)?.transactionChanged).toBe(true);
    expect(items.find((i) => i.transactionId === NEWER)?.transactionChanged).toBe(false);
  });

  it('[TC-FORECAST-ANOMALY-017] la consulta por transactionId devuelve abiertos y descartados, no los reemplazados', async () => {
    const { w, queries } = await seeded();
    await queries.dismiss({ userId: 'u1', workspaceId: W, anomalyId: idOf(w, OLDER) });
    const found = await queries.list({ workspaceId: W, transactionIds: [OLDER, NEWER] });
    expect(found.items.map((i) => [i.transactionId, i.status]).sort()).toEqual([
      [OLDER, 'DISMISSED'],
      [NEWER, 'OPEN'],
    ]);
  });

  it('[TC-FORECAST-ANOMALY-016] con la detección deshabilitada la lista conserva lo detectado y lo informa', async () => {
    const { w } = await seeded();
    const disabled = new SpendingAnomalyQueries({
      ...w.deps,
      settings: { ...w.deps.settings, enabled: false },
    });
    const page = await disabled.list({ workspaceId: W });
    expect(page.featureStatus).toBe('DISABLED');
    expect(page.items).toHaveLength(2);
  });
});
