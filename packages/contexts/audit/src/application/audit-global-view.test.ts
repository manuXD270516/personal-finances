import { FixedClock, Instant } from '@pf/shared-kernel';
import { beforeEach, describe, expect, it } from 'vitest';
import type { AuditEntry } from '../contracts/index.js';
import { RedactionPolicy } from '../domain/redaction-policy.js';
import { AuditLogExporter, AUDIT_CSV_COLUMNS, MAX_EXPORT_ROWS } from './audit-export.js';
import { AuditQueries } from './audit-queries.js';
import { AuditRecorder } from './audit-recorder.js';
import { InMemoryAudit, fixedTimeZones, sequentialIds, sha256IpHasher } from './testing/in-memory.js';

const U1 = '0190a000-0000-7000-8000-000000000001';
const U2 = '0190a000-0000-7000-8000-000000000002';
const OWNER = '0190a000-0000-7000-8000-000000000009';
const W1 = '0190a000-0000-7000-8000-0000000000a1';
const W2 = '0190a000-0000-7000-8000-0000000000a2';
const ACCOUNT = '0190a000-0000-7000-8000-0000000000ac';
const B1 = '0190a000-0000-7000-8000-0000000000b1';
const B2 = '0190a000-0000-7000-8000-0000000000b2';
const tx = (n: number) => `0190a000-0000-7000-8000-0000000001${n.toString(16).padStart(2, '0')}`;

let mem: InMemoryAudit;
let clock: FixedClock;
let recorder: AuditRecorder;
let queries: AuditQueries;

beforeEach(() => {
  mem = new InMemoryAudit();
  mem.ambientContext = { actor: { type: 'USER', userId: OWNER }, origin: 'ui' };
  clock = new FixedClock(Instant.parse('2026-03-02T14:00:00Z'));
  recorder = new AuditRecorder({
    env: mem,
    store: mem,
    ipHasher: sha256IpHasher,
    ids: sequentialIds(),
    clock,
    policy: new RedactionPolicy({
      Transaction: { description: 'plain', categoryId: 'plain', amount: 'money' },
      Account: { archived: 'plain', name: 'plain' },
      Workspace: { operationId: 'plain', code: 'plain', name: 'plain' },
      User: {},
      AuditLogExport: {
        format: 'plain',
        rowCount: 'plain',
        actorUserId: 'plain',
        from: 'plain',
        to: 'plain',
        category: 'plain',
      },
    }),
  });
  queries = new AuditQueries({ uow: mem, store: mem, timeZones: fixedTimeZones('America/La_Paz') });
});

/** Escribe una entrada en W1 y avanza el reloj 1 minuto (instantes distintos y ordenados). */
const write = (entry: Omit<AuditEntry, 'workspaceId'>, workspaceId = W1) =>
  mem.run({ workspaceId }, async () => {
    await recorder.append({ workspaceId, ...entry });
    clock.advance(60_000);
  });

const txEvent = (n: number, actor: string, extra: Partial<AuditEntry> = {}) =>
  write({
    action: 'transactions.transaction.updated',
    aggregateType: 'Transaction',
    aggregateId: tx(n),
    actor: { type: 'USER', userId: actor },
    changes: [{ field: 'description', before: 'a', after: `b${n}` }],
    ...extra,
  });

describe('[TC-AUDIT-GLOBAL-001] la consulta global combina filtros por actor, entidad y rango', () => {
  beforeEach(async () => {
    clock.set(Instant.parse('2026-03-05T15:00:00Z'));
    await txEvent(1, U1);
    await txEvent(2, U2);
    await txEvent(3, U1);
    await write({
      action: 'accounts.account.archived',
      aggregateType: 'Account',
      aggregateId: ACCOUNT,
      actor: { type: 'USER', userId: U1 },
      changes: [{ field: 'archived', before: false, after: true }],
    });
    await txEvent(4, U2);
    await txEvent(5, U1);
    // Fuera de marzo.
    clock.set(Instant.parse('2026-04-02T15:00:00Z'));
    await txEvent(6, U1);
  });

  it('actor U1, transacciones y marzo: solo sus 3 registros, del más reciente al más antiguo', async () => {
    const rows = await queries.list({
      userId: OWNER,
      workspaceId: W1,
      actorUserId: U1,
      aggregateType: 'Transaction',
      from: '2026-03-01',
      to: '2026-03-31',
      limit: 50,
    });
    expect(rows.map((r) => r.aggregateId)).toEqual([tx(5), tx(3), tx(1)]);
    expect(rows.every((r) => r.actor.userId === U1)).toBe(true);
  });

  it('el cursor es estable: página de 2 y luego el resto sin repetir ni omitir', async () => {
    const filters = {
      userId: OWNER,
      workspaceId: W1,
      actorUserId: U1,
      aggregateType: 'Transaction',
    } as const;
    const page1 = await queries.list({ ...filters, from: '2026-03-01', to: '2026-03-31', limit: 2 });
    const last = page1.at(-1)!;
    const page2 = await queries.list({
      ...filters,
      from: '2026-03-01',
      to: '2026-03-31',
      limit: 2,
      after: { occurredAt: last.occurredAt.toString(), id: last.id },
    });
    expect([...page1, ...page2].map((r) => r.aggregateId)).toEqual([tx(5), tx(3), tx(1)]);
  });

  it('combina acción exacta (lista) y origen', async () => {
    const byAction = await queries.list({
      userId: OWNER,
      workspaceId: W1,
      action: ['accounts.account.archived', 'accounts.account.opened'],
      limit: 50,
    });
    expect(byAction.map((r) => r.action)).toEqual(['accounts.account.archived']);
    expect(await queries.list({ userId: OWNER, workspaceId: W1, origin: 'import', limit: 50 })).toEqual([]);
    expect(
      (await queries.list({ userId: OWNER, workspaceId: W1, origin: 'ui', limit: 50 })).length,
    ).toBeGreaterThan(0);
  });

  it('nunca devuelve registros de otro workspace (aislamiento)', async () => {
    expect(await queries.list({ userId: OWNER, workspaceId: W2, actorUserId: U1, limit: 50 })).toEqual([]);
  });

  it('valida los filtros: ids, acción, origen y categoría mal formados son VALIDATION_FAILED', async () => {
    const base = { userId: OWNER, workspaceId: W1, limit: 10 } as const;
    await expect(queries.list({ ...base, actorUserId: 'no-uuid' })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    await expect(queries.list({ ...base, correlationId: 'no-uuid' })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    await expect(queries.list({ ...base, action: ['NoEsAccion'] })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    await expect(queries.list({ ...base, origin: 'otro' })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    await expect(queries.list({ ...base, category: 'OTHER' })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
  });

  it('un rango de más de 366 días sin aggregateId ni correlationId es VALIDATION_FAILED; con ellos, no', async () => {
    const long = { userId: OWNER, workspaceId: W1, from: '2025-01-01', to: '2026-03-31', limit: 10 } as const;
    await expect(queries.list(long)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    // 2025-03-30..2026-03-31 son 367 días (rechazado); 2025-03-31..2026-03-31, 366 (el máximo, permitido).
    await expect(queries.list({ ...long, from: '2025-03-30', to: '2026-03-31' })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    await expect(queries.list({ ...long, from: '2025-03-31', to: '2026-03-31' })).resolves.toBeDefined();
    await expect(queries.list({ ...long, correlationId: B1 })).resolves.toEqual([]);
    await expect(
      queries.list({ ...long, aggregateType: 'Transaction', aggregateId: tx(1) }),
    ).resolves.toBeDefined();
  });
});

describe('[TC-AUDIT-GLOBAL-007] filtrar por correlación devuelve todos los registros de una edición masiva', () => {
  it('los 3 registros por transacción y el agregado de B1, y ninguno de B2', async () => {
    for (const n of [1, 2, 3]) {
      await txEvent(n, OWNER, { action: 'transactions.transaction.bulk_edited', correlationId: B1 });
    }
    await write({
      action: 'transactions.transaction.bulk_edited',
      aggregateType: 'BulkOperation',
      aggregateId: B1,
      actor: { type: 'USER', userId: OWNER },
      correlationId: B1,
    });
    for (const n of [4, 5]) {
      await txEvent(n, OWNER, { action: 'transactions.transaction.bulk_edited', correlationId: B2 });
    }
    const rows = await queries.list({ userId: OWNER, workspaceId: W1, correlationId: B1, limit: 50 });
    expect(rows).toHaveLength(4);
    expect(rows.every((r) => r.correlationId === B1)).toBe(true);
    expect(rows.map((r) => r.aggregateId).sort()).toEqual([B1, tx(1), tx(2), tx(3)].sort());
    expect(rows.some((r) => r.correlationId === B2)).toBe(false);
  });
});

describe('[TC-AUDIT-GLOBAL-006] la vista de seguridad muestra solo eventos de seguridad', () => {
  it('2 inicios de sesión, 1 fallo de autorización y el export; ninguna transacción', async () => {
    for (const action of ['identity.session.started', 'identity.session.started']) {
      await write({ action, aggregateType: 'User', aggregateId: U1, actor: { type: 'USER', userId: U1 } });
    }
    await write({
      action: 'security.authorization.denied',
      aggregateType: 'Workspace',
      aggregateId: W1,
      actor: { type: 'USER', userId: U2 },
      changes: [
        { field: 'operationId', before: null, after: 'createTransaction' },
        { field: 'code', before: null, after: 'INSUFFICIENT_ROLE' },
      ],
    });
    await write({
      action: 'audit.log.exported',
      aggregateType: 'AuditLogExport',
      aggregateId: W1,
      actor: { type: 'USER', userId: OWNER },
    });
    for (let n = 1; n <= 10; n += 1) await txEvent(n, U1);

    const security = await queries.list({ userId: OWNER, workspaceId: W1, category: 'SECURITY', limit: 50 });
    expect(security.map((r) => r.action).sort()).toEqual([
      'audit.log.exported',
      'identity.session.started',
      'identity.session.started',
      'security.authorization.denied',
    ]);
    const data = await queries.list({ userId: OWNER, workspaceId: W1, category: 'DATA', limit: 50 });
    expect(data).toHaveLength(10);
    expect(data.every((r) => r.action === 'transactions.transaction.updated')).toBe(true);
  });
});

describe('[TC-AUDIT-GLOBAL-003] exportación CSV del log', () => {
  let exporter: AuditLogExporter;
  beforeEach(() => {
    exporter = new AuditLogExporter({
      uow: mem,
      store: mem,
      timeZones: fixedTimeZones('America/La_Paz'),
      audit: recorder,
    });
  });
  const text = (body: Uint8Array) => new TextDecoder('utf-8', { ignoreBOM: true }).decode(body);

  it('instante con desfase de la zona del workspace, descripción neutralizada y una fila por registro; queda auditada', async () => {
    clock.set(Instant.parse('2026-03-16T03:30:00Z')); // 2026-03-15T23:30:00-04:00
    await write({
      action: 'transactions.transaction.updated',
      aggregateType: 'Transaction',
      aggregateId: tx(1),
      actor: { type: 'USER', userId: U1 },
      changes: [{ field: 'description', before: '=SUM(A1)', after: 'Compra' }],
    });
    clock.set(Instant.parse('2026-03-20T15:00:00Z'));
    await txEvent(2, U1);

    const file = await mem.run({ workspaceId: W1 }, () =>
      exporter.export({
        userId: OWNER,
        workspaceId: W1,
        from: '2026-03-01',
        to: '2026-03-31',
        actorUserId: U1,
      }),
    );
    const csv = text(file.body);
    expect(csv.startsWith('﻿')).toBe(true);
    const lines = csv.slice(1).trimEnd().split('\r\n');
    expect(lines[0]).toBe(AUDIT_CSV_COLUMNS.join(','));
    expect(lines).toHaveLength(3); // encabezado + 2 registros
    expect(csv).toContain('2026-03-15T23:30:00-04:00');
    expect(csv).toContain("description: '=SUM(A1) → Compra");
    expect(csv).not.toContain(',=SUM');
    expect(file.contentType).toBe('text/csv; charset=utf-8');
    expect(file.fileName).toBe(`audit-${W1}-2026-03-01-2026-03-31.csv`);

    const exported = mem.rows.filter((r) => r.action === 'audit.log.exported');
    expect(exported).toHaveLength(1);
    expect(exported[0]?.actor.userId).toBe(OWNER);
    expect(exported[0]?.aggregateType).toBe('AuditLogExport');
    expect(exported[0]?.changes).toEqual(
      expect.arrayContaining([
        { field: 'rowCount', before: null, after: 2 },
        { field: 'actorUserId', before: null, after: U1 },
        { field: 'from', before: null, after: '2026-03-01' },
        { field: 'to', before: null, after: '2026-03-31' },
      ]),
    );
  });

  it('los montos salen como decimal string y los valores nulos como celdas vacías', async () => {
    await write({
      action: 'transactions.transaction.updated',
      aggregateType: 'Transaction',
      aggregateId: tx(1),
      actor: { type: 'USER', userId: U1 },
      changes: [{ field: 'amount', before: null, after: { amount: '45.90', currency: 'BOB' } }],
    });
    const file = await mem.run({ workspaceId: W1 }, () =>
      exporter.export({ userId: OWNER, workspaceId: W1 }),
    );
    expect(text(file.body)).toContain('amount:  → 45.90 BOB');
  });

  it('más de 50000 registros: VALIDATION_FAILED y nada auditado', async () => {
    const src = AuditRecorder.prototype; // (no se usa: se siembra el almacén directamente)
    void src;
    await txEvent(1, U1);
    const template = mem.rows[0]!;
    const seeded = Array.from({ length: MAX_EXPORT_ROWS }, () => template);
    mem.rows.push(...seeded); // 50001 filas en total
    await expect(
      mem.run({ workspaceId: W1 }, () => exporter.export({ userId: OWNER, workspaceId: W1 })),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(mem.rows.some((r) => r.action === 'audit.log.exported')).toBe(false);
  }, 30_000);

  it('exactamente 50000 registros sí se exportan', async () => {
    await txEvent(1, U1);
    const template = mem.rows[0]!;
    mem.rows.push(...Array.from({ length: MAX_EXPORT_ROWS - 1 }, () => template));
    const file = await mem.run({ workspaceId: W1 }, () =>
      exporter.export({ userId: OWNER, workspaceId: W1 }),
    );
    expect(file.rowCount).toBe(MAX_EXPORT_ROWS);
    // Genera 50 000 filas CSV: en CI tarda ~9 s, por encima del timeout por defecto de 5 s.
  }, 30_000);

  it('si la auditoría de la exportación falla, no hay descarga', async () => {
    await txEvent(1, U1);
    mem.failInserts = true;
    await expect(
      mem.run({ workspaceId: W1 }, () => exporter.export({ userId: OWNER, workspaceId: W1 })),
    ).rejects.toThrow('audit store unavailable');
  });
});
