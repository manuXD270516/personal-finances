import { DomainError, dec } from '@pf/shared-kernel';
import { canonicalJson } from '../domain/index.js';
import type { ClosingDeps } from './ports/index.js';

export const CLOSING_VIOLATIONS_METRIC = 'planning_closing_violations_total';

export type ClosingCheck = 'BALANCE_MISMATCH' | 'HASH_MISMATCH' | 'LOCK_MISSING' | 'LOCK_ORPHAN';

export interface ClosingViolation {
  readonly check: ClosingCheck;
  readonly periodId: string;
  readonly label: string;
  readonly detail: string;
}

/**
 * Verificador `planning.verify-closings` (design.md decisión 14, NFR-DATA-008), solo lectura: para cada periodo
 * `CLOSED`, (1) los saldos del snapshot vigente igualan Σ postings a `periodEnd` (INV-022), (2) el `content_sha256`
 * coincide con el contenido releído y (3) el rango está bloqueado en el ledger; ningún periodo no cerrado debe tener su
 * rango bloqueado. Cada violación incrementa `planning_closing_violations_total{check}`.
 */
export class ClosingVerifier {
  constructor(
    private readonly deps: Pick<
      ClosingDeps,
      'uow' | 'periods' | 'snapshots' | 'balances' | 'ledger' | 'metrics'
    >,
    private readonly hashOf: (canonical: string) => string,
  ) {}

  verify(workspaceId: string): Promise<readonly ClosingViolation[]> {
    return this.deps.uow.run(workspaceId, async () => {
      const violations: ClosingViolation[] = [];
      const snapshots = new Map(
        (await this.deps.snapshots.listAllCurrent(workspaceId)).map((s) => [s.periodId, s]),
      );
      for (const period of await this.deps.periods.list(workspaceId)) {
        const s = period.snapshot;
        const add = (check: ClosingCheck, detail: string) =>
          violations.push({ check, periodId: s.id, label: s.label, detail });
        const locked = await this.isLocked(workspaceId, s.periodEnd);
        if (s.status !== 'CLOSED') {
          if (locked && s.status !== 'DRAFT')
            add('LOCK_ORPHAN', `period ${s.label} is ${s.status} but locked`);
          continue;
        }
        if (!locked) add('LOCK_MISSING', `period ${s.label} is CLOSED but its range is not locked`);
        const snap = snapshots.get(s.id);
        if (!snap) {
          add('BALANCE_MISMATCH', `period ${s.label} is CLOSED without snapshot`);
          continue;
        }
        if (this.hashOf(canonicalJson(snap.content)) !== snap.contentSha256) {
          add('HASH_MISMATCH', `snapshot ${snap.closeNo} of ${s.label} does not match its hash`);
        }
        const live = await this.deps.balances.getAccountBalances({
          workspaceId,
          accountIds: snap.content.balances.map((b) => b.accountId),
          asOf: s.periodEnd,
        });
        const liveBy = new Map(live.balances.map((b) => [b.accountId, b.balance.amount]));
        for (const b of snap.content.balances) {
          const now = liveBy.get(b.accountId) ?? '0';
          if (!dec(now).eq(b.balance.amount)) {
            add('BALANCE_MISMATCH', `${b.accountName}: snapshot ${b.balance.amount}, ledger ${now}`);
          }
        }
      }
      for (const v of violations) this.deps.metrics?.increment(CLOSING_VIOLATIONS_METRIC, { check: v.check });
      return violations;
    });
  }

  private async isLocked(workspaceId: string, date: string): Promise<boolean> {
    try {
      await this.deps.ledger.assertPeriodOpen({ workspaceId, date });
      return false;
    } catch (err) {
      if (err instanceof DomainError && err.code === 'PERIOD_CLOSED') return true;
      throw err;
    }
  }
}
