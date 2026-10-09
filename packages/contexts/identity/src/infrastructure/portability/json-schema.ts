import type { PortabilitySection } from '@pf/shared-kernel';
import { exportedColumns, type ColumnInfo, type ColumnKind } from './section-sql.js';

/**
 * Esquemas JSON (2020-12) de los registros del export, versionados con el formato (`contracts/export/v1/<sección>.schema.json`,
 * NFR-PORT-009). Se GENERAN desde el catálogo de la base y las declaraciones de los contextos, y un test de integración
 * compara el resultado con los archivos publicados: si una migración agrega una columna, el test falla hasta publicar el
 * esquema nuevo. Los montos son cadenas decimales exactas; los instantes, ISO-8601 UTC con microsegundos.
 */
export const EXPORT_SCHEMA_BASE = 'https://contracts.pfos.local/export/v1/';
export const exportSchemaId = (name: string): string => `${EXPORT_SCHEMA_BASE}${name}.schema.json`;

type Json = Record<string, unknown>;

const DECIMAL = '^-?[0-9]+(\\.[0-9]+)?$';
const INSTANT = '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{6}Z$';

function base(kind: ColumnKind): Json {
  switch (kind) {
    case 'uuid':
      return { type: 'string', format: 'uuid' };
    case 'text':
      return { type: 'string' };
    case 'int':
      return { type: 'integer' };
    case 'bigint':
      return { type: 'string', pattern: '^-?[0-9]+$' };
    case 'bool':
      return { type: 'boolean' };
    case 'numeric':
      return { type: 'string', pattern: DECIMAL };
    case 'date':
      // `-infinity` / `infinity` son fechas válidas de PostgreSQL (p. ej. el primer bloqueo de periodo del ledger).
      return { type: 'string', pattern: '^(-?infinity|[0-9]{4}-[0-9]{2}-[0-9]{2})$' };
    case 'timestamptz':
      return { type: 'string', pattern: INSTANT };
    case 'time':
      return { type: 'string', pattern: '^[0-9]{2}:[0-9]{2}(:[0-9]{2}(\\.[0-9]+)?)?$' };
    case 'bytea':
      return { type: 'string', contentEncoding: 'base64' };
    case 'uuid[]':
      return { type: 'array', items: base('uuid') };
    case 'text[]':
      return { type: 'array', items: base('text') };
    case 'numeric[]':
      return { type: 'array', items: base('numeric') };
    case 'jsonb':
      return {};
  }
}

function property(col: ColumnInfo): Json {
  const schema = base(col.kind);
  if (col.kind === 'jsonb')
    return col.notNull ? { description: 'JSON libre (no nulo).', not: { type: 'null' } } : {};
  if (col.notNull) return schema;
  // Nulable: el tipo admite también `null`.
  return {
    ...schema,
    type: [schema['type'] as string, 'null'],
    ...(schema['items'] ? { items: schema['items'] } : {}),
  };
}

/** Esquema del registro de una sección (todas las columnas exportadas son obligatorias; `null` explícito). */
export function buildSectionSchema(section: PortabilitySection, columns: readonly ColumnInfo[]): Json {
  const cols = exportedColumns(section, columns);
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: exportSchemaId(section.name),
    title: `pfos-export v1 — ${section.name}`,
    description: `Registro de la sección «${section.name}» (tabla ${section.table}, contexto ${section.context}). Montos como texto decimal exacto; instantes ISO-8601 UTC.`,
    type: 'object',
    additionalProperties: false,
    required: cols.map((c) => c.name),
    properties: Object.fromEntries(cols.map((c) => [c.name, property(c)])),
    'x-pfos-table': section.table,
    'x-pfos-context': section.context,
  };
}

/** Texto canónico del archivo publicado (indentado, con salto final) para comparar byte a byte. */
export const renderSchema = (schema: Json): string => `${JSON.stringify(schema, null, 2)}\n`;
