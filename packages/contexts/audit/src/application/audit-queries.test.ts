import { FixedClock, Instant, LocalDate } from '@pf/shared-kernel';
import { beforeEach, describe, expect, it } from 'vitest';
import { RedactionPolicy } from '../domain/redaction-policy.js';
import { AuditQueries, startOfDayIn } from './audit-queries.js';
import { AuditRecorder } from './audit-recorder.js';
import { InMemoryAudit, fixedTimeZones, sequentialIds, sha256IpHasher } from './testing/in-memory.js';

const U1 = '0190a000-0000-7000-8000-000000000001';
const W1 = '0190a000-0000-7000-8000-0000000000a1';
const W2 = '0190a000-0000-7000-8000-0000000000a2';
const BANK_C = '0190a000-0000-7000-8000-0000000000bc';
const OTHER = '0190a000-0000-7000-8000-0000000000ff';

let mem: InMemoryAudit;
let clock: FixedClock;
let recorder: AuditRecorder;
let queries: AuditQueries;

beforeEach(() => {
  mem = new InMemoryAudit();
  mem.ambientContext = { actor: { type: 'USER', userId: U1 }, origin: 'ui' };
  clock = new FixedClock(Instant.parse('2026-03-15T14:00:00Z'));
  recorder = new AuditRecorder({
    env: mem,
    store: mem,
    ipHasher: sha256IpHasher,
    ids: sequentialIds(),
    clock,
    policy: new RedactionPolicy({ Account: { name: 'plain', openingBalance: 'money', archived: 'plain' } }),
  });
  queries = new AuditQueries({ uow: mem, store: mem, timeZones: fixedTimeZones('America/La_Paz') });
});

const accountEvent = (action: string, changes: { field: string; before: unknown; after: unknown }[]) =>
  mem.run({ workspaceId: W1 }, async () => {
    await recorder.append({
      workspaceId: W1,
      action,
      aggregateType: 'Account',
      aggregateId: BANK_C,
      changes,
    });
    clock.advance(60_000);
  });

describe('[TC-AUDIT-HISTORY-001] historial cronológico de una entidad, paginado', () => {
  beforeEach(async () => {
    await accountEvent('accounts.account.opened', [
      { field: 'name', before: null, after: 'Bank C' },
      { field: 'openingBalance', before: null, after: { amount: '500.00', currency: 'BOB' } },
    ]);
    await accountEvent('accounts.account.renamed', [
      { field: 'name', before: 'Bank C', after: 'Bank C Sueldo' },
    ]);
    await accountEvent('accounts.account.archived', [{ field: 'archived', before: false, after: true }]);
  });

  it('apertura (500.00 BOB), renombre y archivo en orden ascendente; una entidad sin registros devuelve []', async () => {
    const rows = await queries.list({
      userId: U1,
      workspaceId: W1,
      aggregateType: 'Account',
      aggregateId: BANK_C,
      limit: 50,
    });
    expect(rows.map((r) => r.action)).toEqual([
      'accounts.account.opened',
      'accounts.account.renamed',
      'accounts.account.archived',
    ]);
    expect(rows[0]?.changes).toContainEqual({
      field: 'openingBalance',
      before: null,
      after: { amount: '500.00', currency: 'BOB' },
    });
    expect(rows[1]?.changes).toEqual([{ field: 'name', before: 'Bank C', after: 'Bank C Sueldo' }]);
    expect(
      await queries.list({
        userId: U1,
        workspaceId: W1,
        aggregateType: 'Account',
        aggregateId: OTHER,
        limit: 50,
      }),
    ).toEqual([]);
  });

  it('con limit 2 y la posición del último se obtiene el tercero', async () => {
    const page1 = await queries.list({
      userId: U1,
      workspaceId: W1,
      aggregateType: 'Account',
      aggregateId: BANK_C,
      limit: 2,
    });
    const last = page1[1]!;
    const page2 = await queries.list({
      userId: U1,
      workspaceId: W1,
      aggregateType: 'Account',
      aggregateId: BANK_C,
      limit: 2,
      after: { occurredAt: last.occurredAt.toString(), id: last.id },
    });
    expect(page2.map((r) => r.action)).toEqual(['accounts.account.archived']);
  });

  it('[TC-AUDIT-ISOLATION-001] desde otro workspace la misma entidad devuelve lista vacía', async () => {
    expect(
      await queries.list({
        userId: U1,
        workspaceId: W2,
        aggregateType: 'Account',
        aggregateId: BANK_C,
        limit: 50,
      }),
    ).toEqual([]);
    expect(
      await queries.historyOf({
        userId: U1,
        workspaceId: W2,
        entities: [{ aggregateType: 'Account', aggregateId: BANK_C }],
        limit: 50,
      }),
    ).toEqual([]);
  });
});

describe('[TC-AUDIT-RANGE-001] búsqueda por rango de fechas en la zona del workspace', () => {
  beforeEach(async () => {
    for (const at of ['2026-03-14T15:00:00Z', '2026-03-16T03:30:00Z', '2026-03-16T15:00:00Z']) {
      clock.set(Instant.parse(at));
      await accountEvent('accounts.account.renamed', [{ field: 'name', before: 'a', after: at }]);
    }
  });

  it('del 2026-03-15 al 2026-03-15 (La Paz) devuelve solo el de 2026-03-16T03:30Z; sin entidad, del más reciente al más antiguo', async () => {
    const day = await queries.list({
      userId: U1,
      workspaceId: W1,
      from: '2026-03-15',
      to: '2026-03-15',
      limit: 50,
    });
    expect(day.map((r) => r.occurredAt.toString())).toEqual(['2026-03-16T03:30:00.000Z']);
    const all = await queries.list({ userId: U1, workspaceId: W1, limit: 50 });
    expect(all.map((r) => r.occurredAt.toString())).toEqual([
      '2026-03-16T15:00:00.000Z',
      '2026-03-16T03:30:00.000Z',
      '2026-03-14T15:00:00.000Z',
    ]);
  });

  it('rango invertido o aggregateId sin aggregateType: INVALID_FILTER', async () => {
    await expect(
      queries.list({ userId: U1, workspaceId: W1, from: '2026-03-16', to: '2026-03-15', limit: 50 }),
    ).rejects.toMatchObject({ code: 'INVALID_FILTER' });
    await expect(
      queries.list({ userId: U1, workspaceId: W1, aggregateId: BANK_C, limit: 50 }),
    ).rejects.toMatchObject({ code: 'INVALID_FILTER' });
  });

  it('las 00:00 locales respetan la zona (y su horario de verano)', () => {
    expect(startOfDayIn(LocalDate.parse('2026-03-15'), 'America/La_Paz').toISOString()).toBe(
      '2026-03-15T04:00:00.000Z',
    );
    expect(startOfDayIn(LocalDate.parse('2026-07-01'), 'Europe/Madrid').toISOString()).toBe(
      '2026-06-30T22:00:00.000Z',
    );
    expect(startOfDayIn(LocalDate.parse('2026-01-01'), 'UTC').toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });
});
