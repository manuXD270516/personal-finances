import { describe, expect, it } from 'vitest';
import { runCheck } from '../src/check.js';
import { scanTests } from '../src/tests-scan.js';
import { errorsOf, makeRepo } from './helpers.js';

const check = (root: string) => runCheck({ root, openspec: 'markdown' });

describe('trazabilidad de los tests de Python (services/**/test_*.py)', () => {
  it('[TC-PLATFORM-MLSERVICE-008] enlaza un TC citado en el docstring de un test de Python sin errores', async () => {
    const root = makeRepo('python-test');
    expect(scanTests(root).find((t) => t.file === 'services/demo/tests/test_demo.py')?.ids).toEqual([
      'TC-DEMO-CORE-009',
    ]);
    const result = await check(root);
    expect(errorsOf(result.findings)).toEqual([]);
    expect(result.findings.filter((f) => f.file?.includes('TC-DEMO-CORE-009'))).toEqual([]);
  });

  it('[TC-PLATFORM-MLSERVICE-009] falla con R4 cuando un test de Python cita un TC inexistente', async () => {
    const result = await check(makeRepo('python-unknown-id'));
    const r4 = errorsOf(result.findings, 'R4');
    expect(r4).toHaveLength(1);
    expect(r4[0]?.file).toBe('services/demo/tests/test_unknown.py');
    expect(r4[0]?.message).toContain('TC-DEMO-CORE-999');
  });

  it('[TC-PLATFORM-MLSERVICE-008] ignora entornos virtuales y cachés de Python', () => {
    const root = makeRepo('python-test');
    expect(scanTests(root).every((t) => !t.file.includes('.venv') && !t.file.includes('__pycache__'))).toBe(
      true,
    );
  });
});
