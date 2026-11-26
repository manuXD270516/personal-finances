import { LocalDate, Money, dec, present } from '@pf/shared-kernel';
import {
  ExpenseHistoryIndex,
  HISTORY_DAYS,
  SpendingAnomaly,
  SpendingAnomalyDetector,
  type ValuedExpense,
} from '../domain/index.js';
import type { AnomalyDeps, ExpenseLineInput, SpendingAnomaliesPassFact } from './anomaly-ports.js';
import { loadExpenses, scaleOfText, type TransactionGroup } from './anomaly-loading.js';

export interface AnomalyPassOutcome {
  /** Gastos evaluados (con tasa y sin evaluación previa de su versión). */
  readonly evaluated: number;
  /** Gastos no evaluados por falta de tasa. */
  readonly notRated: number;
  /** Gastos atípicos nuevos. */
  readonly flagged: number;
  /** Gastos atípicos de versiones anteriores reemplazados. */
  readonly superseded: number;
}

export interface AnomalySummary {
  readonly workspaces: number;
  readonly evaluated: number;
  readonly flagged: number;
  readonly purged: number;
  /** Workspaces (o el barrido de retención) que fallaron; solo el nombre del error. */
  readonly failed: number;
  readonly errors: readonly string[];
}

const DAY_MS = 86_400_000;
/** Los registros de versiones evaluadas se purgan a los 30 días (decisión 6). */
export const SCAN_RETENTION_DAYS = 30;
/** Retención de los gastos atípicos: transacciones de hace más de 25 meses (decisión 12). */
export const ANOMALY_RETENTION_MONTHS = 25;

const NONE: AnomalyPassOutcome = { evaluated: 0, notRated: 0, flagged: 0, superseded: 0 };

/** Fecha `n` meses antes (conserva el día o lo recorta al último del mes). */
export function minusMonths(date: LocalDate, months: number): LocalDate {
  const index = date.year * 12 + (date.month - 1) - months;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  const last = LocalDate.of(year, month, 1).lengthOfMonth();
  return LocalDate.of(year, month, Math.min(date.day, last));
}

/**
 * `DetectSpendingAnomalies` (openspec add-spending-anomaly-detection, decisión 6; D473): paso diario de `forecasting.schedule`.
 * Por workspace y UNO a UNO, en su unidad de trabajo: carga la historia de 365 + 7 días, evalúa los gastos de los últimos
 * `lookbackDays` cuya versión vigente no tiene evaluación y registra los atípicos, las versiones evaluadas y el aviso para
 * NOTIFICATIONS, todo en la misma transacción. Sin consultas en paralelo sobre el mismo cliente.
 */
export class DetectSpendingAnomalies {
  constructor(private readonly deps: AnomalyDeps) {}

  /** Todos los workspaces; la falla de uno se registra y no corta a los demás. Luego, la retención. */
  async run(): Promise<AnomalySummary> {
    const { deps } = this;
    if (!deps.settings.enabled) {
      return { workspaces: 0, evaluated: 0, flagged: 0, purged: 0, failed: 0, errors: [] };
    }
    let workspaces = 0;
    let evaluated = 0;
    let flagged = 0;
    let purged = 0;
    const errors: string[] = [];
    for (const { workspaceId } of await deps.workspaces.list()) {
      try {
        const outcome = await this.runWorkspace(workspaceId);
        workspaces += 1;
        evaluated += outcome.evaluated;
        flagged += outcome.flagged;
      } catch (err) {
        errors.push(err instanceof Error ? err.name : typeof err);
      }
    }
    try {
      purged = await this.purge();
    } catch (err) {
      errors.push(err instanceof Error ? err.name : typeof err);
    }
    return { workspaces, evaluated, flagged, purged, failed: errors.length, errors };
  }

  runWorkspace(workspaceId: string): Promise<AnomalyPassOutcome> {
    const { deps } = this;
    const started = performance.now();
    return deps.uow
      .run(workspaceId, () => this.pass(workspaceId))
      .finally(() => deps.metrics.passDuration((performance.now() - started) / 1000));
  }

  private async pass(workspaceId: string): Promise<AnomalyPassOutcome> {
    const { deps } = this;
    const { thresholds } = deps.settings;
    const ws = await deps.settingsOf.settingsOf(workspaceId);
    const now = deps.clock.now();
    const today = LocalDate.ofInstant(now, ws.timeZone);
    const targetFrom = today.plusDays(-deps.settings.lookbackDays);
    const historyFrom = targetFrom.plusDays(-HISTORY_DAYS);
    const { target, items } = await loadExpenses(
      deps,
      workspaceId,
      ws,
      { from: historyFrom.toString(), to: today.toString() },
      now,
    );
    const targetFromText = targetFrom.toString();
    if (!items.some((i) => i.group.date >= targetFromText)) return NONE;
    const valued: ValuedExpense[] = [];
    const targets: { group: TransactionGroup; expense: ValuedExpense | null }[] = [];
    for (const { group, expense } of items) {
      if (expense) valued.push(expense);
      if (group.date >= targetFromText) targets.push({ group, expense });
    }
    const index = new ExpenseHistoryIndex(valued);

    const sinceIso = now.plusMillis(-SCAN_RETENTION_DAYS * DAY_MS).toString();
    const alreadyEvaluated = await deps.scans.evaluated(workspaceId, sinceIso);
    const pending = targets
      .filter((t) => !alreadyEvaluated.has(`${t.group.transactionId}:${t.group.version}`))
      .sort((a, b) =>
        a.group.date === b.group.date
          ? a.group.transactionId.localeCompare(b.group.transactionId)
          : a.group.date.localeCompare(b.group.date),
      );
    const notRated = pending.filter((t) => t.expense === null).length;
    const rated = pending.filter(
      (t): t is { group: TransactionGroup; expense: ValuedExpense } => t.expense !== null,
    );
    if (notRated > 0) deps.metrics.notRated(notRated);
    if (rated.length === 0) return { ...NONE, notRated };

    // Versiones anteriores de las transacciones evaluadas: quedan reemplazadas por la versión vigente.
    const existing = await deps.anomalies.byTransactionIds(
      workspaceId,
      rated.map((t) => t.group.transactionId),
    );
    let superseded = 0;
    const supersededTx = new Set<string>();
    for (const t of rated) {
      const older = existing.find(
        (a) =>
          a.snapshot.transactionId === t.group.transactionId &&
          a.snapshot.transactionVersion < t.group.version,
      );
      if (older && !supersededTx.has(t.group.transactionId)) {
        supersededTx.add(t.group.transactionId);
        superseded += await deps.anomalies.supersedeOlder(
          workspaceId,
          t.group.transactionId,
          t.group.version,
        );
      }
    }

    const created: SpendingAnomaly[] = [];
    const nowText = now.toString();
    for (const { group, expense } of rated) {
      const reasons = SpendingAnomalyDetector.detect(
        expense,
        index.historyFor(group.date),
        thresholds,
        ws.reportingScale,
      );
      if (reasons.length === 0) continue;
      const first = group.lines[0] as ExpenseLineInput;
      const scale = scaleOfText(first.amount.amount);
      // Monto del gasto en su moneda: Σ de las porciones con la aritmética de `Money` (misma escala, sin redondeo).
      const nativeTotal = group.lines
        .map((l) => Money.parse(l.amount.amount, l.amount.currency, scale))
        .reduce((sum, m) => sum.add(m));
      const anomaly = SpendingAnomaly.detect({
        id: deps.ids.next(),
        workspaceId,
        transactionId: group.transactionId,
        transactionVersion: group.version,
        transactionDate: group.date,
        amount: nativeTotal.toJSON(),
        reportingAmount: present(expense.total, target).toJSON(),
        categoryIds: [...new Set(group.lines.map((l) => l.categoryId))],
        counterpartyId: group.counterpartyId,
        reasons,
        at: nowText,
      });
      if (await deps.anomalies.insert(anomaly)) {
        created.push(anomaly);
        for (const r of reasons) deps.metrics.flagged(r.kind, 1);
      }
    }
    await deps.scans.record(
      workspaceId,
      rated.map((t) => ({ transactionId: t.group.transactionId, version: t.group.version })),
      nowText,
    );
    deps.metrics.evaluated(rated.length);

    if (created.length > 0 && deps.notifier) {
      const top = [...created].sort((a, b) =>
        dec(b.snapshot.reportingAmount.amount).comparedTo(dec(a.snapshot.reportingAmount.amount)),
      )[0] as SpendingAnomaly;
      const fact: SpendingAnomaliesPassFact = {
        workspaceId,
        passDate: today.toString(),
        count: created.length,
        top: {
          anomalyId: top.id,
          transactionDate: top.snapshot.transactionDate,
          reportingAmount: top.snapshot.reportingAmount,
          reasons: top.snapshot.reasons.map((r) => r.kind),
        },
        timeZone: ws.timeZone,
        passId: deps.ids.next(),
        occurredAt: nowText,
      };
      await deps.notifier.notify(fact);
    }
    return { evaluated: rated.length, notRated, flagged: created.length, superseded };
  }

  /**
   * Retención (decisión 12): los gastos atípicos de transacciones de hace más de 25 meses y las evaluaciones de hace más
   * de 30 días, por el rol de mantenimiento (barrido) y el borrado en la unidad de trabajo de cada workspace.
   */
  async purge(): Promise<number> {
    const { deps } = this;
    const now = deps.clock.now();
    const input = {
      transactionBefore: minusMonths(LocalDate.ofInstant(now, 'UTC'), ANOMALY_RETENTION_MONTHS).toString(),
      scanBeforeIso: now.plusMillis(-SCAN_RETENTION_DAYS * DAY_MS).toString(),
    };
    let purged = 0;
    for (const workspaceId of await deps.maintenance.purgeCandidates(input)) {
      const done = await deps.uow.run(workspaceId, () => deps.maintenance.purge(workspaceId, input));
      purged += done.anomalies + done.scans;
    }
    return purged;
  }
}
