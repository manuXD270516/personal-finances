import { Ajv2020, type ValidateFunction } from 'ajv/dist/2020.js';
import {
  canonicalSignedAmount,
  decodeText,
  emptyRecord,
  error,
  failed,
  joinDescription,
  validIsoDate,
  warning,
  withCurrencyMismatch,
} from '../../domain/reader-support.js';
import { IMPORT_FILE_SCHEMA } from '../../domain/import-file-schema.js';
import { parseTime } from '../../domain/statement-normalizer.js';
import type {
  ParseOptions,
  ParsedStatement,
  SniffResult,
  StatementBalance,
  StatementParser,
  StatementRecord,
} from '../../domain/statement.js';

/**
 * Lector del JSON propio versionado (`pfos.import-file` v1). Se valida contra el JSON Schema ANTES de normalizar; el
 * primer error deja el archivo en `PARSE_FAILED` con su puntero JSON (sin texto del archivo, NFR-SEC-015).
 */
let validator: ValidateFunction | null = null;

function schemaValidator(): ValidateFunction {
  if (validator === null) {
    validator = new Ajv2020({ strict: true, allErrors: false }).compile(IMPORT_FILE_SCHEMA);
  }
  return validator;
}

interface FileShape {
  currency: string;
  statement?: { openingBalance?: string; closingBalance?: string; from?: string; to?: string };
  movements: {
    date: string;
    time?: string;
    amount: string;
    description?: string;
    externalId?: string;
    counterparty?: string;
  }[];
}

const isoDate = (s: string | undefined): string | null => {
  if (s === undefined) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(s);
  return m ? validIsoDate(Number(m[1]), Number(m[2]), Number(m[3])) : null;
};

export class JsonStatementReader implements StatementParser {
  readonly format = 'JSON' as const;

  sniff(head: Uint8Array): SniffResult | null {
    const text = decodeText(head.subarray(0, 4096));
    if (text === null) return null;
    const trimmed = text.trimStart();
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null;
    return { format: 'JSON', confidence: trimmed.includes('"pfos.import-file"') ? 'HIGH' : 'LOW' };
  }

  parse(bytes: Uint8Array, options: ParseOptions): ParsedStatement {
    const text = decodeText(bytes);
    if (text === null) return failed('JSON', 'IMPORT_PARSE_FAILED', '');
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      return failed('JSON', 'IMPORT_PARSE_FAILED', '');
    }
    const validate = schemaValidator();
    if (!validate(data)) {
      const first = validate.errors?.[0];
      return failed('JSON', 'IMPORT_PARSE_FAILED', first?.instancePath ?? '');
    }
    const file = data as unknown as FileShape;
    if (file.movements.length > options.maxRows) return failed('JSON', 'IMPORT_TOO_MANY_ROWS', '/movements');

    const { accountCurrency: code, currencyScale: scale } = options;
    const records: StatementRecord[] = file.movements.map((mv, idx) => {
      const issues = [];
      const date = isoDate(mv.date);
      if (!date) issues.push(error('IMPORT_INVALID_DATE'));
      const amount = canonicalSignedAmount(mv.amount, code, scale);
      if (amount === null) issues.push(error('IMPORT_INVALID_AMOUNT'));
      const description = joinDescription(mv.description);
      if (description.truncated) issues.push(warning('IMPORT_DESCRIPTION_TRUNCATED'));
      const time =
        mv.time === undefined ? null : parseTime(mv.time, mv.time.length === 5 ? 'HH:mm' : 'HH:mm:ss');
      if (mv.time !== undefined && time === null) issues.push(warning('IMPORT_INVALID_DATE'));
      return {
        ...emptyRecord(idx + 1),
        bookingDate: date,
        time,
        amount,
        currency: file.currency,
        description: description.text,
        externalId: mv.externalId ?? null,
        counterparty: mv.counterparty?.trim() || null,
        issues,
      };
    });

    const st = file.statement;
    const statement: StatementBalance | null = st
      ? {
          openingBalance:
            st.openingBalance === undefined ? null : canonicalSignedAmount(st.openingBalance, code, scale),
          closingBalance:
            st.closingBalance === undefined ? null : canonicalSignedAmount(st.closingBalance, code, scale),
          closingDate: isoDate(st.to),
          periodFrom: isoDate(st.from),
          periodTo: isoDate(st.to),
        }
      : null;
    return {
      format: 'JSON',
      records: file.currency === code ? records : withCurrencyMismatch(records),
      statement,
      declaredCurrency: file.currency,
      failure: null,
      needsMapping: [],
    };
  }
}
