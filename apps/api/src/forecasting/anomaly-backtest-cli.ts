import type { AnomalyLabel, AnomalyThresholds } from '@pf/forecasting/interface/forecasting.module';
import { dec } from '@pf/shared-kernel';

const USAGE =
  'uso: forecast-anomalies-backtest --workspace <id> --labels <ruta.jsonl> [--robust-z N] [--min-ratio N] [--min-sample N] [--new-counterparty-percentile N]';

/** Un número decimal positivo (mismos rangos que la configuración del worker). */
function positiveNumber(name: string, raw: string): number {
  if (!/^\d+(\.\d+)?$/u.test(raw) || !(Number(raw) > 0)) {
    throw new Error(`--${name} debe ser un número mayor que cero (recibido "${raw}")`);
  }
  return Number(raw);
}

/**
 * `--workspace <id>` y `--labels <ruta>` (también `--workspace=<id>`); ignora un `--` suelto de pnpm. Los umbrales
 * `--robust-z`, `--min-ratio`, `--min-sample` y `--new-counterparty-percentile` son opcionales (D514): reemplazan a los
 * configurados solo para esa corrida, con los mismos rangos de la configuración del worker.
 */
export function parseBacktestArgs(argv: readonly string[]): {
  workspace: string;
  labels: string;
  thresholds: Partial<AnomalyThresholds>;
} {
  const value = (name: string): string | undefined => {
    const i = argv.findIndex((a) => a === `--${name}` || a.startsWith(`--${name}=`));
    if (i === -1) return undefined;
    const arg = argv[i] as string;
    return arg.includes('=') ? arg.slice(arg.indexOf('=') + 1) : argv[i + 1];
  };
  const workspace = value('workspace');
  const labels = value('labels');
  if (!workspace || !labels) {
    throw new Error(USAGE);
  }
  const thresholds: { -readonly [K in keyof AnomalyThresholds]?: AnomalyThresholds[K] } = {};
  const robustZ = value('robust-z');
  if (robustZ !== undefined) thresholds.robustZ = dec(String(positiveNumber('robust-z', robustZ)));
  const minRatio = value('min-ratio');
  if (minRatio !== undefined) thresholds.minRatio = dec(String(positiveNumber('min-ratio', minRatio)));
  const minSample = value('min-sample');
  if (minSample !== undefined) {
    const n = positiveNumber('min-sample', minSample);
    if (!Number.isInteger(n))
      throw new Error(`--min-sample debe ser un entero positivo (recibido "${minSample}")`);
    thresholds.minSample = n;
  }
  const percentile = value('new-counterparty-percentile');
  if (percentile !== undefined) {
    const n = positiveNumber('new-counterparty-percentile', percentile);
    if (n > 100)
      throw new Error(`--new-counterparty-percentile debe estar en (0, 100] (recibido "${percentile}")`);
    thresholds.newCounterpartyPercentile = n;
  }
  return { workspace, labels, thresholds };
}

/** JSONL del seed (`workspaceId`, `transactionId`, `kind`): solo las etiquetas del workspace con transacción. */
export function parseLabels(jsonl: string, workspaceId: string): AnomalyLabel[] {
  const out: AnomalyLabel[] = [];
  for (const raw of jsonl.split('\n')) {
    if (raw.trim() === '') continue;
    const row = JSON.parse(raw) as { workspaceId?: string; transactionId?: string | null; kind?: string };
    if (row.workspaceId === workspaceId && row.transactionId && row.kind) {
      out.push({ transactionId: row.transactionId, kind: row.kind });
    }
  }
  return out;
}
