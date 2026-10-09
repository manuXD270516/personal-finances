import { FixedClock, Instant, Money, currency } from '@pf/shared-kernel';
import { beforeEach, describe, expect, it } from 'vitest';
import { AuditError } from '../domain/audit-error.js';
import { RedactionPolicy } from '../domain/redaction-policy.js';
import { AuditRecorder } from './audit-recorder.js';
import { InMemoryAudit, sequentialIds, sha256IpHasher } from './testing/in-memory.js';

const U1 = '0190a000-0000-7000-8000-000000000001';
const W1 = '0190a000-0000-7000-8000-0000000000a1';
const T1 = '0190a000-0000-7000-8000-0000000000f1';
const C1 = '0190a000-0000-7000-8000-0000000000c1';
const C7 = '0190a000-0000-7000-8000-0000000000c7';

const policy = new RedactionPolicy({
  Transaction: { amount: 'money', description: 'plain', status: 'plain' },
  LedgerAccount: { currency: 'plain', kind: 'plain' },
});

let mem: InMemoryAudit;
let clock: FixedClock;
let recorder: AuditRecorder;

beforeEach(() => {
  mem = new InMemoryAudit();
  clock = new FixedClock(Instant.parse('2026-03-15T14:00:00Z'));
  recorder = new AuditRecorder({
    env: mem,
    store: mem,
    ipHasher: sha256IpHasher,
    ids: sequentialIds(),
    clock,
    policy,
  });
});

const amend = {
  workspaceId: W1,
  action: 'transactions.transaction.amended',
  aggregateType: 'Transaction',
  aggregateId: T1,
  aggregateVersion: 2,
  changes: [
    {
      field: 'amount',
      before: Money.parse('120.00', currency('BOB', 2)),
      after: { amount: '102.00', currency: 'BOB' },
    },
  ],
};

describe('[TC-AUDIT-ATOMIC-001] la auditoría se escribe dentro de la unidad de trabajo del comando', () => {
  it('fuera de una unidad de trabajo append falla con AUDIT_OUTSIDE_UNIT_OF_WORK y no escribe nada', async () => {
    mem.ambientContext = { actor: { type: 'USER', userId: U1 } };
    await expect(recorder.append(amend)).rejects.toMatchObject({ code: 'AUDIT_OUTSIDE_UNIT_OF_WORK' });
    expect(mem.rows).toHaveLength(0);
  });

  it('si la escritura falla, el error se propaga y la unidad de trabajo revierte todo', async () => {
    mem.ambientContext = { actor: { type: 'USER', userId: U1 } };
    const effects: string[] = [];
    mem.failInserts = true;
    await expect(
      mem.run({ workspaceId: W1 }, async () => {
        effects.push('gasto');
        await recorder.append(amend);
      }),
    ).rejects.toThrow('fault injected');
    expect(mem.rows).toHaveLength(0);
  });

  it('un comando rechazado antes de auditar no deja registro', async () => {
    mem.ambientContext = { actor: { type: 'USER', userId: U1 } };
    await expect(
      mem.run({ workspaceId: W1 }, async () => {
        throw new Error('CURRENCY_MISMATCH');
      }),
    ).rejects.toThrow();
    expect(mem.rows).toHaveLength(0);
  });
});

describe('[TC-AUDIT-CONTENT-001] el recorder completa el registro con el contexto de la petición', () => {
  it('actor, workspace, acción, versión, montos exactos, instante del Clock, correlación C1, origen ui, HMAC de IP', async () => {
    mem.ambientContext = {
      actor: { type: 'USER', userId: U1 },
      origin: 'ui',
      correlationId: C1,
      requestId: C1,
      userAgent: 'Mozilla/5.0 (PFOS test)',
      clientIp: '203.0.113.7',
      idempotencyKey: 'K-1',
    };
    await mem.run({ workspaceId: W1 }, () => recorder.append(amend));
    const [r] = mem.rows;
    expect(r).toMatchObject({
      workspaceId: W1,
      actor: { type: 'USER', userId: U1 },
      action: 'transactions.transaction.amended',
      aggregateId: T1,
      aggregateVersion: 2,
      correlationId: C1,
      requestId: C1,
      origin: 'ui',
      idempotencyKey: 'K-1',
      userAgent: 'Mozilla/5.0 (PFOS test)',
      changes: [
        {
          field: 'amount',
          before: { amount: '120.00', currency: 'BOB' },
          after: { amount: '102.00', currency: 'BOB' },
        },
      ],
    });
    expect(r?.occurredAt.toString()).toBe('2026-03-15T14:00:00.000Z');
    expect(r?.clientIpHash).toHaveLength(32);
    expect(Buffer.from(r!.clientIpHash!).toString('utf8')).not.toContain('203.0.113.7');
  });

  it('el motivo se registra; sin actor ni en la entrada ni en el contexto falla', async () => {
    mem.ambientContext = { actor: { type: 'USER', userId: U1 }, correlationId: C1 };
    await mem.run({ workspaceId: W1 }, () =>
      recorder.append({
        ...amend,
        action: 'transactions.transaction.voided',
        changes: [{ field: 'status', before: 'POSTED', after: 'VOIDED' }],
        reason: 'Duplicada',
      }),
    );
    expect(mem.rows[0]?.reason).toBe('Duplicada');
    mem.ambientContext = {};
    await expect(mem.run({ workspaceId: W1 }, () => recorder.append(amend))).rejects.toBeInstanceOf(
      AuditError,
    );
  });
});

describe('[TC-AUDIT-ACTOR-001] una mutación automática se atribuye al proceso y conserva la correlación', () => {
  it('actor SYSTEM con proceso, sin usuario, con la correlación C7 de la solicitud original y origen system', async () => {
    mem.ambientContext = { actor: { type: 'USER', userId: U1 }, origin: 'ui', correlationId: C7 };
    await mem.run({ workspaceId: W1 }, () =>
      recorder.append({
        workspaceId: W1,
        action: 'ledger.ledger_account.created',
        aggregateType: 'LedgerAccount',
        aggregateId: '0190a000-0000-7000-8000-0000000000b7',
        aggregateVersion: 1,
        changes: [{ field: 'currency', before: null, after: 'USDT' }],
        actor: { type: 'SYSTEM', process: 'ledger.system-accounts' },
        origin: 'system',
      }),
    );
    expect(mem.rows[0]).toMatchObject({
      actor: { type: 'SYSTEM', userId: null, process: 'ledger.system-accounts' },
      correlationId: C7,
      origin: 'system',
    });
  });

  it('un job del worker sin origen explícito queda como WORKER/system con su propia correlación', async () => {
    mem.ambientContext = { actor: { type: 'WORKER', process: 'recurring.generator' } };
    await mem.run({ workspaceId: W1 }, () => recorder.append(amend));
    expect(mem.rows[0]?.origin).toBe('system');
    expect(mem.rows[0]?.actor.type).toBe('WORKER');
    expect(mem.rows[0]?.correlationId).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('[TC-TRANSACTIONS-BULK-007] correlación explícita de la entrada', () => {
  it('la correlación de la entrada (bulkOperationId) prevalece sobre la de la solicitud', async () => {
    mem.ambientContext = { actor: { type: 'USER', userId: U1 }, correlationId: C1 };
    await mem.run({ workspaceId: W1 }, () => recorder.append({ ...amend, correlationId: C7 }));
    expect(mem.rows[0]?.correlationId).toBe(C7);
  });
});

describe('[TC-TRANSACTIONS-BULK-007] appendMany', () => {
  it('escribe todas las entradas con una sola inserción y las valida todas antes de escribir', async () => {
    mem.ambientContext = { actor: { type: 'USER', userId: U1 }, correlationId: C1 };
    await mem.run({ workspaceId: W1 }, () =>
      recorder.appendMany([amend, { ...amend, correlationId: C7 }, { ...amend, aggregateVersion: 3 }]),
    );
    expect(mem.rows.map((r) => r.correlationId)).toEqual([C1, C7, C1]);
    // Una entrada inválida (versión no positiva) rechaza el lote completo.
    await expect(
      mem.run({ workspaceId: W1 }, () => recorder.appendMany([amend, { ...amend, aggregateVersion: 0 }])),
    ).rejects.toThrow();
    expect(mem.rows).toHaveLength(3);
    await expect(recorder.appendMany([amend])).rejects.toBeInstanceOf(AuditError);
  });
});
