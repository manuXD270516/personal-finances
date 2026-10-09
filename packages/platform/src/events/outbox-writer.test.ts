import { fileURLToPath } from 'node:url';
import type { Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import { PgUnitOfWork } from '../api/db/command-transaction.js';
import { runWithCorrelation, uuidv7 } from '../logging/index.js';
import type { DomainEventDraft } from './envelope.js';
import { PgOutboxWriter } from './outbox-writer.js';
import { EventContractError, EventSchemaRegistry } from './schema-registry.js';

const CONTRACTS = fileURLToPath(new URL('../../../../contracts/events/', import.meta.url));
const registry = EventSchemaRegistry.fromDirectory(CONTRACTS);
const WORKSPACE = '0199a000-0000-7000-8000-000000000001';
const USER = '0199a000-0000-7000-8000-0000000000aa';

interface Recorded {
  text: string;
  values: readonly unknown[];
}

/** Pool falso: registra las sentencias de la transacción de la UoW. */
function fakePool() {
  const statements: Recorded[] = [];
  const client = {
    query: async (text: string, values: readonly unknown[] = []) => {
      statements.push({ text, values });
      return { rows: [], rowCount: 1 };
    },
    release: () => undefined,
  };
  const pool = { connect: async () => client } as unknown as Pool;
  return { pool, statements };
}

const workspaceCreated = (payload: Record<string, unknown>): DomainEventDraft => ({
  eventId: uuidv7(),
  eventType: 'identity.WorkspaceCreated',
  eventVersion: 1,
  occurredAt: '2026-10-03T08:00:00.000-04:00',
  workspaceId: WORKSPACE,
  aggregateType: 'Workspace',
  aggregateId: WORKSPACE,
  aggregateVersion: 1,
  actor: { type: 'USER', id: USER },
  payload,
});

const validPayload = {
  workspaceId: WORKSPACE,
  name: 'Hogar',
  baseCurrency: 'BOB',
  timeZone: 'America/La_Paz',
  locale: 'es-BO',
  fiscalMonthStartDay: 1,
  ownerUserId: USER,
  origin: 'USER_CREATED',
};

describe('PgOutboxWriter y EventSchemaRegistry (platform/event-delivery)', () => {
  it('carga los schemas publicados en contracts/events', () => {
    expect(registry.eventNames()).toContain('identity.WorkspaceCreated.v1');
    expect(registry.eventNames()).toContain('ledger.JournalEntryPosted.v1');
    expect(registry.has('identity.WorkspaceRenamed', 1)).toBe(false);
  });

  it('completa el envelope (UTC, correlationId del contexto, actor) y lo inserta en la transacción en curso', async () => {
    const { pool, statements } = fakePool();
    const writer = new PgOutboxWriter(registry);
    const correlationId = uuidv7();
    const envelope = await runWithCorrelation({ correlationId }, () =>
      new PgUnitOfWork(pool).run({ userId: USER, workspaceId: WORKSPACE }, () =>
        writer.append(workspaceCreated(validPayload)),
      ),
    );
    expect(envelope).toMatchObject({
      occurredAt: '2026-10-03T12:00:00.000Z',
      correlationId,
      causationId: null,
      actor: { type: 'USER', id: USER },
    });
    const insert = statements.find((s) => s.text.startsWith('insert into "platform"."outbox"'));
    expect(insert).toBeDefined();
    expect(insert?.values).toContain(envelope.eventId);
    expect(statements.map((s) => s.text)).toContain('COMMIT');
  });

  it('[TC-PLATFORM-EVENTS-003] un payload fuera de contrato o un tipo sin schema hacen fallar el comando sin escribir', async () => {
    const { pool, statements } = fakePool();
    const writer = new PgOutboxWriter(registry);
    const uow = new PgUnitOfWork(pool);
    const { baseCurrency: _omitted, ...withoutCurrency } = validPayload;
    await expect(
      uow.run({ userId: USER, workspaceId: WORKSPACE }, () =>
        writer.append(workspaceCreated(withoutCurrency)),
      ),
    ).rejects.toBeInstanceOf(EventContractError);
    await expect(
      uow.run({ userId: USER, workspaceId: WORKSPACE }, () =>
        writer.append({ ...workspaceCreated(validPayload), eventType: 'identity.WorkspaceRenamed' }),
      ),
    ).rejects.toThrow(/no hay schema publicado/);
    expect(statements.some((s) => s.text.includes('outbox'))).toBe(false);
    expect(statements.filter((s) => s.text === 'ROLLBACK')).toHaveLength(2);
  });

  it('appendMany valida todos los eventos y los inserta con sentencias multi-fila; uno inválido no escribe ninguno', async () => {
    const { pool, statements } = fakePool();
    const writer = new PgOutboxWriter(registry);
    const uow = new PgUnitOfWork(pool);
    const correlationId = uuidv7();
    const envelopes = await uow.run({ userId: USER, workspaceId: WORKSPACE }, () =>
      writer.appendMany([
        { ...workspaceCreated(validPayload), correlationId },
        { ...workspaceCreated(validPayload), correlationId },
        { ...workspaceCreated(validPayload), correlationId },
      ]),
    );
    expect(envelopes.map((e) => e.correlationId)).toEqual([correlationId, correlationId, correlationId]);
    const inserts = statements.filter((s) => s.text.startsWith('insert into "platform"."outbox"'));
    expect(inserts).toHaveLength(1);
    expect(inserts[0]?.values).toEqual(expect.arrayContaining(envelopes.map((e) => e.eventId)));
    const { baseCurrency: _omitted, ...withoutCurrency } = validPayload;
    statements.length = 0;
    await expect(
      uow.run({ userId: USER, workspaceId: WORKSPACE }, () =>
        writer.appendMany([workspaceCreated(validPayload), workspaceCreated(withoutCurrency)]),
      ),
    ).rejects.toBeInstanceOf(EventContractError);
    expect(statements.some((s) => s.text.includes('outbox'))).toBe(false);
  });

  it('rechaza escribir fuera de una unidad de trabajo', async () => {
    await expect(new PgOutboxWriter(registry).append(workspaceCreated(validPayload))).rejects.toThrow(
      /unidad de trabajo/,
    );
  });
});
