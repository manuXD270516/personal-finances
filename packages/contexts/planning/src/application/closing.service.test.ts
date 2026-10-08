import { DomainError, Instant } from '@pf/shared-kernel';
import { describe, expect, it } from 'vitest';
import { ClosePendingService } from './close-pending-publisher.js';
import { ClosingQueries } from './closing.queries.js';
import { ClosingService } from './closing.service.js';
import { ClosingVerifier } from './closing-verifier.js';
import type { ClosingDeps, PeriodReopeningRow, SnapshotHeader, StoredSnapshot } from './ports/index.js';
import { InMemoryPlanning } from './testing/in-memory.js';
import {
  canonicalJson,
  type CloseSnapshotContent,
  type ClosingPolicy,
  type Finding,
} from '../domain/index.js';

const W = '0190a000-0000-7000-8000-00000000a001';
const BANK = '0190a000-0000-7000-8000-0000000000b1';
const money = (amount: string, currency = 'BOB') => ({ amount, currency });
const empty: Finding = { count: 0, amounts: [], details: [], truncated: false };

/** Entorno de PLANNING con dobles en memoria de TODOS los puertos del cierre; la "transacción" restaura también ellos. */
class ClosingEnv {
  readonly mem = new InMemoryPlanning();
  policy: ClosingPolicy | null = null;
  snapshots: StoredSnapshot[] = [];
  reopenings: PeriodReopeningRow[] = [];
  notices = new Set<string>();
  locks: {
    yearMonth: string;
    periodStart?: string | null;
    periodEnd?: string | null;
    openStart?: boolean;
  }[] = [];
  unlocks: { yearMonth: string; reason: string }[] = [];
  failSnapshotInsert = false;
  pending: Finding = { ...empty };
  uncategorized: Finding = { ...empty };
  coverageReconciled = true;
  basis: 'STATEMENT' | 'WITHOUT_STATEMENT' | null = 'STATEMENT';
  withoutStatement: {
    accountId: string;
    transactionId: string;
    businessDate: string;
    amount: { amount: string; currency: string };
  }[] = [];
  unlocked = new Set<string>();
  actor = '0190a000-0000-7000-8000-0000000000e1';

  constructor() {
    this.mem.workspace(W);
    this.mem.clock.set(Instant.parse('2026-11-03T15:00:00Z'));
  }

  private readonly rollbackUow = {
    run: async <T>(workspaceId: string, fn: () => Promise<T>): Promise<T> => {
      const saved = {
        snapshots: [...this.snapshots],
        reopenings: [...this.reopenings],
        notices: new Set(this.notices),
        locks: [...this.locks],
        unlocks: [...this.unlocks],
        policy: this.policy,
      };
      try {
        return await this.mem.uow.run(workspaceId, fn);
      } catch (err) {
        Object.assign(this, saved);
        throw err;
      }
    },
  };

  deps(): ClosingDeps {
    return {
      uow: this.rollbackUow,
      periods: this.mem.repository,
      policies: {
        find: async () => this.policy,
        save: async (p) => {
          this.policy = p;
          return true;
        },
      },
      snapshots: {
        insert: async (s) => {
          if (this.failSnapshotInsert) throw new Error('boom: close_snapshot insert');
          const stored: StoredSnapshot = { ...s, contentSha256: 'x', content: s.content };
          this.snapshots.push(stored);
          return 'x';
        },
        list: async (_ws, periodId): Promise<readonly SnapshotHeader[]> =>
          this.snapshots.filter((s) => s.periodId === periodId).sort((a, b) => a.closeNo - b.closeNo),
        find: async (_ws, periodId, closeNo) =>
          this.snapshots.find((s) => s.periodId === periodId && s.closeNo === closeNo) ?? null,
        listCurrent: async (_ws, periodIds) =>
          periodIds.flatMap((id) => {
            const all = this.snapshots.filter((s) => s.periodId === id).sort((a, b) => b.closeNo - a.closeNo);
            return all[0] ? [all[0]] : [];
          }),
        listAllCurrent: async () => this.snapshots,
      },
      reopenings: { insert: async (r) => void this.reopenings.push(r) },
      notices: {
        insertIfAbsent: async ({ periodId }) => {
          if (this.notices.has(periodId)) return false;
          this.notices.add(periodId);
          return true;
        },
      },
      calendar: this.mem.calendar,
      settings: { settingsOf: async () => ({ baseCurrency: 'BOB', timeZone: 'America/La_Paz' }) },
      lock: {
        lockPeriod: async (i) => void this.locks.push(i),
        unlockPeriod: async (i) => void this.unlocks.push(i),
      },
      ledger: {
        assertPeriodOpen: async ({ date }) => {
          if (
            this.locks.some((l) => (l.periodStart ?? '0000-00-00') <= date && date <= (l.periodEnd ?? '9999'))
          ) {
            throw new DomainError('PERIOD_CLOSED', 'closed');
          }
        },
      },
      accounts: {
        listAccounts: async () => [
          {
            accountId: BANK,
            name: 'Bank A',
            type: 'BANK',
            nature: 'ASSET',
            currency: 'BOB',
            status: 'ACTIVE',
            liquidity: 'LIQUID',
            includeInNetWorth: true,
            displayOrder: 1,
          },
        ],
      },
      balances: {
        getAccountBalances: async () => ({
          asOf: null,
          latestEntryAt: null,
          balances: [
            {
              ledgerAccountId: 'l1',
              code: 'x',
              nature: 'ASSET',
              accountId: BANK,
              balance: money('5200.00'),
              presented: money('5200.00'),
            },
          ],
        }),
      },
      closing: {
        countPendingInRange: async () => this.pending,
        countOpenDuplicatesInRange: async () => empty,
        countUncategorizedInRange: async () => this.uncategorized,
        listReconciledWithoutStatementInRange: async () => this.withoutStatement,
        listAccountIdsWithActivityInRange: async () => [BANK],
      },
      reconciliation: {
        getCoverage: async () => [
          {
            accountId: BANK,
            lastCompleted: this.coverageReconciled
              ? {
                  reconciliationId: 'r1',
                  statementDate: '2026-10-31',
                  statementBalance: money('5200.00'),
                  difference: money('0.00'),
                  completedAt: '2026-11-02T12:00:00.000Z',
                }
              : null,
            inProgressReconciliationId: null,
            unreconciledPostedCountThrough: 0,
            unreconciledClearedCountThrough: 0,
            reconciledWithoutStatementCount: this.withoutStatement.length,
            reconciledThrough: this.coverageReconciled,
            reconciliationBasis: this.coverageReconciled ? this.basis : null,
          },
        ],
      },
      flows: {
        getFlows: async () => ({
          period: { from: '2026-10-01', to: '2026-10-31' },
          reportingCurrency: 'BOB',
          byCurrency: [
            {
              currency: 'BOB',
              income: money('12000.00'),
              expense: money('8210.50'),
              net: money('3789.50'),
              savingsRate: '31.6',
            },
          ],
          consolidated: {
            currency: 'BOB',
            income: money('12000.00'),
            expense: money('8450.50'),
            net: money('3549.50'),
            savingsRate: '29.6',
            complete: true,
            unconverted: [],
          },
          ratesUsed: [],
        }),
      },
      netWorth: {
        getNetWorth: async () =>
          ({
            asOf: '2026-10-31',
            reportingCurrency: 'BOB',
            netWorth: {
              assets: money('5200.00'),
              liabilities: money('0.00'),
              netWorth: money('5200.00'),
              complete: true,
              byCurrency: [],
              byAccountType: [],
              unvalued: [],
            },
            accounts: [],
            ratesUsed: [],
          }) as never,
      },
      audit: this.mem.audit,
      lifecycle: this.mem.lifecycle,
      outbox: { append: async (e) => void this.mem.events.push(e) },
      actor: { userId: () => this.actor },
      ids: this.mem.deps().ids,
      clock: this.mem.clock,
      closePendingDelayDays: 3,
    };
  }

  service() {
    return new ClosingService(this.deps());
  }
}

/** Septiembre y octubre terminados (octubre activo), sin cierre. */
function setup() {
  const env = new ClosingEnv();
  const sep = env.mem.seed(W, '2026-09', 'ACTIVE');
  const oct = env.mem.seed(W, '2026-10', 'ACTIVE');
  return { env, sep, oct };
}

const codeOf = async (p: Promise<unknown>): Promise<string | undefined> => {
  try {
    await p;
  } catch (err) {
    if (err instanceof DomainError) return err.code;
    throw err;
  }
  return undefined;
};

describe('ClosingService.closePeriod', () => {
  it('[TC-PLANNING-CLOSE-001] cierre exitoso: periodo, bloqueo con rango, snapshot 1, auditoría, transición y evento juntos', async () => {
    const { env, sep, oct } = setup();
    const svc = env.service();
    await svc.closePeriod({
      workspaceId: W,
      periodId: sep.id,
      expectedVersion: sep.version,
      acknowledgeWarnings: false,
    });
    const dto = await svc.closePeriod({
      workspaceId: W,
      periodId: oct.id,
      expectedVersion: oct.version,
      acknowledgeWarnings: false,
    });
    expect(dto).toMatchObject({ status: 'CLOSED', closeCount: 1, latestCloseNo: 1 });
    expect(env.locks).toEqual([
      {
        workspaceId: W,
        yearMonth: '2026-09',
        periodId: sep.id,
        periodStart: '2026-09-01',
        periodEnd: '2026-09-30',
        openStart: true,
      },
      {
        workspaceId: W,
        yearMonth: '2026-10',
        periodId: oct.id,
        periodStart: '2026-10-01',
        periodEnd: '2026-10-31',
        openStart: false,
      },
    ]);
    expect(env.snapshots.map((s) => [s.closeNo, s.previousSnapshotId])).toEqual([
      [1, null],
      [1, null],
    ]);
    const events = env.mem.events.filter((e) => e.eventType === 'planning.MonthClosed');
    expect(events).toHaveLength(2);
    expect(events[1]!.payload).toMatchObject({ periodId: oct.id, closeNo: 1, label: '2026-10' });
    expect(env.mem.audits.map((a) => a.action)).toEqual(['planning.period.closed', 'planning.period.closed']);
    expect(
      env.mem.lifecycleSteps
        .filter((s) => s.kind === 'TRANSITION')
        .map((s) => 'transition' in s && s.transition),
    ).toEqual(['CLOSE', 'CLOSE']);
  });

  it('[TC-PLANNING-CLOSE-001] una falla al escribir el snapshot revierte TODO: periodo activo, sin bloqueo, sin auditoría ni evento', async () => {
    const { env, sep } = setup();
    env.failSnapshotInsert = true;
    const svc = env.service();
    await expect(
      svc.closePeriod({
        workspaceId: W,
        periodId: sep.id,
        expectedVersion: sep.version,
        acknowledgeWarnings: false,
      }),
    ).rejects.toThrow('boom');
    expect(env.mem.rows.get(sep.id)).toMatchObject({ status: 'ACTIVE', closeCount: 0 });
    expect(env.locks).toEqual([]);
    expect(env.mem.audits).toEqual([]);
    expect(env.mem.events).toEqual([]);
    expect(env.snapshots).toEqual([]);
  });

  it('[TC-PLANNING-CLOSE-002] un ítem bloqueante rechaza con MONTH_CLOSING_BLOCKED, deshace el bloqueo y no publica', async () => {
    const { env, sep } = setup();
    env.pending = { count: 2, amounts: [money('165.00')], details: [], truncated: false };
    const err = await svc(env)
      .closePeriod({
        workspaceId: W,
        periodId: sep.id,
        expectedVersion: sep.version,
        acknowledgeWarnings: true,
      })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DomainError);
    expect((err as DomainError).code).toBe('MONTH_CLOSING_BLOCKED');
    expect(env.locks).toEqual([]);
    expect(env.mem.events).toEqual([]);
    expect(env.mem.rows.get(sep.id)?.status).toBe('ACTIVE');
  });

  it('[TC-PLANNING-CLOSE-003] advertencias sin reconocer ⇒ MONTH_CLOSING_WARNINGS_NOT_ACKNOWLEDGED; reconocidas ⇒ snapshot con quién las reconoció', async () => {
    const { env, sep } = setup();
    env.uncategorized = { count: 3, amounts: [money('210.00')], details: [], truncated: false };
    const s = svc(env);
    const input = { workspaceId: W, periodId: sep.id, expectedVersion: sep.version };
    expect(await codeOf(s.closePeriod({ ...input, acknowledgeWarnings: false }))).toBe(
      'MONTH_CLOSING_WARNINGS_NOT_ACKNOWLEDGED',
    );
    await s.closePeriod({ ...input, acknowledgeWarnings: true });
    expect(env.snapshots[0]!.content.acknowledgedWarnings).toMatchObject({
      items: ['UNCATEGORIZED'],
      by: env.actor,
    });
  });

  it('[TC-PLANNING-CLOSE-004][TC-PLANNING-CLOSE-005] orden cronológico y periodo terminado en la zona del workspace (23:30 y 00:10 de La Paz)', async () => {
    const { env, oct } = setup();
    const s = svc(env);
    expect(
      await codeOf(
        s.closePeriod({
          workspaceId: W,
          periodId: oct.id,
          expectedVersion: oct.version,
          acknowledgeWarnings: false,
        }),
      ),
    ).toBe('PERIOD_PREVIOUS_NOT_CLOSED');
    const first = env.mem.byLabel(W, '2026-09')!;
    env.mem.clock.set(Instant.parse('2026-10-01T03:30:00Z')); // 2026-09-30 23:30 en La Paz
    expect(
      await codeOf(
        s.closePeriod({
          workspaceId: W,
          periodId: first.id,
          expectedVersion: first.version,
          acknowledgeWarnings: false,
        }),
      ),
    ).toBe('PERIOD_NOT_ENDED');
    env.mem.clock.set(Instant.parse('2026-10-01T04:10:00Z')); // 2026-10-01 00:10 en La Paz
    expect(
      (
        await s.closePeriod({
          workspaceId: W,
          periodId: first.id,
          expectedVersion: first.version,
          acknowledgeWarnings: false,
        })
      ).status,
    ).toBe('CLOSED');
  });

  it('[TC-PLANNING-CLOSE-006] la conciliada sin extracto es INFO: cierra sin reconocimiento y el snapshot registra base y transacciones', async () => {
    const { env, sep } = setup();
    env.basis = 'WITHOUT_STATEMENT';
    env.withoutStatement = [
      { accountId: BANK, transactionId: 'c1', businessDate: '2026-09-12', amount: money('-80.00') },
    ];
    await svc(env).closePeriod({
      workspaceId: W,
      periodId: sep.id,
      expectedVersion: sep.version,
      acknowledgeWarnings: false,
    });
    const b = env.snapshots[0]!.content.balances[0]!;
    expect(b).toMatchObject({
      reconciliationBasis: 'WITHOUT_STATEMENT',
      reconciledWithoutStatementTransactionIds: ['c1'],
    });
    expect(env.snapshots[0]!.content.reconciledWithoutStatement).toHaveLength(1);
    expect(env.snapshots[0]!.content.acknowledgedWarnings).toBeNull();
  });

  it('[TC-PLANNING-EXIT-001] cuentas conciliadas a diferencia 0: el saldo del snapshot referencia la conciliación y coincide con el extracto', async () => {
    const { env, sep } = setup();
    await svc(env).closePeriod({
      workspaceId: W,
      periodId: sep.id,
      expectedVersion: sep.version,
      acknowledgeWarnings: false,
    });
    const b = env.snapshots[0]!.content.balances[0]!;
    expect(b.balance).toEqual(b.reconciliation!.statementBalance);
    expect(b.reconciliation!.reconciliationId).toBe('r1');
  });
});

const svc = (env: ClosingEnv) => env.service();

describe('ClosingService.reopenPeriod y re-cierre', () => {
  it('[TC-PLANNING-REOPEN-001][TC-PLANNING-RECLOSE-001] reabre sin tocar el snapshot, quita el bloqueo y el re-cierre es la versión 2 enlazada a la 1', async () => {
    const { env, sep } = setup();
    const s = svc(env);
    await s.closePeriod({
      workspaceId: W,
      periodId: sep.id,
      expectedVersion: sep.version,
      acknowledgeWarnings: false,
    });
    const closed = env.mem.rows.get(sep.id)!;
    const snapshotBefore = canonicalJson(env.snapshots[0]!.content);
    const reopened = await s.reopenPeriod({
      workspaceId: W,
      periodId: sep.id,
      expectedVersion: closed.version,
      reason: 'Faltó la comisión',
    });
    expect(reopened).toMatchObject({ status: 'REOPENED', reopenCount: 1 });
    expect(env.unlocks).toEqual([{ workspaceId: W, yearMonth: '2026-09', reason: 'Faltó la comisión' }]);
    expect(env.reopenings[0]).toMatchObject({
      reopenNo: 1,
      reason: 'Faltó la comisión',
      closedSnapshotId: env.snapshots[0]!.id,
    });
    await s.closePeriod({
      workspaceId: W,
      periodId: sep.id,
      expectedVersion: reopened.version,
      acknowledgeWarnings: false,
    });
    expect(env.snapshots.map((x) => x.closeNo)).toEqual([1, 2]);
    expect(env.snapshots[1]!.previousSnapshotId).toBe(env.snapshots[0]!.id);
    expect(canonicalJson(env.snapshots[0]!.content)).toBe(snapshotBefore);
    expect(env.mem.events.map((e) => e.eventType)).toEqual([
      'planning.MonthClosed',
      'planning.PeriodReopened',
      'planning.MonthClosed',
    ]);
  });

  it('[TC-PLANNING-REOPEN-002] motivo vacío ⇒ VALIDATION_FAILED; siguiente cerrado ⇒ PERIOD_NEXT_CLOSED; ningún evento en los rechazos', async () => {
    const { env, sep, oct } = setup();
    const s = svc(env);
    await s.closePeriod({
      workspaceId: W,
      periodId: sep.id,
      expectedVersion: sep.version,
      acknowledgeWarnings: false,
    });
    await s.closePeriod({
      workspaceId: W,
      periodId: oct.id,
      expectedVersion: oct.version,
      acknowledgeWarnings: false,
    });
    const eventsBefore = env.mem.events.length;
    const sepNow = env.mem.rows.get(sep.id)!;
    expect(
      await codeOf(
        s.reopenPeriod({ workspaceId: W, periodId: sep.id, expectedVersion: sepNow.version, reason: 'x' }),
      ),
    ).toBe('PERIOD_NEXT_CLOSED');
    const octNow = env.mem.rows.get(oct.id)!;
    expect(
      await codeOf(
        s.reopenPeriod({ workspaceId: W, periodId: oct.id, expectedVersion: octNow.version, reason: '  ' }),
      ),
    ).toBe('VALIDATION_FAILED');
    expect(
      await codeOf(s.reopenPeriod({ workspaceId: W, periodId: oct.id, expectedVersion: 99, reason: 'x' })),
    ).toBe('PRECONDITION_FAILED');
    expect(env.mem.events.length).toBe(eventsBefore);
    expect(env.unlocks).toEqual([]);
  });
});

describe('Política, reporte y avisos', () => {
  it('[TC-PLANNING-CHECKLIST-002] la política se guarda con If-Match y se audita con severidad anterior y nueva', async () => {
    const env = new ClosingEnv();
    const s = svc(env);
    const def = await s.getPolicy(W);
    expect(def.version).toBe(1);
    const updated = await s.updatePolicy({
      workspaceId: W,
      expectedVersion: 1,
      severities: { ...def.severities, UNRECONCILED_ACCOUNTS: 'WARNING' },
    });
    expect(updated.severities['UNRECONCILED_ACCOUNTS']).toBe('WARNING');
    expect(env.mem.audits[0]).toMatchObject({
      action: 'planning.closing_policy.updated',
      changes: [{ field: 'UNRECONCILED_ACCOUNTS', before: 'BLOCKING', after: 'WARNING' }],
    });
    expect(
      await codeOf(s.updatePolicy({ workspaceId: W, expectedVersion: 1, severities: def.severities })),
    ).toBe('PRECONDITION_FAILED');
  });

  it('[TC-PLANNING-REPORT-001][TC-PLANNING-REPORT-002] reporte vigente, sin comparación en el primer periodo y nunca cerrado ⇒ REFERENCE_NOT_FOUND', async () => {
    const { env, sep, oct } = setup();
    const s = svc(env);
    const q = new ClosingQueries(env.deps());
    expect(await codeOf(q.report(W, sep.id))).toBe('REFERENCE_NOT_FOUND');
    await s.closePeriod({
      workspaceId: W,
      periodId: sep.id,
      expectedVersion: sep.version,
      acknowledgeWarnings: false,
    });
    const first = await q.report(W, sep.id);
    expect(first.comparison).toBeNull();
    expect(first.comparisonUnavailableReason).toBe('NO_PREVIOUS_PERIOD');
    await s.closePeriod({
      workspaceId: W,
      periodId: oct.id,
      expectedVersion: oct.version,
      acknowledgeWarnings: false,
    });
    const second = await q.report(W, oct.id);
    expect(second.comparison?.previousLabel).toBe('2026-09');
    expect(second.comparison?.deltas.find((d) => d.kpi === 'EXPENSE')).toMatchObject({ percentage: '0.0' });
  });

  it('[TC-PLANNING-EVENT-004] el aviso se publica una vez desde 3 días después del fin; un periodo cerrado antes del plazo no lo genera', async () => {
    const { env, sep } = setup();
    const publisher = new ClosePendingService(env.deps());
    env.mem.clock.set(Instant.parse('2026-10-03T15:00:00Z')); // 2026-10-03: aún no (fin 09-30 + 3 = 10-03 → sí)
    expect(await publisher.publishDue(W)).toEqual([sep.id]);
    expect(await publisher.publishDue(W)).toEqual([]);
    const pending = env.mem.events.filter((e) => e.eventType === 'planning.MonthClosePending');
    expect(pending).toHaveLength(1);
    expect(pending[0]!.payload).toMatchObject({
      periodLabel: '2026-09',
      pendingSince: '2026-10-01',
      delayDays: 3,
    });

    const other = new ClosingEnv();
    const p = other.mem.seed(W, '2026-09', 'ACTIVE');
    other.mem.clock.set(Instant.parse('2026-10-02T15:00:00Z'));
    await other.service().closePeriod({
      workspaceId: W,
      periodId: p.id,
      expectedVersion: p.version,
      acknowledgeWarnings: false,
    });
    other.mem.clock.set(Instant.parse('2026-10-03T15:00:00Z'));
    expect(await new ClosePendingService(other.deps()).publishDue(W)).toEqual([]);
  });

  it('el verificador detecta un candado ausente y un contenido alterado', async () => {
    const { env, sep } = setup();
    await svc(env).closePeriod({
      workspaceId: W,
      periodId: sep.id,
      expectedVersion: sep.version,
      acknowledgeWarnings: false,
    });
    const hash = (c: string) => `h:${c}`;
    // contenido coherente con su hash
    env.snapshots[0] = {
      ...env.snapshots[0]!,
      contentSha256: hash(canonicalJson(env.snapshots[0]!.content)),
    };
    const verifier = new ClosingVerifier(env.deps(), hash);
    expect(await verifier.verify(W)).toEqual([]);
    const tampered: CloseSnapshotContent = { ...env.snapshots[0]!.content, baseCurrency: 'USD' };
    env.snapshots[0] = { ...env.snapshots[0]!, content: tampered };
    expect((await verifier.verify(W)).map((v) => v.check)).toContain('HASH_MISMATCH');
    env.locks = [];
    expect((await verifier.verify(W)).map((v) => v.check)).toContain('LOCK_MISSING');
  });
});
