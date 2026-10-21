import { describe, expect, it } from 'vitest';
import { loadWorkflow, type Job, type Workflow } from './helpers.js';

// fix-nightly-pipeline, decisión 7 (D283): la cobertura del shared-kernel (≥ 95 % de líneas, ≥ 90 % de ramas) se exige
// dentro del job `unit` del gate de PR, que ya es un check requerido. No cambia la lista de checks ni el id, el nombre
// o el tiempo máximo del job: solo lo que ejecuta.
const COVERAGE = 'pnpm --filter @pf/shared-kernel run test:coverage';
const UNIT_TIMEOUT = 15;

/** Mensajes de la regla (vacío si cumple); siempre nombran el job `unit` y el paso. */
function unitCoverageViolations(workflow: Workflow): string[] {
  const unit: Job | undefined = workflow.jobs['unit'];
  if (!unit) return ['job unit: no existe (el check requerido unit no puede desaparecer ni renombrarse)'];
  const out: string[] = [];
  if (unit.name !== undefined)
    out.push(`job unit: declara name "${unit.name}" (el check requerido se llama unit)`);
  if (unit['timeout-minutes'] !== UNIT_TIMEOUT)
    out.push(
      `job unit: timeout-minutes = ${String(unit['timeout-minutes'])} (debe seguir en ${UNIT_TIMEOUT})`,
    );
  if (unit['continue-on-error'] !== undefined) out.push('job unit: declara continue-on-error');
  const steps = unit.steps ?? [];
  const coverage = steps.findIndex((s) => s.run === COVERAGE);
  if (coverage < 0) return [...out, `job unit, paso "${COVERAGE}": falta`];
  const step = steps[coverage]!;
  if (step['continue-on-error'] !== undefined)
    out.push(
      `job unit, paso "${COVERAGE}": no bloqueante (continue-on-error: ${String(step['continue-on-error'])})`,
    );
  if (step.if !== undefined) out.push(`job unit, paso "${COVERAGE}": condicionado (if: ${step.if})`);
  const test = steps.findIndex((s) => s.run === 'pnpm test');
  if (test < 0) out.push('job unit, paso "pnpm test": falta');
  else if (coverage < test) out.push(`job unit, paso "${COVERAGE}": va antes de pnpm test`);
  return out;
}

const real = (): Workflow => loadWorkflow('.github/workflows/pr.yml');
const clone = (): Workflow => structuredClone(real());

describe('pr.yml: cobertura del shared-kernel en el job unit (TC-PLATFORM-PIPELINE-020 y 021)', () => {
  it('[TC-PLATFORM-PIPELINE-021] el pr.yml real cumple la regla', () => {
    expect(unitCoverageViolations(real())).toEqual([]);
  });

  it('[TC-PLATFORM-PIPELINE-021] el job unit conserva su id, su nombre de check y timeout-minutes 15, y la cobertura es un paso suyo', () => {
    const wf = real();
    expect(wf.jobs['unit']).toBeDefined();
    expect(wf.jobs['unit']!.name).toBeUndefined();
    expect(wf.jobs['unit']!['timeout-minutes']).toBe(15);
    expect(Object.keys(wf.jobs)).not.toContain('coverage');
    expect(Object.keys(wf.jobs).filter((j) => /cover/u.test(j))).toEqual([]);
  });

  it('[TC-PLATFORM-PIPELINE-020] la cobertura corre después de pnpm test, sin if ni continue-on-error', () => {
    const steps = real().jobs['unit']!.steps!;
    const test = steps.findIndex((s) => s.run === 'pnpm test');
    const cov = steps.findIndex((s) => s.run === COVERAGE);
    expect(test).toBeGreaterThanOrEqual(0);
    expect(cov).toBeGreaterThan(test);
    expect(steps[cov]!.if).toBeUndefined();
    expect(steps[cov]!['continue-on-error']).toBeUndefined();
    expect(real().jobs['unit']!['continue-on-error']).toBeUndefined();
  });

  it('[TC-PLATFORM-PIPELINE-021] un fixture sin el paso de cobertura falla indicando el job unit y el paso faltante', () => {
    const wf = clone();
    wf.jobs['unit']!.steps = wf.jobs['unit']!.steps!.filter((s) => s.run !== COVERAGE);
    expect(unitCoverageViolations(wf)).toEqual([`job unit, paso "${COVERAGE}": falta`]);
  });

  it('[TC-PLATFORM-PIPELINE-021] un fixture con el paso en continue-on-error: true falla indicando el job unit y el paso no bloqueante', () => {
    const wf = clone();
    wf.jobs['unit']!.steps!.find((s) => s.run === COVERAGE)!['continue-on-error'] = true;
    expect(unitCoverageViolations(wf)).toEqual([
      `job unit, paso "${COVERAGE}": no bloqueante (continue-on-error: true)`,
    ]);
  });

  it('[TC-PLATFORM-PIPELINE-021] un fixture con if: false falla indicando el job unit y la condición', () => {
    const wf = clone();
    wf.jobs['unit']!.steps!.find((s) => s.run === COVERAGE)!.if = 'false';
    expect(unitCoverageViolations(wf)).toEqual([`job unit, paso "${COVERAGE}": condicionado (if: false)`]);
  });

  it('[TC-PLATFORM-PIPELINE-021] un fixture con continue-on-error en el job, otro timeout, un nombre o el paso antes de pnpm test falla', () => {
    const a = clone();
    a.jobs['unit']!['continue-on-error'] = true;
    expect(unitCoverageViolations(a)).toEqual(['job unit: declara continue-on-error']);
    const b = clone();
    b.jobs['unit']!['timeout-minutes'] = 20;
    expect(unitCoverageViolations(b)).toEqual(['job unit: timeout-minutes = 20 (debe seguir en 15)']);
    const c = clone();
    c.jobs['unit']!.name = 'tests';
    expect(unitCoverageViolations(c)).toHaveLength(1);
    const d = clone();
    d.jobs['unit']!.steps!.reverse();
    expect(unitCoverageViolations(d)).toEqual([`job unit, paso "${COVERAGE}": va antes de pnpm test`]);
    const e = clone();
    delete e.jobs['unit'];
    expect(unitCoverageViolations(e)).toHaveLength(1);
  });
});
