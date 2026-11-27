import { describe, expect, it } from 'vitest';
import { durationsByProject, renderSummary, type JsonReport } from './duration-summary.js';

const report: JsonReport = {
  stats: { duration: 600_000 },
  suites: [
    {
      suites: [
        {
          specs: [
            { tests: [{ projectName: 'chromium', results: [{ duration: 60_000 }] }] },
            {
              tests: [
                { projectName: 'chromium', results: [{ duration: 30_000 }] },
                { projectName: 'webkit', results: [{ duration: 90_000 }, { duration: 30_000 }] },
              ],
            },
          ],
        },
      ],
    },
  ],
};

describe('resumen de duración por proyecto', () => {
  it('[TC-PLATFORM-PIPELINE-044] suma la duración y cuenta los tests de chromium y de webkit', () => {
    const rows = durationsByProject(report);
    expect(rows.get('chromium')).toEqual({ tests: 2, ms: 90_000 });
    expect(rows.get('webkit')).toEqual({ tests: 1, ms: 120_000 });
  });

  it('[TC-PLATFORM-PIPELINE-044] el resumen muestra las dos filas y el límite de 40 minutos', () => {
    const text = renderSummary(report);
    expect(text).toContain('| chromium | 2 | 1.5 min |');
    expect(text).toContain('| webkit | 1 | 2.0 min |');
    expect(text).toContain('límite del job: 40 min');
  });
});
