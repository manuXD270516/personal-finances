import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { ENVELOPE_V1_SCHEMA_ID, fullEventName, type EventEnvelope } from '@pf/platform/events';
import { describe, expect, it } from 'vitest';
import { eventSchemaRegistry, resolveEventContractsDir } from './event-contracts.js';

// Validación de los `examples` de TODOS los JSON Schema de `contracts/events` contra su propio schema (Ajv 2020-12
// strict + formatos, el mismo registro que valida el outbox en tiempo de ejecución). Cierra add-transfers 1.3 y
// add-transaction-recording 1.3: un ejemplo publicado que no cumple su contrato rompe el build.
const DIR = resolveEventContractsDir();

function listSchemas(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return listSchemas(path);
    return entry.isFile() && entry.name.endsWith('.schema.json') ? [path] : [];
  });
}

const schemas = listSchemas(DIR)
  .map((file) => ({
    file: relative(DIR, file).replaceAll('\\', '/'),
    schema: JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>,
  }))
  .filter((s) => s.schema['$id'] !== ENVELOPE_V1_SCHEMA_ID)
  .sort((a, b) => a.file.localeCompare(b.file));

describe('contracts/events: examples de cada schema de evento (Ajv strict)', () => {
  it('el registro carga todos los schemas (meta-validación strict) y cada uno tiene title <eventType>.v<n>', () => {
    const registry = eventSchemaRegistry();
    expect(schemas.length).toBeGreaterThanOrEqual(20);
    expect(registry.eventNames()).toEqual(schemas.map((s) => String(s.schema['title'])).sort());
    for (const { file, schema } of schemas) {
      expect(String(schema['title']), file).toMatch(/^[a-z]+\.[A-Z][A-Za-z]+\.v\d+$/);
    }
  });

  it.each(schemas.map((s) => [s.file, s.schema] as const))(
    '%s: tiene examples y todos cumplen su schema',
    (file, schema) => {
      const examples = schema['examples'];
      expect(Array.isArray(examples) && examples.length > 0, `${file} sin examples`).toBe(true);
      for (const [i, example] of (examples as EventEnvelope[]).entries()) {
        expect(fullEventName(example), `${file} examples[${i}]`).toBe(schema['title']);
        expect(() => eventSchemaRegistry().validate(example), `${file} examples[${i}]`).not.toThrow();
      }
    },
  );
});
