import type { AnomalyLabel } from '@pf/forecasting/interface/forecasting.module';

/** `--workspace <id>` y `--labels <ruta>` (también `--workspace=<id>`); ignora un `--` suelto de pnpm. */
export function parseBacktestArgs(argv: readonly string[]): { workspace: string; labels: string } {
  const value = (name: string): string | undefined => {
    const i = argv.findIndex((a) => a === `--${name}` || a.startsWith(`--${name}=`));
    if (i === -1) return undefined;
    const arg = argv[i] as string;
    return arg.includes('=') ? arg.slice(arg.indexOf('=') + 1) : argv[i + 1];
  };
  const workspace = value('workspace');
  const labels = value('labels');
  if (!workspace || !labels) {
    throw new Error('uso: forecast-anomalies-backtest --workspace <id> --labels <ruta.jsonl>');
  }
  return { workspace, labels };
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
