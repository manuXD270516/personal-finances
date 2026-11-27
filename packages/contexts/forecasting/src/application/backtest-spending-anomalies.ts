import { LocalDate } from '@pf/shared-kernel';
import {
  ExpenseHistoryIndex,
  SpendingAnomalyDetector,
  type AnomalyReasonKind,
  type AnomalyThresholds,
  type ValuedExpense,
} from '../domain/index.js';
import type { AnomalyDeps } from './anomaly-ports.js';
import { loadExpenses } from './anomaly-loading.js';

/** Etiquetas del Large Seed (docs/29 §2.3) que cuentan como gasto atípico esperado (D483). */
export const POSITIVE_LABELS: readonly string[] = ['OUTLIER', 'NEW_COUNTERPARTY_FRAUD'];
/** Umbrales de salida de la evaluación con el Large Seed a escala completa (D483 revisado por D514: 0.80 y 0.85). */
export const MIN_PRECISION = '0.80';
export const MIN_RECALL = '0.85';

export interface AnomalyLabel {
  readonly transactionId: string;
  /** `OUTLIER`, `NEW_COUNTERPARTY_FRAUD`, `DUPLICATE_CHARGE`, `SUBSCRIPTION_PRICE_HIKE`, `P2P_RATE_JUMP`… */
  readonly kind: string;
}

export interface BacktestFlag {
  readonly transactionId: string;
  readonly reasons: readonly AnomalyReasonKind[];
}

/** Umbrales usados en una evaluación (de detección y de salida), en texto: sin montos ni descripciones. */
export interface BacktestThresholds {
  readonly robustZ: string;
  readonly minRatio: string;
  readonly minSample: number;
  readonly newCounterpartyPercentile: number;
  readonly minPrecision: string;
  readonly minRecall: string;
}

/** Informe de la evaluación: solo conteos y razones, sin montos ni descripciones. */
export interface AnomalyBacktestReport {
  /** Gastos evaluados (con tasa) y marcados. */
  readonly evaluated: number;
  readonly flagged: number;
  /** Gastos marcados con etiqueta `OUTLIER` o `NEW_COUNTERPARTY_FRAUD`. */
  readonly truePositives: number;
  /** Marcados con otra etiqueta (no cuentan en la precisión). */
  readonly otherLabelFlagged: number;
  /** Marcados sin etiqueta. */
  readonly unlabeledFlagged: number;
  /** Gastos con las etiquetas esperadas. */
  readonly expected: number;
  /** Precisión y recall con 4 decimales; `null` sin denominador. */
  readonly precision: string | null;
  readonly recall: string | null;
  readonly flaggedByCriterion: Readonly<Record<string, number>>;
  readonly flaggedByLabel: Readonly<Record<string, number>>;
  /** Marcados sin etiqueta por criterio (un gasto con dos motivos cuenta en los dos): dice qué criterio se degradó (D514). */
  readonly unlabeledByCriterion: Readonly<Record<string, number>>;
  /** Umbrales usados; `null` si el cálculo no los recibió. */
  readonly thresholds: BacktestThresholds | null;
  /** Cumple `precisión ≥ 0.80` y `recall ≥ 0.85` (los umbrales de salida del informe). */
  readonly passes: boolean;
}

const ratio = (n: number, d: number): string | null => (d === 0 ? null : (n / d).toFixed(4));

/** Cálculo del informe (TC-FORECAST-ANOMALY-025): puro, sin montos ni descripciones. */
export function buildBacktestReport(input: {
  readonly evaluated: number;
  readonly flags: readonly BacktestFlag[];
  readonly labels: readonly AnomalyLabel[];
  readonly minPrecision?: string;
  readonly minRecall?: string;
  /** Umbrales de detección usados (se publican en el informe). */
  readonly thresholds?: AnomalyThresholds;
}): AnomalyBacktestReport {
  const labelOf = new Map<string, string>();
  for (const l of input.labels) if (!labelOf.has(l.transactionId)) labelOf.set(l.transactionId, l.kind);
  const expectedIds = new Set(
    input.labels.filter((l) => POSITIVE_LABELS.includes(l.kind)).map((l) => l.transactionId),
  );
  let truePositives = 0;
  let other = 0;
  let unlabeled = 0;
  const byCriterion: Record<string, number> = {};
  const byLabel: Record<string, number> = {};
  const unlabeledByCriterion: Record<string, number> = {};
  for (const f of input.flags) {
    for (const r of f.reasons) byCriterion[r] = (byCriterion[r] ?? 0) + 1;
    const label = labelOf.get(f.transactionId);
    byLabel[label ?? 'NONE'] = (byLabel[label ?? 'NONE'] ?? 0) + 1;
    if (label === undefined) {
      unlabeled += 1;
      for (const r of f.reasons) unlabeledByCriterion[r] = (unlabeledByCriterion[r] ?? 0) + 1;
    } else if (POSITIVE_LABELS.includes(label)) truePositives += 1;
    else other += 1;
  }
  // La precisión no cuenta los gastos marcados con otras etiquetas (duplicados, cambios de precio, saltos de tasa: D475).
  const precision = ratio(truePositives, truePositives + unlabeled);
  const recall = ratio(truePositives, expectedIds.size);
  const minPrecision = input.minPrecision ?? MIN_PRECISION;
  const minRecall = input.minRecall ?? MIN_RECALL;
  const passes =
    precision !== null &&
    recall !== null &&
    Number(precision) >= Number(minPrecision) &&
    Number(recall) >= Number(minRecall);
  return {
    evaluated: input.evaluated,
    flagged: input.flags.length,
    truePositives,
    otherLabelFlagged: other,
    unlabeledFlagged: unlabeled,
    expected: expectedIds.size,
    precision,
    recall,
    flaggedByCriterion: byCriterion,
    flaggedByLabel: byLabel,
    unlabeledByCriterion,
    thresholds: input.thresholds
      ? {
          robustZ: input.thresholds.robustZ.toString(),
          minRatio: input.thresholds.minRatio.toString(),
          minSample: input.thresholds.minSample,
          newCounterpartyPercentile: input.thresholds.newCounterpartyPercentile,
          minPrecision,
          minRecall,
        }
      : null,
    passes,
  };
}

/**
 * `BacktestSpendingAnomalies` (openspec add-spending-anomaly-detection, decisión 11; D483): recorre TODA la historia del
 * workspace en orden de fecha, evalúa cada gasto con sus 365 días anteriores y devuelve los marcados, sin persistir nada (con umbrales opcionales por corrida).
 * Lo usan `pnpm forecast:anomalies:backtest` y la fila del nightly con el Large Seed. Lecturas en serie.
 */
export class BacktestSpendingAnomalies {
  constructor(private readonly deps: AnomalyDeps) {}

  /** Umbrales de detección de una corrida: los configurados con los reemplazos opcionales (D514); no cambia la configuración. */
  thresholdsFor(overrides?: Partial<AnomalyThresholds>): AnomalyThresholds {
    return { ...this.deps.settings.thresholds, ...overrides };
  }

  run(
    workspaceId: string,
    overrides?: Partial<AnomalyThresholds>,
  ): Promise<{ readonly evaluated: number; readonly flags: readonly BacktestFlag[] }> {
    const { deps } = this;
    const thresholds = this.thresholdsFor(overrides);
    return deps.uow.run(workspaceId, async () => {
      const ws = await deps.settingsOf.settingsOf(workspaceId);
      const now = deps.clock.now();
      const today = LocalDate.ofInstant(now, ws.timeZone);
      const { items } = await loadExpenses(
        deps,
        workspaceId,
        ws,
        { from: '1970-01-01', to: today.toString() },
        now,
      );
      const valued = items.flatMap((i) => (i.expense ? [i.expense] : []));
      const index = new ExpenseHistoryIndex(valued);
      const ordered: ValuedExpense[] = [...valued].sort((a, b) =>
        a.date === b.date ? a.transactionId.localeCompare(b.transactionId) : a.date.localeCompare(b.date),
      );
      const flags: BacktestFlag[] = [];
      for (const expense of ordered) {
        const reasons = SpendingAnomalyDetector.detect(
          expense,
          index.historyFor(expense.date),
          thresholds,
          ws.reportingScale,
        );
        if (reasons.length > 0)
          flags.push({ transactionId: expense.transactionId, reasons: reasons.map((r) => r.kind) });
      }
      return { evaluated: ordered.length, flags };
    });
  }

  /** Evalúa y compara con las etiquetas. */
  async report(
    workspaceId: string,
    labels: readonly AnomalyLabel[],
    overrides?: Partial<AnomalyThresholds>,
  ): Promise<AnomalyBacktestReport> {
    const { evaluated, flags } = await this.run(workspaceId, overrides);
    return buildBacktestReport({ evaluated, flags, labels, thresholds: this.thresholdsFor(overrides) });
  }
}

/** Texto del informe (una línea por dato; sin montos ni descripciones). */
export function formatBacktestReport(r: AnomalyBacktestReport): string {
  const lines = [
    `evaluated\t${r.evaluated}`,
    `flagged\t${r.flagged}`,
    `true_positives\t${r.truePositives}`,
    `other_label_flagged\t${r.otherLabelFlagged}`,
    `unlabeled_flagged\t${r.unlabeledFlagged}`,
    `expected\t${r.expected}`,
    `precision\t${r.precision ?? 'n/a'}\t(min ${r.thresholds?.minPrecision ?? MIN_PRECISION})`,
    `recall\t${r.recall ?? 'n/a'}\t(min ${r.thresholds?.minRecall ?? MIN_RECALL})`,
    ...(r.thresholds
      ? [
          `threshold\trobust_z\t${r.thresholds.robustZ}`,
          `threshold\tmin_ratio\t${r.thresholds.minRatio}`,
          `threshold\tmin_sample\t${r.thresholds.minSample}`,
          `threshold\tnew_counterparty_percentile\t${r.thresholds.newCounterpartyPercentile}`,
        ]
      : []),
    ...Object.entries(r.flaggedByCriterion)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `by_criterion\t${k}\t${v}`),
    ...Object.entries(r.unlabeledByCriterion)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `unlabeled_by_criterion\t${k}\t${v}`),
    ...Object.entries(r.flaggedByLabel)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `by_label\t${k}\t${v}`),
    `result\t${r.passes ? 'PASS' : 'FAIL'}`,
  ];
  return lines.join('\n');
}
