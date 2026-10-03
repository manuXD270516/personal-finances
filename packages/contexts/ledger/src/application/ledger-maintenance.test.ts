import { FixedClock, Instant } from '@pf/shared-kernel';
import { describe, expect, it } from 'vitest';
import { LEDGER_INVARIANT_VIOLATIONS_METRIC, LedgerMaintenance } from './ledger-maintenance.js';
import type { LedgerInvariantViolation, LedgerMaintenanceRepository } from './ports/index.js';

function setup(violations: LedgerInvariantViolation[] = []) {
  const calls: { asOfDate: string; workspaceId?: string }[] = [];
  const metrics: { name: string; labels: Record<string, string>; value: number | undefined }[] = [];
  const logs: { level: 'info' | 'error'; fields: Record<string, unknown> }[] = [];
  const repository: LedgerMaintenanceRepository = {
    rebuildSnapshots: async (input) => {
      calls.push(input);
      return { workspaces: 1, snapshots: 3 };
    },
    findViolations: async () => violations,
  };
  const maintenance = new LedgerMaintenance({
    repository,
    clock: new FixedClock(Instant.parse('2026-02-01T02:30:00Z')),
    metrics: { increment: (name, labels, value) => metrics.push({ name, labels: { ...labels }, value }) },
    logger: {
      info: (fields) => logs.push({ level: 'info', fields }),
      error: (fields) => logs.push({ level: 'error', fields }),
    },
  });
  return { maintenance, calls, metrics, logs };
}

describe('LedgerMaintenance — comandos internos (tarea 4.5)', () => {
  it('RebuildBalanceSnapshots usa por defecto el día anterior en UTC y registra métrica y log estructurado', async () => {
    const { maintenance, calls, metrics, logs } = setup();
    const result = await maintenance.rebuildBalanceSnapshots();
    expect(result).toEqual({ asOfDate: '2026-01-31', workspaces: 1, snapshots: 3 });
    expect(calls).toEqual([{ asOfDate: '2026-01-31' }]);
    expect(metrics).toEqual([{ name: 'ledger_balance_snapshots_rebuilt_total', labels: {}, value: 3 }]);
    expect(logs[0]?.fields).toMatchObject({ command: 'RebuildBalanceSnapshots', asOfDate: '2026-01-31' });
  });

  it('RebuildBalanceSnapshots valida la fecha explícita', async () => {
    const { maintenance } = setup();
    await expect(maintenance.rebuildBalanceSnapshots({ asOfDate: '2026-13-01' })).rejects.toThrow();
  });

  it('VerifyLedgerIntegrity: cada violación → log error con workspaceId + métrica por invariante', async () => {
    const v: LedgerInvariantViolation = {
      invariant: 'INV-022',
      workspaceId: 'w1',
      ledgerAccountId: 'a1',
      asOfDate: '2026-01-31',
      currency: 'BOB',
      difference: '4.50',
      detail: 'balance snapshot differs from the sum of postings',
    };
    const { maintenance, metrics, logs } = setup([v]);
    const result = await maintenance.verifyLedgerIntegrity();
    expect(result.violations).toEqual([v]);
    expect(metrics).toEqual([
      { name: LEDGER_INVARIANT_VIOLATIONS_METRIC, labels: { invariant: 'INV-022' }, value: undefined },
    ]);
    expect(logs.filter((l) => l.level === 'error')[0]?.fields).toMatchObject({
      alert: 'ledger.invariant_violation',
      severity: 'critical',
      workspaceId: 'w1',
      difference: '4.50',
    });
  });

  it('VerifyLedgerIntegrity sin violaciones no toca la métrica ni emite errores', async () => {
    const { maintenance, metrics, logs } = setup();
    await maintenance.verifyLedgerIntegrity();
    expect(metrics).toEqual([]);
    expect(logs.every((l) => l.level === 'info')).toBe(true);
  });
});
