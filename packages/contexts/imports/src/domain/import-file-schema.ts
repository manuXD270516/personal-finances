/**
 * Esquema del archivo JSON propio de importación (`pfos.import-file` v1; openspec add-import-pipeline decisión 5).
 * Es la copia ejecutable de `contracts/imports/import-file.v1.schema.json` (un test las compara): el lector no lee el
 * disco en ejecución. Montos y saldos SIEMPRE como texto decimal (INV-001); un número JSON se rechaza.
 */
export const IMPORT_FILE_SCHEMA_ID =
  'https://contracts.pfos.local/imports/import-file.v1.schema.json' as const;

const DECIMAL = '^[+-]?\\d+(\\.\\d+)?$';
const DATE = '^\\d{4}-\\d{2}-\\d{2}$';

export const IMPORT_FILE_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: IMPORT_FILE_SCHEMA_ID,
  title: 'pfos.import-file v1',
  description:
    'Archivo JSON propio de importación de movimientos de una cuenta. Los montos y saldos son texto decimal exacto con signo (la salida es negativa); un número JSON se rechaza. Fechas de negocio YYYY-MM-DD.',
  type: 'object',
  additionalProperties: false,
  required: ['schema', 'version', 'currency', 'movements'],
  properties: {
    schema: { const: 'pfos.import-file' },
    version: { const: 1 },
    currency: { type: 'string', pattern: '^[A-Z0-9][A-Z0-9_.-]{1,15}$' },
    statement: {
      type: 'object',
      additionalProperties: false,
      properties: {
        openingBalance: { type: 'string', pattern: DECIMAL },
        closingBalance: { type: 'string', pattern: DECIMAL },
        from: { type: 'string', pattern: DATE },
        to: { type: 'string', pattern: DATE },
      },
    },
    movements: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['date', 'amount'],
        properties: {
          date: { type: 'string', pattern: DATE },
          time: { type: 'string', pattern: '^\\d{2}:\\d{2}(:\\d{2})?$' },
          amount: { type: 'string', pattern: DECIMAL },
          description: { type: 'string', maxLength: 2000 },
          externalId: { type: 'string', minLength: 1, maxLength: 128 },
          counterparty: { type: 'string', maxLength: 200 },
        },
      },
    },
  },
  examples: [
    {
      schema: 'pfos.import-file',
      version: 1,
      currency: 'BOB',
      statement: { closingBalance: '754.70', from: '2026-03-01', to: '2026-03-31' },
      movements: [
        {
          date: '2026-03-01',
          time: '10:15:00',
          amount: '-245.30',
          description: 'COMPRA SUPERMERCADO',
          externalId: '2026030100017',
        },
      ],
    },
  ],
} as const;
