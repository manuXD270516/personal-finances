import { describe, expect, it } from 'vitest';
import { INP_TARGET_MS, INP_WARNING_MS, inpReport, inpStatus, median } from './inp.js';

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

  it('[TC-PLATFORM-PERCEIVED-005] el informe muestra cada flujo con su valor en ms y su estado frente a 200 y 500 ms, sin lanzar', () => {
    const report = inpReport([
      { flow: 'abrir fila', ms: 200 },
      { flow: 'filtrar', ms: 700 },
    ]);
    expect(report.text).toContain('200 ms');
    expect(report.text).toContain('objetivo 200, aviso 500');
    expect(report.text).toContain('dentro del objetivo');
    expect(report.text).toContain('por encima del aviso');
  });

  it('[TC-PLATFORM-PERCEIVED-022] con procesador lento el informe muestra el valor de escritorio y el de CPU ×4 por flujo', () => {
    const report = inpReport([
      { flow: 'abrir fila', ms: 200, slowMs: 640 },
      { flow: 'filtrar', ms: 136, slowMs: 310 },
      { flow: 'aprobar', ms: 72 },
    ]);
    expect(report.rows[0]).toMatchObject({ ms: 200, slowMs: 640, slowStatus: 'above-warning' });
    expect(report.rows[1]).toMatchObject({ slowMs: 310, slowStatus: 'above-target' });
    expect(report.rows[2]?.slowMs).toBeUndefined();
    expect(report.text).toContain('CPU ×4');
    expect(report.text).toContain('640 ms');
    expect(report.text).toContain('310 ms');
    // Informativo: un valor lento enorme o raro tampoco hace fallar nada.
    expect(() => inpReport([{ flow: 'x', ms: 1, slowMs: Number.NaN }])).not.toThrow();
  });

  it('[TC-PLATFORM-PERCEIVED-004] la mediana de tres corridas decide si una vista conserva la transición (≤ 200 ms)', () => {
    expect(median([208, 200, 192])).toBe(200);
    expect(median([120, 136, 144])).toBe(136);
    expect(median([300, 100])).toBe(200);
    expect(median([])).toBe(0);
  });
});
