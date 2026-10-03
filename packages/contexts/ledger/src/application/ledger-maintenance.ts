import { LocalDate, type Clock } from '@pf/shared-kernel';
import type {
  LedgerInvariantViolation,
  LedgerLogPort,
  LedgerMaintenanceRepository,
  MetricsPort,
} from './ports/index.js';

/** Métrica de violaciones (NFR-OBS-005): toda violación dispara la alerta crítica `LedgerInvariantViolation`. */
export const LEDGER_INVARIANT_VIOLATIONS_METRIC = 'ledger_invariant_violations_total';
export const LEDGER_SNAPSHOTS_REBUILT_METRIC = 'ledger_balance_snapshots_rebuilt_total';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface LedgerMaintenanceDeps {
  readonly repository: LedgerMaintenanceRepository;
  readonly metrics: MetricsPort;
  readonly logger: LedgerLogPort;
  readonly clock: Clock;
}

/**
 * Comandos internos del ledger (tarea 4.5; design.md §Decisiones 9 y 10). No son casos de uso de usuario: los ejecuta
 * el worker (job diario) y `restore:local`. No mutan datos de negocio (solo la caché derivada de snapshots), por eso
 * no auditan: su rastro es el log estructurado y las métricas.
 */
export class LedgerMaintenance {
  constructor(private readonly deps: LedgerMaintenanceDeps) {}

  /**
   * `RebuildBalanceSnapshots`: borra y recalcula los snapshots desde Σ postings (INV-022). Por defecto al día
   * anterior en UTC: el snapshot nunca cubre el día en curso, que sigue recibiendo asientos.
   */
  async rebuildBalanceSnapshots(
    input: {
      readonly asOfDate?: string;
      readonly workspaceId?: string;
      readonly ledgerAccountId?: string;
    } = {},
  ): Promise<{ readonly asOfDate: string; readonly workspaces: number; readonly snapshots: number }> {
    const asOfDate =
      input.asOfDate !== undefined
        ? LocalDate.parse(input.asOfDate).toString()
        : LocalDate.ofInstant(this.deps.clock.now().plusMillis(-DAY_MS), 'UTC').toString();
    const result = await this.deps.repository.rebuildSnapshots({ ...input, asOfDate });
    this.deps.metrics.increment(LEDGER_SNAPSHOTS_REBUILT_METRIC, {}, result.snapshots);
    this.deps.logger.info(
      { command: 'RebuildBalanceSnapshots', asOfDate, ...result },
      'ledger balance snapshots rebuilt',
    );
    return { asOfDate, ...result };
  }

  /**
   * `VerifyLedgerIntegrity`: Σ por moneda = 0, ≥ 2 postings, sin postings en cero, snapshot = Σ postings y reversas
   * que niegan exactamente su original. Cada violación → log `error` con `workspaceId` + métrica por invariante.
   */
  async verifyLedgerIntegrity(): Promise<{ readonly violations: readonly LedgerInvariantViolation[] }> {
    const violations = await this.deps.repository.findViolations();
    for (const v of violations) {
      this.deps.metrics.increment(LEDGER_INVARIANT_VIOLATIONS_METRIC, { invariant: v.invariant });
      this.deps.logger.error(
        { alert: 'ledger.invariant_violation', severity: 'critical', ...v },
        'ledger invariant violated',
      );
    }
    this.deps.logger.info(
      { command: 'VerifyLedgerIntegrity', violations: violations.length },
      'ledger integrity verified',
    );
    return { violations };
  }
}
