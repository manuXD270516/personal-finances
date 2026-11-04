import { DomainError } from '@pf/shared-kernel';
import { DATE_FORMATS, DECIMAL_SEPARATORS, MAX_SKIP_ROWS, SIGN_CONVENTIONS } from './csv-mapping.js';
import type { CsvMapping, DateFormat, DecimalSeparator, SignConvention } from './csv-mapping.js';
import { STATEMENT_FORMATS, type StatementFormat } from './statement.js';

/**
 * Opciones de lectura de un perfil (`imports.profile.v1`, superconjunto de `imports.mapping.v1`; openspec
 * add-import-pipeline decisiones 6 y 7). Una columna se referencia por posición y, opcionalmente, por el nombre que
 * tiene en el encabezado (`header`): el `ProfileMatcher` compara por nombre sin mayúsculas ni acentos y resuelve la
 * posición real, de modo que un banco que reordena columnas no rompe el perfil.
 */
export const PROFILE_OPTIONS_VERSION = 'imports.profile.v1' as const;
export const MAX_FOOTER_ROWS = 50;
export const MAX_CLEANUP_PREFIXES = 20;
export const MAX_DESCRIPTION_COLUMNS = 5;

export interface ColumnRef {
  readonly index: number;
  /** Nombre en el encabezado del archivo (para resolver la posición por nombre). */
  readonly header?: string | undefined;
}

export type ProfileAmount =
  | { readonly mode: 'SIGNED'; readonly column: ColumnRef; readonly signConvention: SignConvention }
  | { readonly mode: 'DEBIT_CREDIT'; readonly debit: ColumnRef; readonly credit: ColumnRef }
  | {
      readonly mode: 'INDICATOR';
      readonly column: ColumnRef;
      readonly indicator: ColumnRef;
      readonly debitValues: readonly string[];
      readonly creditValues: readonly string[];
    };

export type TimeFormat = 'HH:mm' | 'HH:mm:ss';
export const TIME_FORMATS: readonly TimeFormat[] = ['HH:mm', 'HH:mm:ss'];

/** Alias de moneda por omisión (claves en mayúsculas); el perfil los amplía. */
export const DEFAULT_CURRENCY_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  BS: 'BOB',
  'BS.': 'BOB',
  BOB: 'BOB',
  $US: 'USD',
  US$: 'USD',
  USD: 'USD',
  USDT: 'USDT',
});

export interface ProfileColumns {
  readonly date: ColumnRef;
  /** Una o varias columnas, unidas con un espacio. */
  readonly description: readonly ColumnRef[];
  readonly amount: ProfileAmount;
  readonly currency?:
    { readonly column: ColumnRef; readonly aliases: Readonly<Record<string, string>> } | undefined;
  readonly reference?: { readonly column: ColumnRef; readonly unique: boolean } | undefined;
  readonly runningBalance?: ColumnRef | undefined;
  readonly time?: { readonly column: ColumnRef; readonly format: TimeFormat } | undefined;
  readonly valueDate?: ColumnRef | undefined;
}

/** Mapeo tabular (CSV/XLSX) completo y validado. */
export interface ProfileMapping {
  readonly hasHeader: boolean;
  readonly skipRows: number;
  readonly skipFooterRows: number;
  readonly columns: ProfileColumns;
  readonly dateFormat: DateFormat;
  /** `null` ⇒ se infiere si no es ambiguo; ambiguo ⇒ `IMPORT_AMBIGUOUS_NUMBER`. */
  readonly decimalSeparator: DecimalSeparator | null;
  /** Prefijos literales (no expresiones regulares) que se quitan del inicio de la descripción. */
  readonly descriptionCleanup: readonly string[];
  /** Hoja de un XLSX. */
  readonly sheet?: string | undefined;
}

/** Opciones de un perfil: tabular para CSV/XLSX; para OFX, JSON y QIF solo lo que aportan (limpieza, orden de fecha). */
export interface ProfileOptions {
  readonly version: typeof PROFILE_OPTIONS_VERSION;
  readonly mapping: ProfileMapping | null;
  readonly descriptionCleanup: readonly string[];
  /** QIF: orden de día y mes. */
  readonly dateOrder: 'DMY' | 'MDY' | null;
  /** PDF: diseño de extracto que fija el perfil (id y versión publicados); sin edición de columnas. */
  readonly pdfLayout: { readonly id: string; readonly version: number } | null;
}

type Json = Readonly<Record<string, unknown>>;
const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const invalid = (pointer: string, message: string) =>
  new DomainError('IMPORT_MAPPING_INVALID', message).at(pointer);

function column(value: unknown, pointer: string, columnCount: number | null): ColumnRef {
  if (!isObject(value)) throw invalid(pointer, 'the column must be { index, header? }');
  const index = value['index'];
  if (typeof index !== 'number' || !Number.isInteger(index) || index < 0) {
    throw invalid(`${pointer}/index`, 'the column index must be a non-negative integer');
  }
  if (columnCount !== null && index >= columnCount) {
    throw invalid(`${pointer}/index`, `column ${index} does not exist (the file has ${columnCount} columns)`);
  }
  const header = value['header'];
  if (header !== undefined && (typeof header !== 'string' || header.trim() === '' || header.length > 200)) {
    throw invalid(`${pointer}/header`, 'header must be a non-empty string of at most 200 characters');
  }
  return header === undefined ? { index } : { index, header: header as string };
}

function required(source: Json, key: string, pointer: string): unknown {
  const v = source[key];
  if (v === undefined || v === null) throw invalid(`${pointer}/${key}`, `${key} is required`);
  return v;
}

function strings(value: unknown, pointer: string, max: number): readonly string[] {
  if (!Array.isArray(value) || value.length > max || value.some((v) => typeof v !== 'string' || v === '')) {
    throw invalid(pointer, `must be an array of up to ${max} non-empty strings`);
  }
  return value as string[];
}

/** Convierte un mapeo CSV básico (`imports.mapping.v1`) en el mapeo de perfil equivalente. */
export function profileMappingFromCsv(csv: CsvMapping): ProfileMapping {
  const a = csv.columns.amount;
  return {
    hasHeader: csv.hasHeader,
    skipRows: csv.skipRows,
    skipFooterRows: 0,
    columns: {
      date: { index: csv.columns.date.index },
      description: [{ index: csv.columns.description.index }],
      amount:
        a.mode === 'SIGNED'
          ? { mode: 'SIGNED', column: { index: a.index }, signConvention: a.signConvention }
          : { mode: 'DEBIT_CREDIT', debit: { index: a.debitIndex }, credit: { index: a.creditIndex } },
    },
    dateFormat: csv.dateFormat,
    decimalSeparator: csv.decimalSeparator,
    descriptionCleanup: [],
  };
}

type MutableColumns = { -readonly [K in keyof ProfileColumns]: ProfileColumns[K] };

/**
 * Valida el mapeo tabular. `columnCount = null` valida un perfil sin archivo (solo estructura); con el ancho del
 * archivo también comprueba que las posiciones existan. Errores: `IMPORT_MAPPING_INVALID` con el puntero JSON.
 */
export function parseProfileMapping(input: unknown, columnCount: number | null): ProfileMapping {
  if (!isObject(input)) throw invalid('', 'the mapping must be an object');
  const hasHeader = input['hasHeader'];
  if (typeof hasHeader !== 'boolean') throw invalid('/hasHeader', 'hasHeader must be a boolean');
  const skipRows = input['skipRows'] ?? 0;
  if (
    typeof skipRows !== 'number' ||
    !Number.isInteger(skipRows) ||
    skipRows < 0 ||
    skipRows > MAX_SKIP_ROWS
  ) {
    throw invalid('/skipRows', `skipRows must be an integer between 0 and ${MAX_SKIP_ROWS}`);
  }
  const skipFooterRows = input['skipFooterRows'] ?? 0;
  if (
    typeof skipFooterRows !== 'number' ||
    !Number.isInteger(skipFooterRows) ||
    skipFooterRows < 0 ||
    skipFooterRows > MAX_FOOTER_ROWS
  ) {
    throw invalid('/skipFooterRows', `skipFooterRows must be an integer between 0 and ${MAX_FOOTER_ROWS}`);
  }
  const dateFormat = input['dateFormat'];
  if (!(DATE_FORMATS as readonly unknown[]).includes(dateFormat)) {
    throw invalid('/dateFormat', `dateFormat must be one of ${DATE_FORMATS.join(', ')}`);
  }
  let decimalSeparator: DecimalSeparator | null = null;
  const sep = input['decimalSeparator'];
  if (sep !== undefined && sep !== null) {
    if (!(DECIMAL_SEPARATORS as readonly unknown[]).includes(sep)) {
      throw invalid('/decimalSeparator', 'decimalSeparator must be "," or "."');
    }
    decimalSeparator = sep as DecimalSeparator;
  }
  const cols = input['columns'];
  if (!isObject(cols)) throw invalid('/columns', 'columns is required');
  const used: number[] = [];
  const take = (ref: ColumnRef): ColumnRef => {
    used.push(ref.index);
    return ref;
  };

  const date = take(column(required(cols, 'date', '/columns'), '/columns/date', columnCount));

  const rawDesc = required(cols, 'description', '/columns');
  if (!isObject(rawDesc)) throw invalid('/columns/description', 'description must be an object');
  let description: ColumnRef[];
  if (rawDesc['indexes'] !== undefined) {
    const list = rawDesc['indexes'];
    if (!Array.isArray(list) || list.length === 0 || list.length > MAX_DESCRIPTION_COLUMNS) {
      throw invalid(
        '/columns/description/indexes',
        `indexes must list 1 to ${MAX_DESCRIPTION_COLUMNS} columns`,
      );
    }
    description = list.map((c: unknown, i: number) =>
      take(
        column(typeof c === 'number' ? { index: c } : c, `/columns/description/indexes/${i}`, columnCount),
      ),
    );
  } else {
    description = [take(column(rawDesc, '/columns/description', columnCount))];
  }

  const rawAmount = required(cols, 'amount', '/columns');
  if (!isObject(rawAmount)) throw invalid('/columns/amount', 'amount must be an object');
  let amount: ProfileAmount;
  const mode = rawAmount['mode'];
  if (mode === 'SIGNED') {
    const ref = take(column(rawAmount, '/columns/amount', columnCount));
    if (!(SIGN_CONVENTIONS as readonly unknown[]).includes(rawAmount['signConvention'])) {
      throw invalid('/columns/amount/signConvention', 'signConvention is required');
    }
    amount = { mode, column: ref, signConvention: rawAmount['signConvention'] as SignConvention };
  } else if (mode === 'DEBIT_CREDIT') {
    const debit = take(
      column(
        rawAmount['debit'] ??
          (rawAmount['debitIndex'] !== undefined ? { index: rawAmount['debitIndex'] } : undefined),
        '/columns/amount/debit',
        columnCount,
      ),
    );
    const credit = take(
      column(
        rawAmount['credit'] ??
          (rawAmount['creditIndex'] !== undefined ? { index: rawAmount['creditIndex'] } : undefined),
        '/columns/amount/credit',
        columnCount,
      ),
    );
    if (debit.index === credit.index) {
      throw invalid('/columns/amount/credit', 'debit and credit must be different columns');
    }
    amount = { mode, debit, credit };
  } else if (mode === 'INDICATOR') {
    const ref = take(column(rawAmount, '/columns/amount', columnCount));
    const indicator = take(column(rawAmount['indicator'], '/columns/amount/indicator', columnCount));
    const debitValues = strings(
      rawAmount['debitValues'] ?? ['D', 'DB', '-'],
      '/columns/amount/debitValues',
      20,
    );
    const creditValues = strings(
      rawAmount['creditValues'] ?? ['C', 'CR', '+'],
      '/columns/amount/creditValues',
      20,
    );
    const clash = debitValues.some((d) => creditValues.some((c) => c.toUpperCase() === d.toUpperCase()));
    if (clash) throw invalid('/columns/amount/creditValues', 'debit and credit values must not overlap');
    amount = { mode, column: ref, indicator, debitValues, creditValues };
  } else {
    throw invalid('/columns/amount/mode', 'amount.mode must be SIGNED, DEBIT_CREDIT or INDICATOR');
  }

  const columns: MutableColumns = { date, description, amount };

  const cur = cols['currency'];
  if (cur !== undefined && cur !== null) {
    if (!isObject(cur)) throw invalid('/columns/currency', 'currency must be an object');
    const aliasesRaw = cur['aliases'] ?? {};
    if (!isObject(aliasesRaw) || Object.keys(aliasesRaw).length > 50) {
      throw invalid('/columns/currency/aliases', 'aliases must be an object of up to 50 entries');
    }
    const aliases: Record<string, string> = {};
    for (const [k, v] of Object.entries(aliasesRaw)) {
      if (typeof v !== 'string' || !/^[A-Z0-9][A-Z0-9_.-]{1,15}$/.test(v)) {
        throw invalid(`/columns/currency/aliases/${k}`, 'an alias must map to a currency code');
      }
      aliases[k.trim().toUpperCase()] = v;
    }
    columns.currency = { column: take(column(cur, '/columns/currency', columnCount)), aliases };
  }
  const ref = cols['reference'];
  if (ref !== undefined && ref !== null) {
    if (!isObject(ref) || typeof ref['unique'] !== 'boolean') {
      throw invalid('/columns/reference/unique', 'reference.unique must be a boolean');
    }
    columns.reference = {
      column: take(column(ref, '/columns/reference', columnCount)),
      unique: ref['unique'],
    };
  }
  const rb = cols['runningBalance'];
  if (rb !== undefined && rb !== null) {
    columns.runningBalance = take(column(rb, '/columns/runningBalance', columnCount));
  }
  const time = cols['time'];
  if (time !== undefined && time !== null) {
    if (!isObject(time) || !(TIME_FORMATS as readonly unknown[]).includes(time['format'])) {
      throw invalid('/columns/time/format', `time.format must be one of ${TIME_FORMATS.join(', ')}`);
    }
    columns.time = {
      column: take(column(time, '/columns/time', columnCount)),
      format: time['format'] as TimeFormat,
    };
  }
  const vd = cols['valueDate'];
  if (vd !== undefined && vd !== null)
    columns.valueDate = take(column(vd, '/columns/valueDate', columnCount));

  if (new Set(used).size !== used.length) {
    throw invalid('/columns', 'each field must use a different column');
  }
  const cleanup = strings(input['descriptionCleanup'] ?? [], '/descriptionCleanup', MAX_CLEANUP_PREFIXES);
  const sheet = input['sheet'];
  if (sheet !== undefined && (typeof sheet !== 'string' || sheet === '' || sheet.length > 31)) {
    throw invalid('/sheet', 'sheet must be a name of up to 31 characters');
  }
  return {
    hasHeader,
    skipRows,
    skipFooterRows,
    columns,
    dateFormat: dateFormat as DateFormat,
    decimalSeparator,
    descriptionCleanup: cleanup,
    sheet: sheet as string | undefined,
  };
}

/**
 * Valida las opciones de un perfil según su formato: CSV y XLSX exigen el mapeo de fecha, descripción y monto;
 * OFX, JSON y QIF son autodescritos y el mapeo es opcional (solo aportan limpieza y orden de fecha).
 */
export function parseProfileOptions(
  format: StatementFormat,
  input: unknown,
  columnCount: number | null = null,
): ProfileOptions {
  if (!(STATEMENT_FORMATS as readonly unknown[]).includes(format)) {
    throw invalid('/format', `format must be one of ${STATEMENT_FORMATS.join(', ')}`);
  }
  if (!isObject(input)) throw invalid('', 'the options must be an object');
  const version = input['version'];
  if (version !== undefined && version !== PROFILE_OPTIONS_VERSION) {
    throw invalid('/version', `version must be ${PROFILE_OPTIONS_VERSION}`);
  }
  const tabular = format === 'CSV' || format === 'XLSX';
  const rawMapping = input['mapping'];
  let mapping: ProfileMapping | null = null;
  if (tabular) {
    mapping = parseProfileMapping(rawMapping ?? undefined, columnCount);
  } else if (rawMapping !== undefined && rawMapping !== null) {
    throw invalid('/mapping', `a ${format} profile does not take a column mapping`);
  }
  const dateOrder = input['dateOrder'] ?? null;
  if (dateOrder !== null && dateOrder !== 'DMY' && dateOrder !== 'MDY') {
    throw invalid('/dateOrder', 'dateOrder must be DMY or MDY');
  }
  if (dateOrder !== null && format !== 'QIF') throw invalid('/dateOrder', 'dateOrder only applies to QIF');
  const pdfLayout = parsePdfLayoutRef(input['pdfLayout'], format);
  const cleanup = mapping
    ? mapping.descriptionCleanup
    : strings(input['descriptionCleanup'] ?? [], '/descriptionCleanup', MAX_CLEANUP_PREFIXES);
  return { version: PROFILE_OPTIONS_VERSION, mapping, descriptionCleanup: cleanup, dateOrder, pdfLayout };
}

/** `pdfLayout: { id, version }` solo en perfiles PDF (y obligatorio allí): el perfil fija la versión del diseño. */
function parsePdfLayoutRef(value: unknown, format: StatementFormat): { id: string; version: number } | null {
  if (format !== 'PDF') {
    if (value !== undefined && value !== null) {
      throw invalid('/pdfLayout', 'pdfLayout only applies to PDF profiles');
    }
    return null;
  }
  if (!isObject(value)) throw invalid('/pdfLayout', 'a PDF profile must fix the layout as { id, version }');
  const id = value['id'];
  const version = value['version'];
  if (typeof id !== 'string' || id.trim() === '' || id.length > 120) {
    throw invalid('/pdfLayout/id', 'the layout id must be a non-empty string');
  }
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw invalid('/pdfLayout/version', 'the layout version must be a positive integer');
  }
  return { id, version };
}

// ───────────────────────────────────────────────────────────── forma de entrada (API) ⇄ forma validada

const ref = (c: ColumnRef): Record<string, unknown> => ({
  index: c.index,
  ...(c.header !== undefined ? { header: c.header } : {}),
});

/** Inversa de `parseProfileMapping`: la forma de entrada (`imports.profile.v1`) de un mapeo ya validado. */
export function serializeProfileMapping(m: ProfileMapping): Record<string, unknown> {
  const a = m.columns.amount;
  const amount =
    a.mode === 'SIGNED'
      ? { mode: a.mode, ...ref(a.column), signConvention: a.signConvention }
      : a.mode === 'DEBIT_CREDIT'
        ? { mode: a.mode, debit: ref(a.debit), credit: ref(a.credit) }
        : {
            mode: a.mode,
            ...ref(a.column),
            indicator: ref(a.indicator),
            debitValues: [...a.debitValues],
            creditValues: [...a.creditValues],
          };
  const c = m.columns;
  return {
    hasHeader: m.hasHeader,
    skipRows: m.skipRows,
    skipFooterRows: m.skipFooterRows,
    dateFormat: m.dateFormat,
    ...(m.decimalSeparator !== null ? { decimalSeparator: m.decimalSeparator } : {}),
    descriptionCleanup: [...m.descriptionCleanup],
    ...(m.sheet !== undefined ? { sheet: m.sheet } : {}),
    columns: {
      date: ref(c.date),
      description: { indexes: c.description.map(ref) },
      amount,
      ...(c.currency ? { currency: { ...ref(c.currency.column), aliases: { ...c.currency.aliases } } } : {}),
      ...(c.reference ? { reference: { ...ref(c.reference.column), unique: c.reference.unique } } : {}),
      ...(c.runningBalance ? { runningBalance: ref(c.runningBalance) } : {}),
      ...(c.time ? { time: { ...ref(c.time.column), format: c.time.format } } : {}),
      ...(c.valueDate ? { valueDate: ref(c.valueDate) } : {}),
    },
  };
}

/** Inversa de `parseProfileOptions`: las opciones tal como las recibe y devuelve la API. */
export function serializeProfileOptions(o: ProfileOptions): Record<string, unknown> {
  return {
    version: PROFILE_OPTIONS_VERSION,
    ...(o.mapping ? { mapping: serializeProfileMapping(o.mapping) } : {}),
    descriptionCleanup: [...o.descriptionCleanup],
    dateOrder: o.dateOrder,
    ...(o.pdfLayout ? { pdfLayout: { id: o.pdfLayout.id, version: o.pdfLayout.version } } : {}),
  };
}
