import { describe, expect, it } from 'vitest';
import { loadWorkflow, type Step } from './helpers.js';

const TITLE = 'nightly perf: umbral superado';
const workflow = loadWorkflow('.github/workflows/nightly.yml');
const perf = workflow.jobs['perf']!;

describe('nightly.yml: permisos y aviso por issue del job perf (TC-PLATFORM-PIPELINE-009)', () => {
  it('[TC-PLATFORM-PIPELINE-009] issues: write nunca se declara a nivel de workflow', () => {
    expect(workflow.permissions).toEqual({ contents: 'read' });
  });

  it('[TC-PLATFORM-PIPELINE-009] solo los jobs perf y fx-smoke-live declaran issues: write', () => {
    const writers = Object.entries(workflow.jobs)
      .filter(([, job]) => job.permissions?.['issues'] === 'write')
      .map(([name]) => name)
      .sort();
    expect(writers).toEqual(['fx-smoke-live', 'perf']);
  });

  it('[TC-PLATFORM-PIPELINE-009] el job perf tiene exactamente contents: read e issues: write', () => {
    expect(perf.permissions).toEqual({ contents: 'read', issues: 'write' });
  });

  const notice = (): Step => {
    const found = perf.steps!.find((s) => s.run?.includes(TITLE));
    expect(found, 'paso de aviso con el título exacto').toBeDefined();
    return found!;
  };

  it('[TC-PLATFORM-PIPELINE-009] el paso de aviso corre solo si el job falla y va después del benchmark', () => {
    const step = notice();
    expect(step.if).toMatch(/failure\(\)/);
    const steps = perf.steps!;
    const bench = steps.findIndex((s) => s.run === 'pnpm perf:bench');
    expect(bench).toBeGreaterThanOrEqual(0);
    expect(steps.indexOf(step)).toBeGreaterThan(bench);
  });

  it('[TC-PLATFORM-PIPELINE-009] busca el issue abierto con el título exacto antes de crear y comenta si existe', () => {
    const run = notice().run!;
    const list = run.indexOf('gh issue list');
    const comment = run.indexOf('gh issue comment');
    const create = run.indexOf('gh issue create');
    expect(list).toBeGreaterThanOrEqual(0);
    expect(comment).toBeGreaterThan(list);
    expect(create).toBeGreaterThan(comment);
    expect(run).toMatch(/--state open/);
    expect(run).toMatch(/select\(\.title == /);
    expect(run).toContain('reports/perf/perf-summary.md');
    expect(run).toMatch(/sin reporte/);
    expect(notice().env?.['RUN_URL']).toMatch(/actions\/runs\/\$\{\{ github\.run_id \}\}/);
    expect(notice().env?.['GH_TOKEN']).toBe('${{ github.token }}');
  });

  it('[TC-PLATFORM-PIPELINE-009] el job perf no es un check requerido ni cambia a los demás jobs', () => {
    for (const name of ['regression', 'mutation']) {
      expect(workflow.jobs[name]!.permissions, name).toBeUndefined();
    }
  });
});
