import { describe, expect, it } from 'vitest';
import { evaluateReadModelAlert, UPCOMING_READ_MODEL_ALERT } from './upcoming-read-model-alert.js';

const series = (n: number, p95Seconds: number, maxRows = 1200) =>
  Array.from({ length: n }, () => ({ p95Seconds, maxRows }));

describe('UpcomingPaymentsReadModelRecommended (docs/35 D117)', () => {
  it('[TC-REPORTING-UPCOMING-022] p95 de 0.42 s durante 15 minutos dispara la alerta con el enlace al diseño', () => {
    const state = evaluateReadModelAlert(series(15, 0.42));
    expect(state.firing).toBe(true);
    expect(state.reasons).toEqual(['SLOW_P95']);
    expect(state.runbook).toContain('design.md#evolución-a-read-model');
  });

  it('[TC-REPORTING-UPCOMING-022] p95 de 0.08 s y 1 200 ocurrencias por consulta no dispara', () => {
    expect(evaluateReadModelAlert(series(30, 0.08, 1200)).firing).toBe(false);
  });

  it('[TC-REPORTING-UPCOMING-022] 14 minutos lentos no bastan; un minuto bueno en la ventana la rompe', () => {
    expect(evaluateReadModelAlert(series(14, 0.42)).firing).toBe(false);
    const broken = [...series(7, 0.42), ...series(1, 0.1), ...series(7, 0.42)];
    expect(evaluateReadModelAlert(broken).firing).toBe(false);
  });

  it('[TC-REPORTING-UPCOMING-022] el umbral es exclusivo: p95 de exactamente 300 ms no dispara', () => {
    expect(evaluateReadModelAlert(series(15, UPCOMING_READ_MODEL_ALERT.p95ThresholdSeconds)).firing).toBe(
      false,
    );
  });

  it('[TC-REPORTING-UPCOMING-022] una consulta con más de 5 000 ocurrencias dispara por volumen', () => {
    const state = evaluateReadModelAlert([{ p95Seconds: 0.05, maxRows: 5001 }]);
    expect(state).toMatchObject({ firing: true, reasons: ['TOO_MANY_ROWS'] });
    expect(evaluateReadModelAlert([{ p95Seconds: 0.05, maxRows: 5000 }]).firing).toBe(false);
  });
});
