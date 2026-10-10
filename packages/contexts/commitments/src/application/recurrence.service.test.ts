import { DomainError } from '@pf/shared-kernel';
import { describe, expect, it } from 'vitest';
import { CommitmentsQueries } from './commitments.queries.js';
import { DefinitionsService, type CreateDefinitionCommand } from './definitions.service.js';
import { GenerateOccurrencesService } from './generate-occurrences.service.js';
import { OccurrencesService } from './occurrences.service.js';
import {
  ARCHIVED_CATEGORY,
  BANK,
  CARD,
  CASH,
  CATEGORY,
  InMemoryCommitments,
  SAVINGS,
  USD_BANK,
  USER,
  WS,
} from './testing/in-memory.js';

const bob = (amount: string) => ({ amount, currency: 'BOB' });
const usd = (amount: string) => ({ amount, currency: 'USD' });
/** 12:00 en America/La_Paz = 16:00Z. */
const noon = (date: string) => `${date}T16:00:00Z`;

function setup() {
  const mem = new InMemoryCommitments();
  const deps = mem.deps();
  const defs = new DefinitionsService(deps);
  const occs = new OccurrencesService(deps);
  const job = new GenerateOccurrencesService(deps, occs);
  const queries = new CommitmentsQueries(deps);
  mem.setNow(noon('2026-10-09'));
  return { mem, deps, defs, occs, job, queries };
}

type S = ReturnType<typeof setup>;

const listOcc = async (s: S, filter: Parameters<S['queries']['listOccurrences']>[1]) => ({
  data: await s.queries.listOccurrences(WS, filter),
});

function template(
  over: Partial<CreateDefinitionCommand['template']> = {},
): CreateDefinitionCommand['template'] {
  return {
    accountId: BANK,
    amount: { type: 'FIXED', amount: bob('3500.00') },
    categoryId: CATEGORY,
    schedule: { cadence: 'MONTHLY', interval: 1, startDate: '2026-10-05' },
    materialization: { mode: 'PENDING_APPROVAL', leadDays: 3 },
    ...over,
  };
}

async function create(
  s: S,
  name: string,
  over: Partial<CreateDefinitionCommand['template']> = {},
  kind = 'EXPENSE',
) {
  return s.defs.create({ workspaceId: WS, userId: USER, name, kind, template: template(over) });
}

const codeOf = async (fn: () => Promise<unknown>): Promise<string | undefined> => {
  try {
    await fn();
  } catch (err) {
    return err instanceof DomainError ? err.code : `no-domain:${String(err)}`;
  }
  return undefined;
};

const dates = (s: S, id: string, status?: string) =>
  s.mem
    .forDefinition(id)
    .filter((o) => !status || o.status === status)
    .map((o) => o.occurrenceDate);

describe('Crear definiciones (FR-COMMITMENTS-001)', () => {
  it('[TC-COMMITMENTS-RECUR-001] un gasto mensual nace ACTIVE en versión 1 con ocurrencias, auditoría y transición CREATE', async () => {
    const s = setup();
    const def = await create(s, 'Alquiler');
    expect(def).toMatchObject({ status: 'ACTIVE', currentVersionNo: 1, generatedCount: 4 });
    expect(dates(s, def.id)).toEqual(['2026-10-05', '2026-11-05', '2026-12-05', '2027-01-05']);
    expect(s.mem.forDefinition(def.id).every((o) => o.status === 'SCHEDULED')).toBe(true);
    const created = s.mem
      .recordedFor(def.id)
      .find((r) => r.entry.action === 'commitments.recurring_definition.created');
    expect(created?.steps[0]).toMatchObject({
      kind: 'TRANSITION',
      transition: 'CREATE',
      fromState: null,
      toState: 'ACTIVE',
    });
    expect(s.mem.eventsOf('commitments.RecurringDefinitionChanged')).toHaveLength(1);
    expect(s.mem.eventsOf('commitments.OccurrencesGenerated')).toHaveLength(1);
  });

  it('[TC-COMMITMENTS-RECUR-002] moneda distinta a la de la cuenta o categoría archivada se rechaza sin crear nada', async () => {
    const s = setup();
    expect(
      await codeOf(() => create(s, 'Netflix', { amount: { type: 'FIXED', amount: usd('25.00') } })),
    ).toBe('CURRENCY_MISMATCH');
    expect(
      await codeOf(() =>
        create(s, 'Cable TV', {
          amount: { type: 'FIXED', amount: bob('120.00') },
          categoryId: ARCHIVED_CATEGORY,
        }),
      ),
    ).toBe('CATEGORY_ARCHIVED');
    expect(await s.queries.listDefinitions(WS, {})).toEqual([]);
    expect(s.mem.all()).toEqual([]);
    expect(s.mem.recorded).toEqual([]);
    expect(s.mem.events).toEqual([]);
  });

  it('[TC-COMMITMENTS-RECUR-003] LOAN_PAYMENT y CARD_PAYMENT ⇒ RECURRING_KIND_NOT_AVAILABLE sin crear nada', async () => {
    const s = setup();
    expect(await codeOf(() => create(s, 'Préstamo', {}, 'LOAN_PAYMENT'))).toBe(
      'RECURRING_KIND_NOT_AVAILABLE',
    );
    expect(await codeOf(() => create(s, 'Tarjeta', {}, 'CARD_PAYMENT'))).toBe('RECURRING_KIND_NOT_AVAILABLE');
    expect(s.mem.all()).toEqual([]);
  });

  it('[TC-COMMITMENTS-RECUR-004] una transferencia recurrente se aprueba como UNA transferencia; entre monedas se rechaza', async () => {
    const s = setup();
    s.mem.setNow(noon('2026-11-01'));
    const savings = await create(
      s,
      'Aporte a ahorro',
      {
        accountId: BANK,
        toAccountId: SAVINGS,
        categoryId: null,
        amount: { type: 'FIXED', amount: bob('500.00') },
        schedule: { cadence: 'MONTHLY', startDate: '2026-11-01' },
      },
      'TRANSFER',
    );
    const [first] = s.mem.forDefinition(savings.id);
    const approved = await s.occs.materialize({ workspaceId: WS, userId: USER, occurrenceId: first!.id });
    expect(approved.occurrence.status).toBe('MATERIALIZED');
    expect(s.mem.recordCalls).toHaveLength(1);
    expect(s.mem.recordCalls[0]).toMatchObject({
      kind: 'TRANSFER',
      accountId: BANK,
      toAccountId: SAVINGS,
      amount: bob('500.00'),
      occurrenceRef: { occurrenceId: first!.id },
    });
    const card = await create(
      s,
      'Pago de tarjeta',
      {
        toAccountId: CARD,
        categoryId: null,
        amount: { type: 'FIXED', amount: bob('1450.00') },
        schedule: { cadence: 'MONTHLY', startDate: '2026-11-06' },
      },
      'TRANSFER',
    );
    expect(card.kind).toBe('TRANSFER');
    expect(
      await codeOf(() =>
        create(
          s,
          'Cambio',
          {
            accountId: USD_BANK,
            toAccountId: BANK,
            categoryId: null,
            amount: { type: 'FIXED', amount: usd('100.00') },
          },
          'TRANSFER',
        ),
      ),
    ).toBe('TRANSFER_CURRENCY_MISMATCH');
  });

  it('[TC-COMMITMENTS-RECUR-010] MIN_MAX informa el rango y proyecta el máximo; VARIABLE no tiene monto esperado', async () => {
    const s = setup();
    const gym = await create(s, 'Gimnasio', {
      amount: { type: 'MIN_MAX', min: bob('100.00'), max: bob('180.00') },
      schedule: { cadence: 'MONTHLY', startDate: '2026-10-28' },
    });
    const wholesale = await create(s, 'Compra mayorista', {
      amount: { type: 'VARIABLE' },
      schedule: { cadence: 'MONTHLY', startDate: '2026-10-30' },
    });
    const page = await listOcc(s, { limit: 50 });
    const g = page.data.find((o) => o.definitionId === gym.id);
    expect(g?.expected).toEqual({
      type: 'MIN_MAX',
      min: bob('100.00'),
      max: bob('180.00'),
    });
    expect(g?.projectedAmount).toEqual(bob('180.00'));
    const w = page.data.find((o) => o.definitionId === wholesale.id);
    expect(w?.expected).toEqual({ type: 'VARIABLE' });
    expect(w?.projectedAmount).toBeNull();
  });

  it('[TC-COMMITMENTS-RECUR-020] AUTO_CREATE con VARIABLE o MIN_MAX ⇒ RECURRING_MODE_NOT_ALLOWED', async () => {
    const s = setup();
    expect(
      await codeOf(() =>
        create(s, 'Mayorista', { amount: { type: 'VARIABLE' }, materialization: { mode: 'AUTO_CREATE' } }),
      ),
    ).toBe('RECURRING_MODE_NOT_ALLOWED');
    expect(
      await codeOf(() =>
        create(s, 'Gym', {
          amount: { type: 'MIN_MAX', min: bob('100.00'), max: bob('180.00') },
          materialization: { mode: 'AUTO_CREATE' },
        }),
      ),
    ).toBe('RECURRING_MODE_NOT_ALLOWED');
  });
});

describe('Job de generación: ventana, próximas y atrasadas', () => {
  it('[TC-COMMITMENTS-RECUR-016] desliza la ventana a hoy + 90 días y no genera para definiciones pausadas', async () => {
    const s = setup();
    const internet = await create(s, 'Internet', {
      schedule: { cadence: 'MONTHLY', startDate: '2026-10-20' },
    });
    const gym = await create(s, 'Gimnasio', { schedule: { cadence: 'MONTHLY', startDate: '2026-10-28' } });
    expect(dates(s, internet.id)).toEqual(['2026-10-20', '2026-11-20', '2026-12-20']);
    await s.defs.pause({
      workspaceId: WS,
      userId: USER,
      definitionId: gym.id,
      expectedVersion: (await s.queries.getDefinition(WS, gym.id)).version,
    });
    const gymRows = s.mem.forDefinition(gym.id).length;
    s.mem.setNow(noon('2026-11-09'));
    await s.job.runWorkspace(WS);
    expect(dates(s, internet.id)).toContain('2027-01-20');
    expect(Math.max(...dates(s, internet.id).map((d) => Date.parse(d)))).toBeLessThanOrEqual(
      Date.parse('2027-02-07'),
    );
    expect((await s.queries.getDefinition(WS, internet.id)).generatedThrough).toBe('2027-02-07');
    expect(s.mem.forDefinition(gym.id)).toHaveLength(gymRows);
  });

  it('[TC-COMMITMENTS-RECUR-018] pasa a próxima según la anticipación y a atrasada tras el vencimiento, una sola vez', async () => {
    const s = setup();
    const def = await create(s, 'Internet', { schedule: { cadence: 'MONTHLY', startDate: '2026-10-20' } });
    const first = () => s.mem.forDefinition(def.id)[0]!.status;
    for (const [day, expected] of [
      ['2026-10-16', 'SCHEDULED'],
      ['2026-10-17', 'DUE'],
      ['2026-10-20', 'DUE'],
      ['2026-10-21', 'OVERDUE'],
    ] as const) {
      s.mem.setNow(noon(day));
      await s.job.runWorkspace(WS);
      await s.job.runWorkspace(WS);
      expect(first(), day).toBe(expected);
    }
    expect(
      s.mem
        .eventsOf('commitments.RecurringOccurrenceDue')
        .filter((e) => e.payload['dueDate'] === '2026-10-20'),
    ).toHaveLength(1);
    expect(
      s.mem
        .eventsOf('commitments.RecurringOccurrenceChanged')
        .filter((e) => e.payload['transition'] === 'MARK_OVERDUE' && e.payload['dueDate'] === '2026-10-20'),
    ).toHaveLength(1);
  });

  it('[TC-COMMITMENTS-RECUR-021] en aprobación pendiente la próxima aparece por aprobar y no crea transacción', async () => {
    const s = setup();
    const def = await create(s, 'Alquiler');
    s.mem.setNow(noon('2026-11-02'));
    await s.job.runWorkspace(WS);
    const tray = await listOcc(s, { requiresApproval: true, limit: 50 });
    const nov = tray.data.find((o) => o.occurrenceDate === '2026-11-05');
    expect(nov).toMatchObject({ status: 'DUE', requiresApproval: true });
    expect(s.mem.transactionsStore.size).toBe(0);
    expect(tray.data.every((o) => o.definitionId === def.id)).toBe(true);
    expect(await s.queries.pendingApprovalCount(WS)).toBe(tray.data.length);
  });

  it('[TC-COMMITMENTS-RECUR-022] en solo aviso avisa sin transacción y fuera de la bandeja (D114)', async () => {
    const s = setup();
    await create(s, 'Luz', {
      amount: { type: 'ESTIMATED', amount: bob('150.00') },
      schedule: { cadence: 'MONTHLY', startDate: '2026-10-25' },
      materialization: { mode: 'NOTIFY_ONLY', leadDays: 3 },
    });
    s.mem.setNow(noon('2026-10-22'));
    await s.job.runWorkspace(WS);
    const due = s.mem.eventsOf('commitments.RecurringOccurrenceDue');
    expect(due).toHaveLength(1);
    expect(due[0]?.payload).toMatchObject({
      requiresApproval: false,
      mode: 'NOTIFY_ONLY',
      managedBy: 'USER',
    });
    expect(s.mem.transactionsStore.size).toBe(0);
    expect((await listOcc(s, { requiresApproval: true, limit: 50 })).data).toEqual([]);
    // Aun así se puede aprobar (D114).
    const [occ] = s.mem.all();
    const approved = await s.occs.materialize({ workspaceId: WS, userId: USER, occurrenceId: occ!.id });
    expect(approved.occurrence.status).toBe('MATERIALIZED');
  });

  it('D131: una definición con inicio en el pasado solo genera desde el inicio del periodo actual', async () => {
    const s = setup();
    const def = await create(s, 'Seguro', { schedule: { cadence: 'MONTHLY', startDate: '2026-03-15' } });
    expect(dates(s, def.id)).toEqual(['2026-10-15', '2026-11-15', '2026-12-15']);
  });
});

describe('Creación automática (FR-COMMITMENTS-007)', () => {
  async function autoInternet(s: S) {
    return create(s, 'Internet', {
      amount: { type: 'FIXED', amount: bob('199.00') },
      schedule: { cadence: 'MONTHLY', startDate: '2026-10-20' },
      materialization: { mode: 'AUTO_CREATE', autoCreateStatus: 'PENDING', leadDays: 3 },
    });
  }

  it('[TC-COMMITMENTS-RECUR-019] crea un gasto pendiente en la fecha de vencimiento y materializa la ocurrencia', async () => {
    const s = setup();
    const def = await autoInternet(s);
    s.mem.setNow(noon('2026-10-20'));
    const result = await s.job.runWorkspace(WS);
    expect(result.autoCreated).toBe(1);
    expect(s.mem.recordCalls).toHaveLength(1);
    expect(s.mem.recordCalls[0]).toMatchObject({
      kind: 'EXPENSE',
      status: 'PENDING',
      businessDate: '2026-10-20',
      amount: bob('199.00'),
      description: 'Internet',
    });
    const occ = s.mem.forDefinition(def.id)[0]!;
    expect(occ.status).toBe('MATERIALIZED');
    const txn = [...s.mem.transactionsStore.values()][0]!;
    expect(txn.externalRef).toEqual({ namespace: 'commitments.occurrence', id: occ.id });
    expect(occ.transactionId).toBe(txn.transactionId);
    const materialized = s.mem.eventsOf('commitments.RecurringOccurrenceMaterialized');
    expect(materialized).toHaveLength(1);
    expect(materialized[0]?.payload).toMatchObject({ mode: 'CREATED', transactionId: txn.transactionId });
  });

  it('[TC-COMMITMENTS-RECUR-051] reprocesar la creación automática no crea una segunda transacción', async () => {
    const s = setup();
    await autoInternet(s);
    s.mem.setNow(noon('2026-10-20'));
    await s.job.runWorkspace(WS);
    await s.job.runWorkspace(WS);
    expect(s.mem.transactionsStore.size).toBe(1);
    expect(s.mem.eventsOf('commitments.RecurringOccurrenceMaterialized')).toHaveLength(1);
  });

  it('[TC-COMMITMENTS-RECUR-026] [D129] si Transactions rechaza (periodo cerrado) queda atrasada con el error visible y no se reintenta el mismo día', async () => {
    const s = setup();
    const def = await autoInternet(s);
    s.mem.closedMonths.add('2026-10');
    s.mem.setNow(noon('2026-10-20'));
    const result = await s.job.runWorkspace(WS);
    expect(result.autoRejected).toBe(1);
    const occ = s.mem.forDefinition(def.id)[0]!;
    expect(occ).toMatchObject({ status: 'DUE', lastAutoCreateError: 'PERIOD_CLOSED', transactionId: null });
    const calls = s.mem.recordAttempts;
    await s.job.runWorkspace(WS);
    expect(s.mem.recordAttempts).toBe(calls);
    // Al día siguiente se reintenta (sigue cerrado ⇒ vuelve a rechazarse) y queda atrasada.
    s.mem.setNow(noon('2026-10-21'));
    await s.job.runWorkspace(WS);
    expect(s.mem.recordAttempts).toBe(calls + 1);
    expect(s.mem.forDefinition(def.id)[0]?.status).toBe('OVERDUE');
  });

  it('[TC-COMMITMENTS-RECUR-050] un fallo de auditoría revierte la transacción y la ocurrencia (misma unidad de trabajo)', async () => {
    const s = setup();
    const def = await autoInternet(s);
    s.mem.setNow(noon('2026-10-20'));
    const failing = {
      ...s.mem.lifecycle,
      record: async (
        entry: Parameters<typeof s.mem.lifecycle.record>[0],
        steps: Parameters<typeof s.mem.lifecycle.record>[1],
      ) => {
        if (entry.action.endsWith('.materialized')) throw new Error('audit unavailable');
        return s.mem.lifecycle.record(entry, steps);
      },
    };
    const deps = s.mem.deps({ lifecycle: failing as never });
    const occs = new OccurrencesService(deps);
    const [occ] = s.mem.forDefinition(def.id);
    await expect(occs.materialize({ workspaceId: WS, userId: USER, occurrenceId: occ!.id })).rejects.toThrow(
      /audit unavailable/,
    );
    expect(s.mem.transactionsStore.size).toBe(0);
    expect(s.mem.occurrence(occ!.id).status).toBe('SCHEDULED');
    expect(s.mem.eventsOf('commitments.RecurringOccurrenceMaterialized')).toEqual([]);
  });
});

describe('Aprobar, editar, omitir y vincular (FR-COMMITMENTS-008)', () => {
  it('[TC-COMMITMENTS-RECUR-023] aprobar una estimada con el monto real crea el gasto posteado y deja recorrido', async () => {
    const s = setup();
    await create(s, 'Luz', {
      amount: { type: 'ESTIMATED', amount: bob('150.00') },
      schedule: { cadence: 'MONTHLY', startDate: '2026-10-25' },
    });
    s.mem.setNow(noon('2026-10-25'));
    const [occ] = s.mem.all();
    const result = await s.occs.materialize({
      workspaceId: WS,
      userId: USER,
      occurrenceId: occ!.id,
      amount: bob('163.40'),
    });
    expect(result.occurrence.status).toBe('MATERIALIZED');
    expect(s.mem.recordCalls[0]).toMatchObject({
      status: 'POSTED',
      businessDate: '2026-10-25',
      amount: bob('163.40'),
      categoryId: CATEGORY,
      occurrenceRef: { occurrenceId: occ!.id },
    });
    const record = s.mem.recordedFor(occ!.id).find((r) => r.entry.action.endsWith('.materialized'));
    expect(record?.steps[0]).toMatchObject({
      kind: 'TRANSITION',
      transition: 'MATERIALIZE',
      toState: 'MATERIALIZED',
    });
    expect(record?.entry.changes).toContainEqual({ field: 'amount', before: null, after: bob('163.40') });
  });

  it('[TC-COMMITMENTS-RECUR-024] variable sin monto o MIN_MAX fuera de rango se rechaza sin transacción', async () => {
    const s = setup();
    const wholesale = await create(s, 'Compra mayorista', {
      amount: { type: 'VARIABLE' },
      schedule: { cadence: 'MONTHLY', startDate: '2026-10-30' },
    });
    const gym = await create(s, 'Gimnasio', {
      amount: { type: 'MIN_MAX', min: bob('100.00'), max: bob('180.00') },
      schedule: { cadence: 'MONTHLY', startDate: '2026-10-28' },
    });
    const w = s.mem.forDefinition(wholesale.id)[0]!;
    const g = s.mem.forDefinition(gym.id)[0]!;
    expect(
      await codeOf(() => s.occs.materialize({ workspaceId: WS, userId: USER, occurrenceId: w.id })),
    ).toBe('OCCURRENCE_AMOUNT_REQUIRED');
    expect(
      await codeOf(() =>
        s.occs.materialize({ workspaceId: WS, userId: USER, occurrenceId: g.id, amount: bob('200.00') }),
      ),
    ).toBe('RECURRING_INVALID_AMOUNT');
    expect(s.mem.transactionsStore.size).toBe(0);
  });

  it('[TC-COMMITMENTS-RECUR-025] aprobar dos veces ⇒ OCCURRENCE_ALREADY_MATERIALIZED y una sola transacción', async () => {
    const s = setup();
    await create(s, 'Luz', { amount: { type: 'ESTIMATED', amount: bob('150.00') } });
    const [occ] = s.mem.all();
    await s.occs.materialize({ workspaceId: WS, userId: USER, occurrenceId: occ!.id });
    expect(
      await codeOf(() => s.occs.materialize({ workspaceId: WS, userId: USER, occurrenceId: occ!.id })),
    ).toBe('OCCURRENCE_ALREADY_MATERIALIZED');
    expect(s.mem.transactionsStore.size).toBe(1);
  });

  it('[TC-COMMITMENTS-RECUR-026] en un periodo cerrado se rechaza y se aprueba tras mover su fecha', async () => {
    const s = setup();
    s.mem.setNow(noon('2026-09-10'));
    const def = await create(s, 'Internet', { schedule: { cadence: 'MONTHLY', startDate: '2026-09-20' } });
    s.mem.closedMonths.add('2026-09');
    s.mem.setNow(noon('2026-10-02'));
    await s.job.runWorkspace(WS);
    const occ = s.mem.forDefinition(def.id)[0]!;
    expect(occ.status).toBe('OVERDUE');
    expect(
      await codeOf(() => s.occs.materialize({ workspaceId: WS, userId: USER, occurrenceId: occ.id })),
    ).toBe('PERIOD_CLOSED');
    expect(s.mem.occurrence(occ.id).status).toBe('OVERDUE');
    expect(s.mem.transactionsStore.size).toBe(0);
    await s.occs.edit({
      workspaceId: WS,
      userId: USER,
      occurrenceId: occ.id,
      expectedVersion: s.mem.occurrence(occ.id).version,
      dueDate: '2026-10-02',
    });
    await s.occs.materialize({ workspaceId: WS, userId: USER, occurrenceId: occ.id });
    expect(s.mem.recordCalls.at(-1)?.businessDate).toBe('2026-10-02');
    expect(s.mem.occurrence(occ.id).status).toBe('MATERIALIZED');
  });

  it('[TC-COMMITMENTS-RECUR-027] editar monto y fecha no afecta a la definición ni a las demás ocurrencias', async () => {
    const s = setup();
    const def = await create(s, 'Alquiler');
    const nov = s.mem.forDefinition(def.id).find((o) => o.occurrenceDate === '2026-11-05')!;
    const edited = await s.occs.edit({
      workspaceId: WS,
      userId: USER,
      occurrenceId: nov.id,
      expectedVersion: nov.version,
      expectedAmount: bob('3650.00'),
      dueDate: '2026-11-07',
    });
    expect(edited).toMatchObject({ occurrenceDate: '2026-11-05', dueDate: '2026-11-07', overridden: true });
    expect(edited.expected.amount).toEqual(bob('3650.00'));
    const dec = s.mem.forDefinition(def.id).find((o) => o.occurrenceDate === '2026-12-05')!;
    expect(dec.expected.amount).toBe('3500.00');
    const rec = s.mem.recordedFor(nov.id).at(-1)!;
    expect(rec.steps[0]).toMatchObject({ kind: 'ANNOTATION', changedFields: ['expected', 'dueDate'] });
    expect(
      await codeOf(() =>
        s.occs.edit({
          workspaceId: WS,
          userId: USER,
          occurrenceId: nov.id,
          expectedVersion: 1,
          dueDate: '2026-11-08',
        }),
      ),
    ).toBe('PRECONDITION_FAILED');
  });

  it('[TC-COMMITMENTS-RECUR-028] omitir no crea transacción, no cuenta como comprometida y no se regenera', async () => {
    const s = setup();
    const gym = await create(s, 'Gimnasio', {
      amount: { type: 'MIN_MAX', min: bob('100.00'), max: bob('180.00') },
      schedule: { cadence: 'MONTHLY', startDate: '2026-12-28' },
    });
    const [occ] = s.mem.forDefinition(gym.id);
    const before = await s.queries.getForRange({ workspaceId: WS, from: '2026-12-01', to: '2026-12-31' });
    expect(before.fromCommitments).toEqual([bob('180.00')]);
    const skipped = await s.occs.skip({
      workspaceId: WS,
      userId: USER,
      occurrenceId: occ!.id,
      reason: 'vacaciones',
    });
    expect(skipped).toMatchObject({ status: 'SKIPPED', skipReason: 'vacaciones' });
    const after = await s.queries.getForRange({ workspaceId: WS, from: '2026-12-01', to: '2026-12-31' });
    expect(after.fromCommitments).toEqual([]);
    await s.job.runWorkspace(WS);
    expect(s.mem.forDefinition(gym.id).filter((o) => o.occurrenceDate === '2026-12-28')).toHaveLength(1);
    expect(s.mem.transactionsStore.size).toBe(0);
  });

  async function internetWithPayment(s: S, accountId = BANK) {
    const def = await create(s, 'Internet', {
      amount: { type: 'FIXED', amount: bob('199.00') },
      schedule: { cadence: 'MONTHLY', startDate: '2026-10-20' },
    });
    const occ = s.mem.forDefinition(def.id)[0]!;
    const txn = s.mem.addTransaction({
      kind: 'EXPENSE',
      accountId,
      amount: bob('199.00'),
      businessDate: '2026-10-19',
    });
    return { def, occ, txn };
  }

  it('[TC-COMMITMENTS-RECUR-029] vincular una transacción existente resuelve sin crear transacciones', async () => {
    const s = setup();
    const { occ, txn } = await internetWithPayment(s);
    const linked = await s.occs.link({
      workspaceId: WS,
      userId: USER,
      occurrenceId: occ.id,
      transactionId: txn,
    });
    expect(linked).toMatchObject({ status: 'MATCHED', matchedBy: 'USER_LINK', transactionId: txn });
    expect(s.mem.recordCalls).toHaveLength(0);
    const events = s.mem.eventsOf('commitments.RecurringOccurrenceMaterialized');
    expect(events[0]?.payload).toMatchObject({ mode: 'MATCHED', matchedBy: 'USER_LINK', transactionId: txn });
  });

  it('[TC-COMMITMENTS-RECUR-030] vincular con una transacción de otra cuenta ⇒ OCCURRENCE_LINK_MISMATCH [ACCOUNT]', async () => {
    const s = setup();
    const { occ, txn } = await internetWithPayment(s, CASH);
    try {
      await s.occs.link({ workspaceId: WS, userId: USER, occurrenceId: occ.id, transactionId: txn });
      expect.unreachable();
    } catch (err) {
      expect((err as DomainError).code).toBe('OCCURRENCE_LINK_MISMATCH');
      expect((err as DomainError).details['reasons']).toEqual(['ACCOUNT']);
    }
    expect(s.mem.occurrence(occ.id).status).toBe('SCHEDULED');
  });

  it('[TC-COMMITMENTS-RECUR-031] anular la transacción libera la ocurrencia una sola vez aunque el hecho se repita', async () => {
    const s = setup();
    const { occ, txn } = await internetWithPayment(s);
    await s.occs.link({ workspaceId: WS, userId: USER, occurrenceId: occ.id, transactionId: txn });
    s.mem.setNow(noon('2026-10-22'));
    s.mem.voidTransaction(txn);
    expect(await s.occs.onTransactionVoided({ workspaceId: WS, transactionId: txn })).toBe(true);
    expect(await s.occs.onTransactionVoided({ workspaceId: WS, transactionId: txn })).toBe(false);
    expect(s.mem.occurrence(occ.id)).toMatchObject({ status: 'OVERDUE', transactionId: null });
    const released = s.mem
      .eventsOf('commitments.RecurringOccurrenceChanged')
      .filter((e) => e.payload['transition'] === 'RELEASE');
    expect(released).toHaveLength(1);
    expect(released[0]?.payload['releasedTransactionId']).toBe(txn);
    // Puede aprobarse o vincularse de nuevo.
    await s.occs.materialize({ workspaceId: WS, userId: USER, occurrenceId: occ.id });
    expect(s.mem.occurrence(occ.id).status).toBe('MATERIALIZED');
  });

  it('[TC-COMMITMENTS-RECUR-049] una transacción ya vinculada a otra ocurrencia ⇒ TRANSACTION_ALREADY_LINKED', async () => {
    const s = setup();
    const { def, occ, txn } = await internetWithPayment(s);
    await s.occs.link({ workspaceId: WS, userId: USER, occurrenceId: occ.id, transactionId: txn });
    const nov = s.mem.forDefinition(def.id).find((o) => o.occurrenceDate === '2026-11-20')!;
    expect(
      await codeOf(() =>
        s.occs.link({ workspaceId: WS, userId: USER, occurrenceId: nov.id, transactionId: txn }),
      ),
    ).toBe('TRANSACTION_ALREADY_LINKED');
  });

  it('[TC-COMMITMENTS-RECUR-046] aprobar antes del vencimiento usa la fecha de hoy', async () => {
    const s = setup();
    await create(s, 'Alquiler', { schedule: { cadence: 'MONTHLY', startDate: '2026-11-05' } });
    s.mem.setNow(noon('2026-10-30'));
    const [occ] = s.mem.all();
    await s.occs.materialize({ workspaceId: WS, userId: USER, occurrenceId: occ!.id });
    expect(s.mem.recordCalls[0]).toMatchObject({
      businessDate: '2026-10-30',
      amount: bob('3500.00'),
      status: 'POSTED',
    });
  });
});

describe('Pausar, reanudar, terminar y revisar (FR-COMMITMENTS-009)', () => {
  const version = async (s: S, id: string) => (await s.queries.getDefinition(WS, id)).version;
  const act = async (s: S, id: string) => ({
    workspaceId: WS,
    userId: USER,
    definitionId: id,
    expectedVersion: await version(s, id),
  });

  it('[TC-COMMITMENTS-RECUR-032] pausar cancela las futuras y reanudar reinstaura las posteriores sin recrear el intervalo pausado', async () => {
    const s = setup();
    const gym = await create(s, 'Gimnasio', { schedule: { cadence: 'MONTHLY', startDate: '2026-10-28' } });
    expect(dates(s, gym.id)).toEqual(['2026-10-28', '2026-11-28', '2026-12-28']);
    s.mem.setNow(noon('2026-10-10'));
    await s.defs.pause(await act(s, gym.id));
    expect(dates(s, gym.id, 'CANCELLED')).toEqual(['2026-10-28', '2026-11-28', '2026-12-28']);
    s.mem.setNow(noon('2026-12-01'));
    await s.defs.resume(await act(s, gym.id));
    expect(dates(s, gym.id, 'SCHEDULED')).toEqual(['2026-12-28', '2027-01-28', '2027-02-28']);
    expect(dates(s, gym.id, 'CANCELLED')).toEqual(['2026-10-28', '2026-11-28']);
    const changed = s.mem.eventsOf('commitments.RecurringDefinitionChanged').map((e) => e.payload);
    expect(changed.map((p) => p['transition'])).toEqual(['CREATE', 'PAUSE', 'RESUME']);
    expect((changed[1]?.['cancelledOccurrenceIds'] as string[]).length).toBe(3);
    expect((changed[2]?.['reinstatedOccurrenceIds'] as string[]).length).toBe(1);
    expect(await codeOf(async () => s.defs.resume(await act(s, gym.id)))).toBe('INVALID_STATUS_TRANSITION');
  });

  it('[TC-COMMITMENTS-RECUR-033] un máximo de 12 ocurrencias termina la definición tras la última', async () => {
    const s = setup();
    const course = await create(s, 'Curso de inglés', {
      amount: { type: 'FIXED', amount: bob('400.00') },
      schedule: { cadence: 'MONTHLY', startDate: '2026-10-15', maxOccurrences: 12 },
    });
    s.mem.setNow(noon('2027-09-15'));
    await s.job.runWorkspace(WS);
    expect(dates(s, course.id)).toHaveLength(12);
    expect(dates(s, course.id).at(-1)).toBe('2027-09-15');
    expect((await s.queries.getDefinition(WS, course.id)).status).toBe('ACTIVE');
    s.mem.setNow(noon('2027-09-16'));
    await s.job.runWorkspace(WS);
    expect((await s.queries.getDefinition(WS, course.id)).status).toBe('ENDED');
    expect(
      await codeOf(() =>
        create(s, 'X', {
          schedule: { cadence: 'MONTHLY', startDate: '2026-10-15', maxOccurrences: 3, endDate: '2027-01-01' },
        }),
      ),
    ).toBe('RECURRING_INVALID_SCHEDULE');
  });

  it('[TC-COMMITMENTS-RECUR-034] cambiar esta y las siguientes crea la versión 2 sin alterar lo resuelto', async () => {
    const s = setup();
    const rent = await create(s, 'Alquiler');
    for (const o of s.mem.forDefinition(rent.id).slice(0, 3)) {
      await s.occs.materialize({ workspaceId: WS, userId: USER, occurrenceId: o.id });
    }
    const result = await s.defs.revise({
      workspaceId: WS,
      userId: USER,
      definitionId: rent.id,
      expectedVersion: await version(s, rent.id),
      effectiveFrom: '2027-01-05',
      changes: { amount: { type: 'FIXED', amount: bob('3800.00') } },
    });
    expect(result.definition.currentVersionNo).toBe(2);
    expect(result).toMatchObject({ rewritten: 1, cancelled: 0, created: 0 });
    const rows = s.mem.forDefinition(rent.id);
    expect(rows.slice(0, 3).map((o) => [o.definitionVersionNo, o.expected.amount, o.status])).toEqual([
      [1, '3500.00', 'MATERIALIZED'],
      [1, '3500.00', 'MATERIALIZED'],
      [1, '3500.00', 'MATERIALIZED'],
    ]);
    expect(rows[3]).toMatchObject({ definitionVersionNo: 2, status: 'SCHEDULED' });
    expect(rows[3]?.expected.amount).toBe('3800.00');
    const revise = s.mem
      .eventsOf('commitments.RecurringDefinitionChanged')
      .find((e) => e.payload['transition'] === 'REVISE');
    expect(revise?.payload['rewrittenOccurrenceIds']).toEqual([rows[3]?.id]);
    expect([...s.mem.transactionsStore.values()].every((t) => t.amount.amount === '3500.00')).toBe(true);
  });

  it('[TC-COMMITMENTS-RECUR-035] una revisión anterior a una ocurrencia resuelta ⇒ RECURRING_REVISION_DATE_INVALID', async () => {
    const s = setup();
    const rent = await create(s, 'Alquiler');
    await s.occs.materialize({
      workspaceId: WS,
      userId: USER,
      occurrenceId: s.mem.forDefinition(rent.id)[1]!.id,
    });
    expect(
      await codeOf(async () =>
        s.defs.revise({
          workspaceId: WS,
          userId: USER,
          definitionId: rent.id,
          expectedVersion: await version(s, rent.id),
          effectiveFrom: '2026-10-05',
          changes: { amount: { type: 'FIXED', amount: bob('3800.00') } },
        }),
      ),
    ).toBe('RECURRING_REVISION_DATE_INVALID');
    expect((await s.queries.getDefinition(WS, rent.id)).currentVersionNo).toBe(1);
  });

  it('[TC-COMMITMENTS-RECUR-047] terminar con fecha cancela las posteriores y la definición pasa a ENDED al superarla', async () => {
    const s = setup();
    const internet = await create(s, 'Internet', {
      schedule: { cadence: 'MONTHLY', startDate: '2026-10-20' },
    });
    await s.occs.skip({
      workspaceId: WS,
      userId: USER,
      occurrenceId: s.mem.forDefinition(internet.id)[0]!.id,
    });
    await s.defs.end({ ...(await act(s, internet.id)), endDate: '2026-11-30' });
    expect(dates(s, internet.id, 'CANCELLED')).toEqual(['2026-12-20']);
    expect(dates(s, internet.id, 'SCHEDULED')).toEqual(['2026-11-20']);
    expect((await s.queries.getDefinition(WS, internet.id)).status).toBe('ACTIVE');
    s.mem.setNow(noon('2026-12-01'));
    await s.job.runWorkspace(WS);
    expect((await s.queries.getDefinition(WS, internet.id)).status).toBe('ENDED');
    // Las no resueltas anteriores al fin siguen resolubles.
    await s.occs.materialize({
      workspaceId: WS,
      userId: USER,
      occurrenceId: s.mem.forDefinition(internet.id).find((o) => o.occurrenceDate === '2026-11-20')!.id,
    });
  });

  it('terminar hoy deja ENDED al instante y una definición terminada no se revisa ni se reanuda', async () => {
    const s = setup();
    const def = await create(s, 'Internet', { schedule: { cadence: 'MONTHLY', startDate: '2026-10-20' } });
    await s.defs.end(await act(s, def.id));
    expect((await s.queries.getDefinition(WS, def.id)).status).toBe('ENDED');
    expect(await codeOf(async () => s.defs.resume(await act(s, def.id)))).toBe('INVALID_STATUS_TRANSITION');
    expect(
      await codeOf(async () =>
        s.defs.revise({
          ...(await act(s, def.id)),
          effectiveFrom: '2026-11-01',
          changes: { amount: { type: 'FIXED', amount: bob('1.00') } },
        }),
      ),
    ).toBe('INVALID_STATUS_TRANSITION');
  });

  it('[TC-COMMITMENTS-RECUR-048] cambiar el día cancela la vieja, genera la nueva y volver al 20 reinstaura sin duplicar', async () => {
    const s = setup();
    const internet = await create(s, 'Internet', {
      schedule: { cadence: 'MONTHLY', startDate: '2026-10-20' },
    });
    const first = await s.defs.revise({
      workspaceId: WS,
      userId: USER,
      definitionId: internet.id,
      expectedVersion: await version(s, internet.id),
      effectiveFrom: '2026-11-01',
      changes: { schedule: { cadence: 'MONTHLY', monthDays: [10] } },
    });
    expect(first).toMatchObject({ cancelled: 2 });
    expect(dates(s, internet.id, 'CANCELLED')).toEqual(['2026-11-20', '2026-12-20']);
    expect(s.mem.forDefinition(internet.id).find((o) => o.occurrenceDate === '2026-11-10')).toMatchObject({
      definitionVersionNo: 2,
      status: 'SCHEDULED',
    });
    const second = await s.defs.revise({
      workspaceId: WS,
      userId: USER,
      definitionId: internet.id,
      expectedVersion: await version(s, internet.id),
      effectiveFrom: '2026-11-01',
      changes: { schedule: { cadence: 'MONTHLY', monthDays: [20] } },
    });
    expect(second.reinstated).toBe(2);
    expect(dates(s, internet.id, 'CANCELLED')).toContain('2026-11-10');
    expect(dates(s, internet.id).filter((d) => d === '2026-11-20')).toHaveLength(1);
    expect(dates(s, internet.id, 'SCHEDULED')).toContain('2026-11-20');
  });

  it('revisar descarta las ediciones individuales de las reescritas e informa cuántas (D123)', async () => {
    const s = setup();
    const rent = await create(s, 'Alquiler');
    const dec = s.mem.forDefinition(rent.id).find((o) => o.occurrenceDate === '2026-12-05')!;
    await s.occs.edit({
      workspaceId: WS,
      userId: USER,
      occurrenceId: dec.id,
      expectedVersion: dec.version,
      expectedAmount: bob('3700.00'),
    });
    const result = await s.defs.revise({
      workspaceId: WS,
      userId: USER,
      definitionId: rent.id,
      expectedVersion: await version(s, rent.id),
      effectiveFrom: '2026-11-01',
      changes: { amount: { type: 'FIXED', amount: bob('3600.00') } },
    });
    expect(result.resetOverrides).toBe(1);
    expect(s.mem.occurrence(dec.id)).toMatchObject({ amountOverridden: false });
    expect(s.mem.occurrence(dec.id).expected.amount).toBe('3600.00');
  });

  it('[TC-COMMITMENTS-RECUR-041] el recorrido de la definición registra crear, pausar, reanudar y revisar con su versión', async () => {
    const s = setup();
    const rent = await create(s, 'Alquiler');
    s.mem.setNow(noon('2026-10-10'));
    await s.defs.pause(await act(s, rent.id));
    s.mem.setNow(noon('2026-10-12'));
    await s.defs.resume(await act(s, rent.id));
    await s.defs.revise({
      ...(await act(s, rent.id)),
      effectiveFrom: '2027-01-05',
      changes: { amount: { type: 'FIXED', amount: bob('3800.00') } },
    });
    const steps = s.mem
      .recordedFor(rent.id)
      .flatMap((r) => r.steps)
      .filter((st) => st.kind === 'TRANSITION')
      .map((st) => (st.kind === 'TRANSITION' ? st.transition : ''));
    expect(steps).toEqual(['CREATE', 'PAUSE', 'RESUME', 'REVISE']);
    const revise = s.mem.recordedFor(rent.id).at(-1)!.steps[0];
    expect(revise).toMatchObject({
      transition: 'REVISE',
      revisionFrom: 1,
      revisionTo: 2,
      reason: '2027-01-05',
    });
  });

  it('[TC-COMMITMENTS-RECUR-042] el recorrido de la ocurrencia: generar, próxima, edición como anotación y materializar', async () => {
    const s = setup();
    const def = await create(s, 'Internet', {
      amount: { type: 'FIXED', amount: bob('199.00') },
      schedule: { cadence: 'MONTHLY', startDate: '2026-10-20' },
    });
    const occ = s.mem.forDefinition(def.id)[0]!;
    s.mem.setNow(noon('2026-10-17'));
    await s.job.runWorkspace(WS);
    await s.occs.edit({
      workspaceId: WS,
      userId: USER,
      occurrenceId: occ.id,
      expectedVersion: s.mem.occurrence(occ.id).version,
      expectedAmount: bob('210.00'),
    });
    s.mem.setNow(noon('2026-10-20'));
    await s.occs.materialize({ workspaceId: WS, userId: USER, occurrenceId: occ.id });
    const steps = s.mem
      .recordedFor(occ.id)
      .flatMap((r) => r.steps)
      .map((st) => (st.kind === 'TRANSITION' ? st.transition : `ANNOTATION:${st.changedFields.join(',')}`));
    expect(steps).toEqual(['GENERATE', 'BECOME_DUE', 'ANNOTATION:expected', 'MATERIALIZE']);
    expect(s.mem.recordCalls[0]?.amount).toEqual(bob('210.00'));
    expect(await codeOf(() => s.occs.skip({ workspaceId: WS, userId: USER, occurrenceId: occ.id }))).toBe(
      'INVALID_STATUS_TRANSITION',
    );
  });
});

describe('Total comprometido y próximos pagos (FR-COMMITMENTS-011)', () => {
  async function october(s: S) {
    await create(s, 'Internet', {
      amount: { type: 'FIXED', amount: bob('199.00') },
      schedule: { cadence: 'MONTHLY', startDate: '2026-10-20' },
    });
    await create(s, 'Luz', {
      amount: { type: 'ESTIMATED', amount: bob('150.00') },
      schedule: { cadence: 'MONTHLY', startDate: '2026-10-25' },
    });
    await create(s, 'Gimnasio', {
      amount: { type: 'MIN_MAX', min: bob('100.00'), max: bob('180.00') },
      schedule: { cadence: 'MONTHLY', startDate: '2026-10-28' },
    });
    const rent = await create(s, 'Alquiler', { schedule: { cadence: 'MONTHLY', startDate: '2026-10-05' } });
    await s.occs.materialize({
      workspaceId: WS,
      userId: USER,
      occurrenceId: s.mem.forDefinition(rent.id)[0]!.id,
    });
    await create(
      s,
      'Sueldo',
      {
        amount: { type: 'FIXED', amount: bob('9000.00') },
        categoryId: null,
        schedule: { cadence: 'MONTHLY', startDate: '2026-10-30' },
      },
      'INCOME',
    );
    s.mem.addTransaction({
      kind: 'EXPENSE',
      accountId: BANK,
      amount: bob('250.00'),
      status: 'PENDING',
      businessDate: '2026-10-12',
    });
  }

  it('[TC-COMMITMENTS-RECUR-036] el comprometido de octubre suma ocurrencias no resueltas y pendientes sin doble conteo', async () => {
    const s = setup();
    await october(s);
    const committed = await s.queries.getCommitted(WS);
    expect(committed).toMatchObject({
      periodLabel: '2026-10',
      periodStart: '2026-10-01',
      periodEnd: '2026-10-31',
    });
    expect(committed.byCurrency).toEqual([
      { currency: 'BOB', occurrences: bob('529.00'), pending: bob('250.00'), total: bob('779.00') },
    ]);
    expect(committed.consolidated).toEqual({ amount: bob('779.00'), complete: true, unconverted: [] });
    expect(committed.expectedIncome).toEqual([bob('9000.00')]);
    expect(committed.withoutAmountCount).toBe(0);
    expect(committed.items.map((i) => i.name)).not.toContain('Alquiler');
  });

  it('[TC-COMMITMENTS-RECUR-037] sin tasa el consolidado queda incompleto e informa las ocurrencias sin monto', async () => {
    const s = setup();
    await october(s);
    await create(s, 'Spotify', {
      accountId: USD_BANK,
      categoryId: null,
      amount: { type: 'FIXED', amount: usd('5.99') },
      schedule: { cadence: 'MONTHLY', startDate: '2026-10-15' },
    });
    await create(s, 'Compra mayorista', {
      amount: { type: 'VARIABLE' },
      schedule: { cadence: 'MONTHLY', startDate: '2026-10-31' },
    });
    const committed = await s.queries.getCommitted(WS);
    expect(committed.consolidated).toEqual({
      amount: bob('779.00'),
      complete: false,
      unconverted: [usd('5.99')],
    });
    expect(committed.withoutAmountCount).toBe(1);
  });

  it('[TC-COMMITMENTS-RECUR-052] el multi-moneda se consolida en BOB con la tasa de valoración del Home', async () => {
    const s = setup();
    await october(s);
    await create(s, 'Spotify', {
      accountId: USD_BANK,
      categoryId: null,
      amount: { type: 'FIXED', amount: usd('5.99') },
      schedule: { cadence: 'MONTHLY', startDate: '2026-10-15' },
    });
    s.mem.rateTable.set('USD/BOB', '6.96');
    const committed = await s.queries.getCommitted(WS);
    expect(committed.byCurrency.map((c) => c.total)).toEqual([bob('779.00'), usd('5.99')]);
    expect(committed.consolidated).toEqual({ amount: bob('820.69'), complete: true, unconverted: [] });
    expect(committed.ratesUsed).toHaveLength(1);
  });

  it('D127: una transferencia entre cuentas líquidas no cuenta; a una no líquida (ahorro o tarjeta) sí', async () => {
    const s = setup();
    const common = {
      categoryId: null,
      amount: { type: 'FIXED' as const, amount: bob('500.00') },
      schedule: { cadence: 'MONTHLY', startDate: '2026-10-20' },
    };
    await create(s, 'A efectivo', { ...common, toAccountId: CASH }, 'TRANSFER');
    await create(s, 'A ahorro', { ...common, toAccountId: SAVINGS }, 'TRANSFER');
    await create(s, 'A tarjeta', { ...common, toAccountId: CARD }, 'TRANSFER');
    const range = await s.queries.getForRange({ workspaceId: WS, from: '2026-10-01', to: '2026-10-31' });
    expect(range.fromCommitments).toEqual([bob('1000.00')]);
    expect(range.items.map((i) => i.name).sort()).toEqual(['A ahorro', 'A tarjeta']);
    const upcoming = await s.queries.listUpcoming({ workspaceId: WS, through: '2026-10-31' });
    expect(upcoming.map((u) => u.definitionName).sort()).toEqual(['A ahorro', 'A tarjeta']);
  });

  it('[TC-COMMITMENTS-RECUR-038] los próximos 7 días listan atrasadas primero y excluyen vencimientos posteriores', async () => {
    const s = setup();
    await create(s, 'Luz', {
      amount: { type: 'ESTIMATED', amount: bob('150.00') },
      schedule: { cadence: 'MONTHLY', startDate: '2026-10-15' },
    });
    await create(s, 'Internet', {
      amount: { type: 'FIXED', amount: bob('199.00') },
      schedule: { cadence: 'MONTHLY', startDate: '2026-10-20' },
    });
    await create(s, 'Gimnasio', {
      amount: { type: 'MIN_MAX', min: bob('100.00'), max: bob('180.00') },
      schedule: { cadence: 'MONTHLY', startDate: '2026-10-28' },
    });
    s.mem.setNow(noon('2026-10-17'));
    await s.job.runWorkspace(WS);
    const page = await listOcc(s, { days: 7, limit: 50 });
    expect(page.data.map((o) => [o.definitionName, o.status])).toEqual([
      ['Luz', 'OVERDUE'],
      ['Internet', 'DUE'],
    ]);
    const contract = await s.queries.listUpcoming({ workspaceId: WS, through: '2026-10-24' });
    expect(contract.map((u) => u.definitionName)).toEqual(['Luz', 'Internet']);
  });

  it('listResolvedOutflows excluye las transacciones anuladas y hasActiveDefinitions responde por el workspace', async () => {
    const s = setup();
    expect(await s.queries.hasActiveDefinitions({ workspaceId: WS })).toBe(false);
    const rent = await create(s, 'Alquiler');
    expect(await s.queries.hasActiveDefinitions({ workspaceId: WS })).toBe(true);
    const [a, b] = s.mem.forDefinition(rent.id);
    const first = await s.occs.materialize({ workspaceId: WS, userId: USER, occurrenceId: a!.id });
    await s.occs.materialize({ workspaceId: WS, userId: USER, occurrenceId: b!.id });
    s.mem.voidTransaction(first.transactionId);
    const resolved = await s.queries.listResolvedOutflows({
      workspaceId: WS,
      from: '2026-10-01',
      to: '2026-12-31',
    });
    expect(resolved).toHaveLength(1);
    expect(resolved[0]).toMatchObject({
      definitionName: 'Alquiler',
      resolution: 'MATERIALIZED',
      amount: bob('3500.00'),
    });
  });
});

describe('Rendimiento de la generación (NFR-PERF-009)', () => {
  it('[TC-COMMITMENTS-RECUR-017] 60 definiciones (20 diarias, 20 semanales y 20 mensuales) con horizonte de 90 días se generan en 10 s o menos (dobles en memoria; contra PostgreSQL: apps/api/test/perf/commitments.perf.ts)', async () => {
    const s = setup();
    for (const cadence of ['DAILY', 'WEEKLY', 'MONTHLY'] as const) {
      for (let i = 0; i < 20; i += 1) {
        await create(s, `${cadence} ${i}`, {
          amount: { type: 'FIXED', amount: bob('10.00') },
          schedule: { cadence, startDate: '2026-10-09' },
        });
      }
    }
    const started = Date.now();
    s.mem.setNow(noon('2026-11-09'));
    const result = await s.job.runWorkspace(WS);
    const elapsed = Date.now() - started;
    expect(result.failed).toEqual([]);
    expect(result.definitions).toBe(60);
    expect(result.generated).toBeGreaterThan(20 * 30);
    expect(elapsed).toBeLessThanOrEqual(10_000);
  });
});
