import { InMemoryRateLimiter } from '@pf/platform/api';
import { FixedClock, Instant } from '@pf/shared-kernel';
import { beforeEach, describe, expect, it } from 'vitest';
import type { AuthorizationDenialCode } from '../contracts/index.js';
import { RedactionPolicy } from '../domain/redaction-policy.js';
import { AuditRecorder } from './audit-recorder.js';
import { AuthorizationDenialRecorder, RateLimiterDenialThrottle } from './authorization-denial.js';
import type { DenialObserver } from './ports/index.js';
import { InMemoryAudit, sequentialIds, sha256IpHasher } from './testing/in-memory.js';

const U3 = '0190a000-0000-7000-8000-000000000003';
const W1 = '0190a000-0000-7000-8000-0000000000a1';
const GHOST = '0190a000-0000-7000-8000-0000000000ee';

let mem: InMemoryAudit;
let clock: FixedClock;
let denied: string[];
let failures: unknown[];
let known: Set<string>;
let recorder: AuthorizationDenialRecorder;

const observer = (): DenialObserver => ({
  denied: (code) => denied.push(code),
  writeFailed: (err) => failures.push(err),
});

beforeEach(() => {
  mem = new InMemoryAudit();
  mem.ambientContext = { origin: 'api', clientIp: '203.0.113.7', userAgent: 'vitest' };
  clock = new FixedClock(Instant.parse('2026-03-10T14:00:00Z'));
  denied = [];
  failures = [];
  known = new Set([W1]);
  const audit = new AuditRecorder({
    env: mem,
    store: mem,
    ipHasher: sha256IpHasher,
    ids: sequentialIds(),
    clock,
    policy: new RedactionPolicy({ Workspace: { operationId: 'plain', code: 'plain' } }),
  });
  recorder = new AuthorizationDenialRecorder({
    uow: mem,
    audit,
    throttle: new RateLimiterDenialThrottle(new InMemoryRateLimiter()),
    workspaces: { exists: async (id) => known.has(id) },
    observer: observer(),
    clock,
  });
});

const deny = (
  workspaceId = W1,
  operationId = 'createTransaction',
  code: AuthorizationDenialCode = 'INSUFFICIENT_ROLE',
) => recorder.record({ userId: U3, workspaceId, operationId, code });

describe('[TC-AUDIT-GLOBAL-004] un rechazo por rol insuficiente queda auditado como evento de seguridad', () => {
  it('registra usuario, operación y código en el workspace objetivo, sin monto ni descripción', async () => {
    await deny();
    expect(mem.rows).toHaveLength(1);
    const r = mem.rows[0]!;
    expect(r.action).toBe('security.authorization.denied');
    expect(r.actor).toMatchObject({ type: 'USER', userId: U3 });
    expect(r.aggregateType).toBe('Workspace');
    expect(r.aggregateId).toBe(W1);
    expect(r.workspaceId).toBe(W1);
    expect(r.changes).toEqual([
      { field: 'operationId', before: null, after: 'createTransaction' },
      { field: 'code', before: null, after: 'INSUFFICIENT_ROLE' },
    ]);
    expect(JSON.stringify(r)).not.toContain('45.90');
    expect(JSON.stringify(r)).not.toContain('Compra');
    // La IP queda solo como HMAC (nunca en claro).
    expect(r.clientIpHash).not.toBeNull();
    expect(JSON.stringify(r)).not.toContain('203.0.113.7');
    expect(denied).toEqual(['INSUFFICIENT_ROLE']);
  });

  it('un no miembro (WORKSPACE_ACCESS_DENIED) de un workspace existente también se audita (D106)', async () => {
    await deny(W1, 'listAccounts', 'WORKSPACE_ACCESS_DENIED');
    expect(mem.rows.map((r) => r.changes.at(-1)?.after)).toEqual(['WORKSPACE_ACCESS_DENIED']);
  });

  it('un workspace inexistente no se audita, pero sí se cuenta en la métrica', async () => {
    await deny(GHOST);
    expect(mem.rows).toHaveLength(0);
    expect(denied).toEqual(['INSUFFICIENT_ROLE']);
    expect(failures).toEqual([]);
  });

  it('si la escritura de auditoría falla, record() no lanza (el rechazo sigue siendo 403) y se registra la falla', async () => {
    mem.failInserts = true;
    await expect(deny()).resolves.toBeUndefined();
    expect(mem.rows).toHaveLength(0);
    expect(failures).toHaveLength(1);
    expect(String(failures[0])).toContain('audit store unavailable');
  });

  it('un observador que falla tampoco rompe el rechazo', async () => {
    const broken = new AuthorizationDenialRecorder({
      uow: mem,
      audit: {
        append: async () => {
          throw new Error('boom');
        },
      },
      throttle: { tryAcquire: async () => true },
      workspaces: { exists: async () => true },
      observer: {
        denied: () => undefined,
        writeFailed: () => {
          throw new Error('observer down');
        },
      },
      clock,
    });
    await expect(
      broken.record({ userId: U3, workspaceId: W1, operationId: 'x', code: 'INSUFFICIENT_ROLE' }),
    ).resolves.toBeUndefined();
  });
});

describe('[TC-AUDIT-GLOBAL-005] los rechazos repetidos se auditan una vez por minuto', () => {
  it('5 intentos en 30 segundos: un solo evento; tras 61 segundos, un segundo evento', async () => {
    for (let i = 0; i < 5; i += 1) {
      await deny();
      clock.advance(6_000);
    }
    expect(mem.rows).toHaveLength(1);
    expect(denied).toHaveLength(5); // la métrica cuenta todos los rechazos
    clock.advance(61_000);
    await deny();
    expect(mem.rows).toHaveLength(2);
  });

  it('el límite es por operación y por usuario: otra operación se audita aparte', async () => {
    await deny(W1, 'createTransaction');
    await deny(W1, 'voidTransaction');
    await recorder.record({
      userId: '0190a000-0000-7000-8000-000000000004',
      workspaceId: W1,
      operationId: 'createTransaction',
      code: 'INSUFFICIENT_ROLE',
    });
    expect(mem.rows).toHaveLength(3);
  });
});
