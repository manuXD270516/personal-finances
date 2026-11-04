/**
 * Esquema del diseño de extracto PDF (`imports.pdf-layout.v1`; openspec add-pdf-statement-parser decisión 6). Es la
 * copia ejecutable de `contracts/imports/pdf-layout.v1.schema.json` (un test las compara): el registro valida los
 * diseños al arrancar sin leer el disco de contratos. Sin campos de expresión regular.
 */
export const PDF_LAYOUT_SCHEMA_ID = 'https://contracts.pfos.local/imports/pdf-layout.v1.schema.json' as const;

export const PDF_LAYOUT_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://contracts.pfos.local/imports/pdf-layout.v1.schema.json',
  title: 'imports.pdf-layout.v1',
  description:
    'Diseño declarativo de un extracto PDF con texto de una institución (openspec add-pdf-statement-parser decisión 6). Es DATO: sin campos de expresión regular ni código. Los literales se comparan sin mayúsculas ni acentos y NUNCA incluyen el nombre del banco ni datos del titular. Una versión publicada es inmutable (`pdf-layouts.lock.json`); un formato nuevo del banco es una versión nueva.',
  type: 'object',
  additionalProperties: false,
  required: [
    'schema',
    'id',
    'version',
    'currencyLabels',
    'detect',
    'header',
    'table',
    'page',
    'number',
    'date',
    'time',
    'reference',
    'volatileFragments',
  ],
  properties: {
    schema: {
      const: 'imports.pdf-layout.v1',
    },
    id: {
      type: 'string',
      pattern: '^[a-z][a-z0-9.]{2,59}$',
    },
    version: {
      type: 'integer',
      minimum: 1,
    },
    institutionCode: {
      type: 'string',
      minLength: 1,
      maxLength: 60,
    },
    currencyLabels: {
      type: 'array',
      minItems: 1,
      maxItems: 10,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['label', 'currency'],
        properties: {
          label: {
            $ref: '#/$defs/Literal',
          },
          currency: {
            type: 'string',
            pattern: '^[A-Z0-9][A-Z0-9_.-]{1,15}$',
          },
        },
      },
    },
    detect: {
      type: 'object',
      additionalProperties: false,
      required: ['literals'],
      properties: {
        literals: {
          $ref: '#/$defs/LiteralsNonEmpty',
        },
      },
    },
    header: {
      type: 'object',
      additionalProperties: false,
      properties: {
        account: {
          $ref: '#/$defs/LabelRef',
        },
        period: {
          oneOf: [
            {
              type: 'object',
              additionalProperties: false,
              required: ['kind', 'label'],
              properties: {
                kind: {
                  const: 'MONTH_YEAR',
                },
                label: {
                  $ref: '#/$defs/Literal',
                },
              },
            },
            {
              type: 'object',
              additionalProperties: false,
              required: ['kind'],
              properties: {
                kind: {
                  enum: ['DATE_RANGE', 'LONG_DATE_RANGE'],
                },
              },
            },
          ],
        },
        openingBalance: {
          $ref: '#/$defs/BalanceSource',
        },
        closingBalance: {
          $ref: '#/$defs/BalanceSource',
        },
        totalDebits: {
          $ref: '#/$defs/LabelRef',
        },
        totalCredits: {
          $ref: '#/$defs/LabelRef',
        },
        totalPages: {
          oneOf: [
            {
              type: 'object',
              additionalProperties: false,
              required: ['kind', 'label'],
              properties: {
                kind: {
                  const: 'LABEL',
                },
                label: {
                  $ref: '#/$defs/Literal',
                },
              },
            },
            {
              type: 'object',
              additionalProperties: false,
              required: ['kind'],
              properties: {
                kind: {
                  const: 'PAGE_N_OF_M',
                },
              },
            },
          ],
        },
      },
    },
    table: {
      type: 'object',
      additionalProperties: false,
      required: ['columns', 'rowAnchor'],
      properties: {
        columns: {
          type: 'array',
          minItems: 2,
          maxItems: 30,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['labels', 'role', 'align'],
            properties: {
              labels: {
                $ref: '#/$defs/LiteralsNonEmpty',
              },
              role: {
                enum: [
                  'DATE',
                  'TIME',
                  'DESCRIPTION',
                  'AMOUNT',
                  'DEBIT',
                  'CREDIT',
                  'BALANCE',
                  'REFERENCE',
                  'IGNORE',
                ],
              },
              align: {
                enum: ['LEFT', 'RIGHT'],
              },
            },
          },
        },
        rowAnchor: {
          enum: ['DATE', 'AMOUNT'],
        },
        rightSlackEm: {
          type: 'number',
          minimum: 0,
          maximum: 20,
        },
        sections: {
          type: 'array',
          maxItems: 10,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['id', 'startLabel', 'totalLabel', 'sign'],
            properties: {
              id: {
                type: 'string',
                pattern: '^[A-Z][A-Z0-9_]{1,29}$',
              },
              startLabel: {
                $ref: '#/$defs/Literal',
              },
              totalLabel: {
                $ref: '#/$defs/Literal',
              },
              sign: {
                enum: ['CREDIT', 'DEBIT'],
              },
            },
          },
        },
        skipRows: {
          type: 'array',
          maxItems: 10,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['description'],
            properties: {
              description: {
                $ref: '#/$defs/Literal',
              },
            },
          },
        },
        endLabels: {
          $ref: '#/$defs/Literals',
        },
        counterpartyStarts: {
          $ref: '#/$defs/Literals',
        },
        dropLinePrefixes: {
          $ref: '#/$defs/Literals',
        },
      },
    },
    page: {
      type: 'object',
      additionalProperties: false,
      required: ['repeatedLiterals', 'footerLiterals', 'blankPageLiterals', 'discardLiterals'],
      properties: {
        repeatedLiterals: {
          $ref: '#/$defs/Literals',
        },
        footerLiterals: {
          $ref: '#/$defs/Literals',
        },
        blankPageLiterals: {
          $ref: '#/$defs/Literals',
        },
        discardLiterals: {
          $ref: '#/$defs/Literals',
        },
      },
    },
    number: {
      type: 'object',
      additionalProperties: false,
      required: ['decimal', 'thousands'],
      properties: {
        decimal: {
          enum: ['.', ','],
        },
        thousands: {
          enum: ['.', ',', null],
        },
      },
    },
    date: {
      enum: ['YYYYMMDD', 'DD/MM/YYYY', 'DD-MM-YYYY'],
    },
    time: {
      enum: ['HH:mm:ss', 'HH:mm'],
    },
    reference: {
      type: 'object',
      additionalProperties: false,
      required: ['unique'],
      properties: {
        unique: {
          type: 'boolean',
        },
      },
    },
    volatileFragments: {
      $ref: '#/$defs/Literals',
    },
  },
  $defs: {
    Literal: {
      type: 'string',
      minLength: 1,
      maxLength: 120,
    },
    Literals: {
      type: 'array',
      maxItems: 50,
      items: {
        $ref: '#/$defs/Literal',
      },
    },
    LiteralsNonEmpty: {
      type: 'array',
      minItems: 1,
      maxItems: 50,
      items: {
        $ref: '#/$defs/Literal',
      },
    },
    LabelRef: {
      type: 'object',
      additionalProperties: false,
      required: ['label'],
      properties: {
        label: {
          $ref: '#/$defs/Literal',
        },
      },
    },
    BalanceSource: {
      oneOf: [
        {
          type: 'object',
          additionalProperties: false,
          required: ['kind', 'label'],
          properties: {
            kind: {
              const: 'LABEL',
            },
            label: {
              $ref: '#/$defs/Literal',
            },
            occurrence: {
              enum: ['FIRST', 'LAST'],
            },
          },
        },
        {
          type: 'object',
          additionalProperties: false,
          required: ['kind', 'description'],
          properties: {
            kind: {
              const: 'SKIP_ROW',
            },
            description: {
              $ref: '#/$defs/Literal',
            },
          },
        },
      ],
    },
  },
} as const;
