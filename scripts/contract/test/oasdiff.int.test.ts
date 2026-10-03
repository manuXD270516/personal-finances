import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { oasdiffBreaking } from '../src/oasdiff.js';

const CONTRACT = new URL('../../../contracts/openapi/finance-api.v1.yaml', import.meta.url);

type Node = Record<string, unknown>;
const at = (node: unknown, ...path: string[]): Node =>
  path.reduce<Node>((n, key) => n[key] as Node, node as Node);

describe('detección de cambios incompatibles del contrato v1 (oasdiff)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pf-tc002-'));
  const base = readFileSync(CONTRACT, 'utf8');
  writeFileSync(join(dir, 'base.yaml'), base);
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const check = (name: string, mutate: (doc: Node) => void) => {
    const doc = parse(base) as Node;
    mutate(doc);
    writeFileSync(join(dir, `${name}.yaml`), stringify(doc));
    return oasdiffBreaking(join(dir, 'base.yaml'), join(dir, `${name}.yaml`));
  };

  it('[TC-PLATFORM-API-002] eliminar Workspace.baseCurrency de la respuesta hace fallar el chequeo nombrando el cambio', () => {
    const result = check('remove-field', (doc) => {
      const ws = at(doc, 'components', 'schemas', 'Workspace');
      delete at(ws, 'properties')['baseCurrency'];
      ws['required'] = (ws['required'] as string[]).filter((r) => r !== 'baseCurrency');
    });
    expect(result.breaking, result.output).toBe(true);
    expect(result.output).toContain('baseCurrency');
  });

  it('[TC-PLATFORM-API-002] cambiar el 201 de createWorkspace a 200 hace fallar el chequeo', () => {
    const result = check('status-change', (doc) => {
      const responses = at(doc, 'paths', '/workspaces', 'post', 'responses');
      responses['200'] = responses['201'];
      delete responses['201'];
    });
    expect(result.breaking, result.output).toBe(true);
    expect(result.output).toMatch(/201/);
  });

  it('[TC-PLATFORM-API-002] agregar un campo opcional a Workspace pasa el chequeo', () => {
    const result = check('optional-field', (doc) => {
      at(doc, 'components', 'schemas', 'Workspace', 'properties')['nickname'] = { type: 'string' };
    });
    expect(result.breaking, result.output).toBe(false);
  });
});
