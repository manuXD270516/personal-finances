import { FixedClock, Instant } from '@pf/shared-kernel';
import fc from 'fast-check';
import { beforeEach, describe, expect, it } from 'vitest';
import type { AuditEntry, LifecycleMachineDto, LifecycleStepInput } from '../contracts/index.js';
import { AuditRecord } from '../domain/audit-record.js';
import { RedactionPolicy } from '../domain/redaction-policy.js';
import { AuditRecorder } from './audit-recorder.js';
import { LifecycleBackfill } from './lifecycle-backfill.js';
import { LifecycleQueries } from './lifecycle-queries.js';
import { LifecycleRecorder } from './lifecycle-recorder.js';
import { InMemoryAudit, sequentialIds, sha256IpHasher } from './testing/in-memory.js';

const U1 = '0190a000-0000-7000-8000-000000000001';
const W1 = '0190a000-0000-7000-8000-0000000000a1';
const W2 = '0190a000-0000-7000-8000-0000000000a2';
const T1 = '0190a000-0000-7000-8000-0000000000f1';
const T2 = '0190a000-0000-7000-8000-0000000000f2';
const E1 = '0190a000-0000-7000-8000-0000000000e1';
const E2 = '0190a000-0000-7000-8000-0000000000e2';
const E3 = '0190a000-0000-7000-8000-0000000000e3';
const EV = '0190a000-0000-7000-8000-0000000000b1';

const MACHINE: LifecycleMachineDto = {
  aggregateType: 'Transaction',
  machineVersion: 1,
  states: [
    { code: 'PENDING', terminal: false },
    { code: 'POSTED', terminal: false },
    { code: 'CLEARED', terminal: false },
    { code: 'RECONCILED', terminal: false },
    { code: 'VOIDED', terminal: true },
  ],
  transitions: [],
};

let mem: InMemoryAudit;
let clock: FixedClock;
let lifecycle: LifecycleRecorder;
let queries: LifecycleQueries;

beforeEach(() => {
  mem = new InMemoryAudit();
  clock = new FixedClock(Instant.parse('2026-03-10T14:00:00Z'));
  const ids = sequentialIds();
  const audit = new AuditRecorder({
    env: mem,
    store: mem,
    ipHasher: sha256IpHasher,
    ids,
    clock,
    policy: new RedactionPolicy({ Transaction: { status: 'plain', journalEntryId: 'plain' } }),
  });
  lifecycle = new LifecycleRecorder({ audit, env: mem, store: mem, ids, clock });
  queries = new LifecycleQueries({ uow: mem, store: mem, machines: [MACHINE] });
  mem.ambientContext = { actor: { type: 'USER', userId: U1 }, origin: 'ui' };
});

const entry = (action: string, over: Partial<AuditEntry> = {}): AuditEntry => ({
  workspaceId: W1,
  action,
  aggregateType: 'Transaction',
  aggregateId: T1,
  aggregateVersion: 2,
  ...over,
});

const step = (
  transition: string,
  fromState: string | null,
  toState: string,
  over: Partial<LifecycleStepInput> = {},
): LifecycleStepInput =>
  ({ kind: 'TRANSITION', transition, fromState, toState, machineVersion: 1, ...over }) as LifecycleStepInput;

describe('LifecyclePort (registro de transición atómico, add-lifecycle-timeline)', () => {
  it('[TC-AUDIT-LIFECYCLE-002] el posteo escribe la auditoría y la transición POST que la referencia, con su asiento y evento', async () => {
    await mem.run({ workspaceId: W1 }, () =>
      lifecycle.record(entry('transactions.transaction.posted'), [
        step('POST', 'PENDING', 'POSTED', {
          journalEntries: { posted: E1 },
          events: [{ eventId: EV, eventType: 'transactions.TransactionPosted.v1' }],
        }),
      ]),
    );
    expect(mem.rows).toHaveLength(1);
    expect(mem.lifecycle).toHaveLength(1);
    const t = mem.lifecycle[0]!;
    expect(t).toMatchObject({
      sequence: 1,
      kind: 'TRANSITION',
      transition: 'POST',
      fromState: 'PENDING',
      toState: 'POSTED',
      auditLogId: mem.rows[0]!.id,
      journalEntries: { reversed: null, reversal: null, posted: E1 },
      eventIds: [EV],
      eventTypes: ['transactions.TransactionPosted.v1'],
      origin: 'ui',
      derived: false,
    });
    expect(t.actor).toMatchObject({ type: 'USER', userId: U1 });
    expect(t.occurredAt.toString()).toBe('2026-03-10T14:00:00.000Z');
  });

  it('[TC-AUDIT-LIFECYCLE-002] si la escritura de la transición falla, nada persiste (ni la auditoría)', async () => {
    mem.failLifecycleInserts = true;
    const effects: string[] = [];
    await expect(
      mem.run({ workspaceId: W1 }, async () => {
        effects.push('asiento');
        await lifecycle.record(entry('transactions.transaction.posted'), [step('POST', 'PENDING', 'POSTED')]);
      }),
    ).rejects.toThrow('fault injected');
    expect(mem.rows).toHaveLength(0);
    expect(mem.lifecycle).toHaveLength(0);
    // Fuera de la unidad de trabajo no se escribe nada.
    mem.failLifecycleInserts = false;
    await expect(
      lifecycle.record(entry('transactions.transaction.posted'), [step('POST', 'PENDING', 'POSTED')]),
    ).rejects.toMatchObject({ code: 'AUDIT_OUTSIDE_UNIT_OF_WORK' });
  });

  it('[TC-AUDIT-LIFECYCLE-004] una anotación lleva solo los campos cambiados (sin estado ni motivo)', async () => {
    await mem.run({ workspaceId: W1 }, () =>
      lifecycle.record(entry('transactions.transaction.updated', { reason: null }), [
        { kind: 'ANNOTATION', changedFields: ['splits', 'splits', 'description'] },
      ]),
    );
    expect(mem.lifecycle[0]).toMatchObject({
      kind: 'ANNOTATION',
      transition: null,
      toState: null,
      changedFields: ['splits', 'description'],
    });
  });

  it('[TC-AUDIT-LIFECYCLE-005] el recorrido ordena las transiciones, calcula el camino y adjunta la máquina', async () => {
    const steps: [string, string | null, string, Partial<LifecycleStepInput>][] = [
      ['RECORD', null, 'PENDING', { revisionTo: 1 }],
      ['POST', 'PENDING', 'POSTED', { journalEntries: { posted: E1 } }],
      ['CLEAR', 'POSTED', 'CLEARED', {}],
      [
        'REVISE',
        'CLEARED',
        'POSTED',
        { revisionFrom: 1, revisionTo: 2, journalEntries: { reversed: E1, reversal: E2, posted: E3 } },
      ],
      ['VOID', 'POSTED', 'VOIDED', { reason: 'duplicado' }],
    ];
    for (const [code, from, to, extra] of steps) {
      clock.advance(60 * 60 * 1000);
      await mem.run({ workspaceId: W1 }, () =>
        lifecycle.record(entry(`transactions.transaction.${code.toLowerCase()}`), [
          step(code, from, to, extra),
        ]),
      );
    }
    const view = await queries.lifecycleOf({
      userId: U1,
      workspaceId: W1,
      aggregateType: 'Transaction',
      aggregateId: T1,
      currentState: 'VOIDED',
    });
    expect(view.currentState).toBe('VOIDED');
    expect(view.path).toEqual(['PENDING', 'POSTED', 'CLEARED', 'POSTED', 'VOIDED']);
    expect(view.historyComplete).toBe(true);
    expect(view.machine).toBe(MACHINE);
    expect(view.items.map((i) => [i.sequence, i.kind === 'TRANSITION' ? i.transition : null])).toEqual([
      [1, 'RECORD'],
      [2, 'POST'],
      [3, 'CLEAR'],
      [4, 'REVISE'],
      [5, 'VOID'],
    ]);
    const revise = view.items[3]!;
    expect(revise).toMatchObject({
      revisionFrom: 1,
      revisionTo: 2,
      journalEntries: { reversed: E1, reversal: E2, posted: E3 },
      actor: { type: 'USER', id: U1, displayName: null },
      origin: 'ui',
    });
    expect(view.items[4]).toMatchObject({ reason: 'duplicado', occurredAt: '2026-03-10T19:00:00.000Z' });
  });

  it('[TC-AUDIT-LIFECYCLE-006] desde otro workspace el recorrido de W1 queda vacío (RLS)', async () => {
    await mem.run({ workspaceId: W1 }, () =>
      lifecycle.record(entry('transactions.transaction.created'), [step('RECORD', null, 'POSTED')]),
    );
    const foreign = await queries.lifecycleOf({
      userId: U1,
      workspaceId: W2,
      aggregateType: 'Transaction',
      aggregateId: T1,
      currentState: null,
    });
    expect(foreign.items).toEqual([]);
    expect(foreign.historyComplete).toBe(false);
  });

  it('[TC-AUDIT-LIFECYCLE-002] PBT: las transiciones son append-only con sequence 1..n consecutiva por agregado', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(fc.constantFrom(T1, T2), { minLength: 1, maxLength: 12 }), async (ids) => {
        const local = new InMemoryAudit();
        local.ambientContext = { actor: { type: 'USER', userId: U1 } };
        const seq = sequentialIds('0190a000-0000-7000-8001-');
        const audit = new AuditRecorder({
          env: local,
          store: local,
          ipHasher: sha256IpHasher,
          ids: seq,
          clock,
          policy: new RedactionPolicy({}),
        });
        const rec = new LifecycleRecorder({ audit, env: local, store: local, ids: seq, clock });
        for (const id of ids) {
          await local.run({ workspaceId: W1 }, () =>
            rec.record(entry('transactions.transaction.updated', { aggregateId: id }), [
              { kind: 'ANNOTATION', changedFields: ['description'] },
            ]),
          );
        }
        for (const id of [T1, T2]) {
          const own = local.lifecycle.filter((e) => e.aggregateId === id).map((e) => e.sequence);
          expect(own).toEqual(own.map((_, i) => i + 1));
          expect(own).toHaveLength(ids.filter((x) => x === id).length);
        }
        expect(Object.isFrozen(local.lifecycle[0])).toBe(true);
      }),
      { numRuns: 50 },
    );
  });
});

describe('Reconstrucción desde la auditoría (job audit.lifecycle-backfill)', () => {
  const audit = (
    id: string,
    aggregateId: string,
    action: string,
    at: string,
    changes: unknown[],
    reason?: string,
  ) =>
    AuditRecord.create({
      id,
      workspaceId: W1,
      occurredAt: Instant.parse(at),
      actor: { type: 'USER', userId: U1 },
      action,
      aggregateType: 'Transaction',
      aggregateId,
      aggregateVersion: 1,
      changes: changes as never,
      reason: reason ?? null,
      origin: 'ui',
      correlationId: id,
      requestId: null,
      idempotencyKey: null,
      clientIpHash: null,
      userAgent: null,
    });

  it('[TC-AUDIT-LIFECYCLE-011] un gasto de 60.00 BOB creado y anulado se reconstruye como RECORD y VOID derivadas; sin creación, historia incompleta; idempotente', async () => {
    mem.rows.push(
      audit(
        '0190a000-0000-7000-8000-00000000aa01',
        T1,
        'transactions.transaction.created',
        '2026-01-05T12:00:00Z',
        [
          { field: 'status', before: null, after: 'POSTED' },
          { field: 'amount', before: null, after: { amount: '60.00', currency: 'BOB' } },
          { field: 'journalEntryId', before: null, after: E1 },
        ],
      ),
      audit(
        '0190a000-0000-7000-8000-00000000aa02',
        T1,
        'transactions.transaction.voided',
        '2026-01-06T12:00:00Z',
        [
          { field: 'status', before: 'POSTED', after: 'VOIDED' },
          { field: 'journalEntryId', before: E1, after: E2 },
        ],
        'duplicado',
      ),
      // Gasto 2: su primer registro es una edición (sin creación): no se inventa nada.
      audit(
        '0190a000-0000-7000-8000-00000000aa03',
        T2,
        'transactions.transaction.updated',
        '2026-01-07T12:00:00Z',
        [{ field: 'description', before: 'a', after: 'b' }],
      ),
    );
    const job = new LifecycleBackfill({
      uow: { run: (ws, fn) => mem.run({ workspaceId: ws }, fn) },
      source: mem,
      store: mem,
      ids: sequentialIds('0190a000-0000-7000-8002-'),
      batchSize: 1,
    });
    const first = await job.run(W1);
    expect(first).toEqual({ aggregates: 2, derived: 3 });
    const again = await job.run(W1);
    expect(again).toEqual({ aggregates: 0, derived: 0 });
    expect(mem.lifecycle).toHaveLength(3);

    const g1 = await queries.lifecycleOf({
      userId: U1,
      workspaceId: W1,
      aggregateType: 'Transaction',
      aggregateId: T1,
      currentState: 'VOIDED',
    });
    expect(
      g1.items.map((i) => (i.kind === 'TRANSITION' ? [i.transition, i.fromState, i.toState] : [])),
    ).toEqual([
      ['RECORD', null, 'POSTED'],
      ['VOID', 'POSTED', 'VOIDED'],
    ]);
    expect(g1.items.every((i) => i.derived)).toBe(true);
    expect(g1.historyComplete).toBe(true);
    expect(g1.items[1]).toMatchObject({
      reason: 'duplicado',
      journalEntries: { reversed: E1, reversal: E2, posted: null },
      occurredAt: '2026-01-06T12:00:00.000Z',
    });

    const g2 = await queries.lifecycleOf({
      userId: U1,
      workspaceId: W1,
      aggregateType: 'Transaction',
      aggregateId: T2,
      currentState: 'POSTED',
    });
    expect(g2.historyComplete).toBe(false);
    expect(g2.path).toEqual([]);
    expect(g2.items).toEqual([
      expect.objectContaining({ kind: 'ANNOTATION', changedFields: ['description'] }),
    ]);
  });
});

describe('Reconstrucción de categorías y contrapartes (docs/31 D52, tarea 9.3)', () => {
  const CP = '0190a000-0000-7000-8000-0000000000d1';
  const CAT = '0190a000-0000-7000-8000-0000000000d2';
  const record = (
    id: string,
    aggregateType: string,
    aggregateId: string,
    action: string,
    at: string,
    changes: unknown[],
  ) =>
    AuditRecord.create({
      id,
      workspaceId: W1,
      occurredAt: Instant.parse(at),
      actor: { type: 'USER', userId: U1 },
      action,
      aggregateType,
      aggregateId,
      aggregateVersion: 1,
      changes: changes as never,
      reason: null,
      origin: 'ui',
      correlationId: id,
      requestId: null,
      idempotencyKey: null,
      clientIpHash: null,
      userAgent: null,
    });

  it('[TC-AUDIT-LIFECYCLE-019] "Entel" creada y archivada antes del registro: CREATE y ARCHIVE derivadas, historia completa; idempotente', async () => {
    mem.rows.push(
      record(
        '0190a000-0000-7000-8000-00000000ab01',
        'Counterparty',
        CP,
        'classification.counterparty.created',
        '2026-01-05T12:00:00Z',
        [
          { field: 'name', before: null, after: 'Entel' },
          { field: 'status', before: null, after: 'ACTIVE' },
        ],
      ),
      record(
        '0190a000-0000-7000-8000-00000000ab02',
        'Counterparty',
        CP,
        'classification.counterparty.updated',
        '2026-01-06T12:00:00Z',
        [{ field: 'aliases', before: '', after: 'ENTEL S.A.' }],
      ),
      record(
        '0190a000-0000-7000-8000-00000000ab03',
        'Counterparty',
        CP,
        'classification.counterparty.archived',
        '2026-01-07T12:00:00Z',
        [{ field: 'status', before: 'ACTIVE', after: 'ARCHIVED' }],
      ),
      // Categoría provisionada antes de D52 (sin registro de creación): solo su archivo ⇒ anotación, sin inventar.
      record(
        '0190a000-0000-7000-8000-00000000ab04',
        'Category',
        CAT,
        'classification.category.updated',
        '2026-01-08T12:00:00Z',
        [{ field: 'color', before: null, after: '#2E7D32' }],
      ),
    );
    const machine = (aggregateType: string): LifecycleMachineDto => ({
      aggregateType,
      machineVersion: 1,
      states: [
        { code: 'ACTIVE', terminal: false },
        { code: 'ARCHIVED', terminal: false },
      ],
      transitions: [],
    });
    const q = new LifecycleQueries({
      uow: mem,
      store: mem,
      machines: [machine('Counterparty'), machine('Category')],
    });
    const job = new LifecycleBackfill({
      uow: { run: (ws, fn) => mem.run({ workspaceId: ws }, fn) },
      source: mem,
      store: mem,
      ids: sequentialIds('0190a000-0000-7000-8003-'),
    });
    expect(await job.run(W1)).toEqual({ aggregates: 2, derived: 4 });
    expect(await job.run(W1)).toEqual({ aggregates: 0, derived: 0 });
    const entel = await q.lifecycleOf({
      userId: U1,
      workspaceId: W1,
      aggregateType: 'Counterparty',
      aggregateId: CP,
      currentState: 'ARCHIVED',
    });
    expect(
      entel.items.map((i) =>
        i.kind === 'TRANSITION' ? [i.transition, i.fromState, i.toState] : i.changedFields,
      ),
    ).toEqual([['CREATE', null, 'ACTIVE'], ['aliases'], ['ARCHIVE', 'ACTIVE', 'ARCHIVED']]);
    expect(entel.items.every((i) => i.derived)).toBe(true);
    expect(entel).toMatchObject({
      historyComplete: true,
      currentState: 'ARCHIVED',
      path: ['ACTIVE', 'ARCHIVED'],
    });
    const cat = await q.lifecycleOf({
      userId: U1,
      workspaceId: W1,
      aggregateType: 'Category',
      aggregateId: CAT,
      currentState: 'ACTIVE',
    });
    expect(cat.items.map((i) => i.kind)).toEqual(['ANNOTATION']);
    expect(cat.historyComplete).toBe(false);
  });
});
