import { describe, expect, it } from 'vitest';
import { parseBacktestArgs, parseLabels } from './anomaly-backtest-cli.js';

describe('forecast:anomalies:backtest (argumentos y etiquetas)', () => {
  it('[TC-FORECAST-ANOMALY-025] acepta --workspace y --labels, con espacio o con =, e ignora un -- suelto de pnpm', () => {
    expect(parseBacktestArgs(['--', '--workspace', 'w1', '--labels', 'a.jsonl'])).toEqual({
      workspace: 'w1',
      labels: 'a.jsonl',
      thresholds: {},
    });
    expect(parseBacktestArgs(['--workspace=w1', '--labels=b.jsonl'])).toEqual({
      workspace: 'w1',
      labels: 'b.jsonl',
      thresholds: {},
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

describe('forecast:anomalies:backtest (umbrales por argumento)', () => {
  const base = ['--workspace', 'w1', '--labels', 'a.jsonl'];

  it('[TC-FORECAST-ANOMALY-032] sin umbrales por argumento no hay reemplazos', () => {
    expect(parseBacktestArgs(base).thresholds).toEqual({});
  });

  it('[TC-FORECAST-ANOMALY-032] --robust-z 10 y --new-counterparty-percentile 99.5 reemplazan solo esos dos umbrales', () => {
    const { thresholds } = parseBacktestArgs([
      '--',
      ...base,
      '--robust-z',
      '10',
      '--new-counterparty-percentile=99.5',
    ]);
    expect(Object.keys(thresholds).sort()).toEqual(['newCounterpartyPercentile', 'robustZ']);
    expect(thresholds.robustZ?.toString()).toBe('10');
    expect(thresholds.newCounterpartyPercentile).toBe(99.5);
  });

  it('[TC-FORECAST-ANOMALY-032] --min-ratio y --min-sample se aceptan con los rangos de la configuración', () => {
    const { thresholds } = parseBacktestArgs([...base, '--min-ratio', '4.5', '--min-sample', '12']);
    expect(thresholds.minRatio?.toString()).toBe('4.5');
    expect(thresholds.minSample).toBe(12);
  });

  it('[TC-FORECAST-ANOMALY-032] rechaza valores fuera de rango o no numéricos', () => {
    expect(() => parseBacktestArgs([...base, '--robust-z', '0'])).toThrow(/--robust-z/);
    expect(() => parseBacktestArgs([...base, '--robust-z', 'abc'])).toThrow(/--robust-z/);
    expect(() => parseBacktestArgs([...base, '--min-ratio', '-1'])).toThrow(/--min-ratio/);
    expect(() => parseBacktestArgs([...base, '--min-sample', '2.5'])).toThrow(/--min-sample/);
    expect(() => parseBacktestArgs([...base, '--new-counterparty-percentile', '100.5'])).toThrow(
      /--new-counterparty-percentile/,
    );
  });
});
