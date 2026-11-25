import { describe, expect, it } from 'vitest';
import { parseBacktestArgs, parseLabels } from './anomaly-backtest-cli.js';

describe('forecast:anomalies:backtest (argumentos y etiquetas)', () => {
  it('[TC-FORECAST-ANOMALY-025] acepta --workspace y --labels, con espacio o con =, e ignora un -- suelto de pnpm', () => {
    expect(parseBacktestArgs(['--', '--workspace', 'w1', '--labels', 'a.jsonl'])).toEqual({
      workspace: 'w1',
      labels: 'a.jsonl',
    });
    expect(parseBacktestArgs(['--workspace=w1', '--labels=b.jsonl'])).toEqual({
      workspace: 'w1',
      labels: 'b.jsonl',
    });
  });

  it('[TC-FORECAST-ANOMALY-025] sin --workspace o sin --labels falla con el uso', () => {
    expect(() => parseBacktestArgs(['--workspace', 'w1'])).toThrow(/uso:/);
    expect(() => parseBacktestArgs([])).toThrow(/uso:/);
  });

  it('[TC-FORECAST-ANOMALY-025] toma solo las etiquetas del workspace con su transacción', () => {
    const jsonl = [
      { workspaceId: 'w1', transactionId: 't1', kind: 'OUTLIER' },
      { workspaceId: 'w1', transactionId: null, kind: 'P2P_RATE_JUMP' },
      { workspaceId: 'w2', transactionId: 't2', kind: 'OUTLIER' },
      { workspaceId: 'w1', transactionId: 't3', kind: 'NEW_COUNTERPARTY_FRAUD' },
    ]
      .map((r) => JSON.stringify(r))
      .join('\n');
    expect(parseLabels(`${jsonl}\n\n`, 'w1')).toEqual([
      { transactionId: 't1', kind: 'OUTLIER' },
      { transactionId: 't3', kind: 'NEW_COUNTERPARTY_FRAUD' },
    ]);
  });
});
