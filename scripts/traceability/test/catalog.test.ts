import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadCatalog } from '../src/catalog.js';
import { FIXTURES, errorsOf, makeRepo } from './helpers.js';

describe('catálogo de test cases (R6, R8)', () => {
  it('acepta el catálogo consistente del fixture', () => {
    const catalog = loadCatalog(makeRepo());
    expect(catalog.findings).toEqual([]);
    expect(catalog.cases.map((c) => c.id).sort()).toEqual([
      'TC-DEMO-CORE-001',
      'TC-DEMO-CORE-002',
      'TC-DEMO-CORE-003',
    ]);
    const tc = catalog.cases.find((c) => c.id === 'TC-DEMO-CORE-001');
    expect(tc).toMatchObject({
      file: 'tests/cases/demo/TC-DEMO-CORE-001.md',
      spec: 'demo/capability',
      requirement: 'Requirement cubierto',
      scenario: 'Escenario uno',
      automationStatus: 'automated',
      status: 'ready',
      automatedTests: ['packages/demo/src/core.test.ts'],
    });
  });

  it('[TC-PLATFORM-TRACE-005] falla indicando archivo y campo cuando un TC no declara el requirement', () => {
    const catalog = loadCatalog(makeRepo('missing-requirement'));
    const errors = errorsOf(catalog.findings, 'R6');
    expect(errors).toHaveLength(1);
    expect(errors[0]?.file).toBe('tests/cases/demo/TC-DEMO-CORE-002.md');
    expect(errors[0]?.message).toContain("falta el campo obligatorio 'requirement'");
    // El TC inválido no participa en el enlace (no se puede saber qué requirement cubre).
    expect(catalog.cases.map((c) => c.id)).not.toContain('TC-DEMO-CORE-002');
  });

  it('reporta valores fuera del schema, campos desconocidos y la falta de FR/NFR', () => {
    const catalog = loadCatalog(makeRepo('invalid-values'));
    const messages = errorsOf(catalog.findings, 'R6').map((f) => f.message);
    expect(messages).toEqual(
      expect.arrayContaining([
        expect.stringContaining("'priority'"),
        expect.stringContaining("'automation_status'"),
        expect.stringContaining("campo no permitido 'campo_extra'"),
        expect.stringContaining('al menos un FR o un NFR'),
      ]),
    );
  });

  it('exige id igual al nombre de archivo, directorio igual al contexto e ids únicos', () => {
    const catalog = loadCatalog(makeRepo('id-mismatch'));
    const r6 = errorsOf(catalog.findings, 'R6');
    expect(r6.map((f) => [f.file, f.message])).toEqual(
      expect.arrayContaining([
        [
          'tests/cases/demo/TC-DEMO-CORE-005.md',
          expect.stringContaining('no coincide con el nombre del archivo'),
        ],
        ['tests/cases/otro/TC-DEMO-CORE-001.md', expect.stringContaining('debe estar en tests/cases/demo/')],
      ]),
    );
    const r8 = errorsOf(catalog.findings, 'R8');
    expect(r8).toHaveLength(1);
    expect(r8[0]?.message).toContain('TC-DEMO-CORE-001');
    expect(r8[0]?.message).toContain('tests/cases/demo/TC-DEMO-CORE-001.md');
  });

  it('exige deprecated_by_change y deprecation_reason en los TC deprecados', async () => {
    const { parseCaseFile } = await import('../src/catalog.js');
    const result = parseCaseFile(
      'tests/cases/demo/TC-DEMO-CORE-009.md',
      [
        '---',
        'id: TC-DEMO-CORE-009',
        'title: Un caso deprecado sin motivo',
        'spec: demo/capability',
        'requirement: Requirement cubierto',
        'requirement_status: confirmed',
        'fr: [FR-DEMO-001]',
        'invariants: []',
        'priority: low',
        'type: unit',
        'level: unit',
        'automation_status: not_automated',
        'status: deprecated',
        'preconditions: []',
        'input: {}',
        'steps: [a]',
        'expected_result: [b]',
        '---',
      ].join('\n'),
    );
    expect(result.findings.map((f) => f.message)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("'deprecated_by_change'"),
        expect.stringContaining("'deprecation_reason'"),
      ]),
    );
  });

  it('reporta como faltante un campo obligatorio de tipo unión (input)', async () => {
    const { parseCaseFile } = await import('../src/catalog.js');
    const content = readFileSync(join(FIXTURES, 'base/tests/cases/demo/TC-DEMO-CORE-002.md'), 'utf8').replace(
      /^input:\r?\n.*\r?\n/m,
      '',
    );
    const result = parseCaseFile('tests/cases/demo/TC-DEMO-CORE-002.md', content);
    expect(result.findings.map((f) => f.message)).toEqual(["falta el campo obligatorio 'input'"]);
  });

  it('reporta un front matter ausente o YAML inválido', async () => {
    const { parseCaseFile } = await import('../src/catalog.js');
    expect(
      parseCaseFile('tests/cases/demo/TC-DEMO-CORE-010.md', '# sin front matter').findings[0]?.message,
    ).toContain('front matter');
    expect(
      parseCaseFile('tests/cases/demo/TC-DEMO-CORE-011.md', '---\nid: [abierto\n---\n').findings[0]?.message,
    ).toContain('YAML inválido');
  });
});
