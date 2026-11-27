import { describe, expect, it } from 'vitest';
import { INP_TARGET_MS, INP_WARNING_MS, inpReport, inpStatus } from './inp.js';

describe('informe de INP (informativo)', () => {
  it('[TC-PLATFORM-TABLES-018] incluye el INP de los cuatro flujos con el objetivo y el aviso', () => {
    const report = inpReport([
      { flow: 'abrir fila', ms: 120 },
      { flow: 'filtrar', ms: 240 },
      { flow: 'aprobar', ms: 180 },
      { flow: 'edición masiva', ms: 90 },
    ]);
    expect(report.rows).toHaveLength(4);
    for (const row of report.rows) {
      expect(row.target).toBe(INP_TARGET_MS);
      expect(row.warning).toBe(INP_WARNING_MS);
    }
    expect(INP_TARGET_MS).toBe(200);
    expect(INP_WARNING_MS).toBe(500);
    expect(report.text).toContain('abrir fila');
    expect(report.text).toContain('240 ms');
    expect(report.rows[1]?.status).toBe('above-target');
  });

  it('[TC-PLATFORM-TABLES-018] un flujo de 650 ms se marca por encima del aviso y no lanza', () => {
    const report = inpReport([{ flow: 'filtrar', ms: 650 }]);
    expect(report.rows[0]?.status).toBe('above-warning');
    expect(report.text).toContain('por encima del aviso');
    expect(() => inpReport([{ flow: 'x', ms: 650 }])).not.toThrow();
  });

  it('[TC-PLATFORM-TABLES-018] los límites son inclusivos hacia abajo y los valores raros no rompen el informe', () => {
    expect(inpStatus(200)).toBe('ok');
    expect(inpStatus(201)).toBe('above-target');
    expect(inpStatus(500)).toBe('above-target');
    expect(inpStatus(501)).toBe('above-warning');
    const weird = inpReport([
      { flow: 'nan', ms: Number.NaN },
      { flow: 'negativo', ms: -5 },
      { flow: 'infinito', ms: Number.POSITIVE_INFINITY },
    ]);
    expect(weird.rows.map((r) => r.ms)).toEqual([0, 0, 0]);
  });
});
