import type { PortabilitySection } from '@pf/shared-kernel';

/**
 * SQL genérico de las secciones de portabilidad (openspec add-workspace-export): introspección de columnas, expresión de
 * lectura que normaliza cada tipo al formato del archivo y cálculo del balance de comprobación. Todo el SQL se arma con
 * identificadores tomados del catálogo de PostgreSQL o de las declaraciones de los contextos (datos puros, no entrada de
 * usuario) y se cita siempre; los valores viajan como parámetros o literales escapados.
 */
export interface SqlExec {
  query(text: string, values?: unknown[]): Promise<{ rows: unknown[] }>;
}

export type ColumnKind =
  | 'uuid'
  | 'text'
  | 'int'
  | 'bigint'
  | 'bool'
  | 'numeric'
  | 'date'
  | 'timestamptz'
  | 'time'
  | 'jsonb'
  | 'bytea'
  | 'uuid[]'
  | 'text[]'
  | 'numeric[]';

export interface ColumnInfo {
  readonly name: string;
  readonly kind: ColumnKind;
  readonly notNull: boolean;
  /** Identidad `GENERATED ALWAYS` o columna generada: la base la asigna; nunca se inserta. */
  readonly generated: boolean;
}

const KIND_BY_UDT: Readonly<Record<string, ColumnKind>> = {
  uuid: 'uuid',
  text: 'text',
  varchar: 'text',
  bpchar: 'text',
  name: 'text',
  int2: 'int',
  int4: 'int',
  int8: 'bigint',
  bool: 'bool',
  numeric: 'numeric',
  date: 'date',
  timestamptz: 'timestamptz',
  time: 'time',
  jsonb: 'jsonb',
  json: 'jsonb',
  bytea: 'bytea',
  _uuid: 'uuid[]',
  _text: 'text[]',
  _varchar: 'text[]',
  _numeric: 'numeric[]',
};

const IDENT = /^[a-z_][a-z0-9_]*$/u;
/** Cita un identificador de catálogo (`schema.tabla` → `"schema"."tabla"`); falla si no es un nombre simple. */
export function quoteTable(table: string): string {
  const parts = table.split('.');
  if (parts.length !== 2 || !parts.every((p) => IDENT.test(p))) throw new Error(`tabla inválida: ${table}`);
  return parts.map((p) => `"${p}"`).join('.');
}
export function quoteIdent(name: string): string {
  if (!IDENT.test(name)) throw new Error(`identificador inválido: ${name}`);
  return `"${name}"`;
}

const columnCache = new WeakMap<object, Map<string, readonly ColumnInfo[]>>();

/** Columnas de una tabla (en orden), con su clase de tipo. Se cachea por conexión lógica (`cacheKey`). */
export async function loadColumns(
  exec: SqlExec,
  table: string,
  cacheKey?: object,
): Promise<readonly ColumnInfo[]> {
  const bucket = cacheKey
    ? (columnCache.get(cacheKey) ?? new Map<string, readonly ColumnInfo[]>())
    : undefined;
  if (cacheKey && bucket) {
    columnCache.set(cacheKey, bucket);
    const hit = bucket.get(table);
    if (hit) return hit;
  }
  const { rows } = await exec.query(
    `SELECT a.attname AS name, t.typname AS udt, a.attnotnull AS not_null,
            (a.attidentity = 'a' OR a.attgenerated <> '') AS generated
       FROM pg_attribute a JOIN pg_type t ON t.oid = a.atttypid
      WHERE a.attrelid = $1::regclass AND a.attnum > 0 AND NOT a.attisdropped
      ORDER BY a.attnum`,
    [quoteTable(table)],
  );
  const columns = (rows as { name: string; udt: string; not_null: boolean; generated: boolean }[]).map(
    (r) => {
      const kind = KIND_BY_UDT[r.udt];
      if (!kind) throw new Error(`tipo no soportado en el export: ${table}.${r.name} (${r.udt})`);
      return { name: r.name, kind, notNull: r.not_null, generated: r.generated } satisfies ColumnInfo;
    },
  );
  bucket?.set(table, columns);
  return columns;
}

/** Columnas que viajan en el archivo (todas menos las omitidas), en orden de tabla. */
export function exportedColumns(
  section: PortabilitySection,
  columns: readonly ColumnInfo[],
): readonly ColumnInfo[] {
  const omit = new Set(section.omit ?? []);
  for (const o of omit)
    if (!columns.some((c) => c.name === o))
      throw new Error(`${section.table}: columna omitida inexistente ${o}`);
  return columns.filter((c) => !omit.has(c.name));
}

/** Columnas a insertar al importar: las exportadas, salvo identidades/generadas. */
export function insertColumns(
  section: PortabilitySection,
  columns: readonly ColumnInfo[],
): readonly ColumnInfo[] {
  return exportedColumns(section, columns).filter((c) => !c.generated);
}

/** Columnas que identifican a la entidad (siembran el mapa de ids): `idColumns` o `id` si existe. */
export function idColumnsOf(section: PortabilitySection, columns: readonly ColumnInfo[]): readonly string[] {
  if (section.idColumns) return section.idColumns;
  return columns.some((c) => c.name === 'id') ? ['id'] : [];
}

const scaleOf = (currencyExpr: string) =>
  `(SELECT c.scale FROM fx.currency c WHERE c.code = ${currencyExpr})`;

/** Texto decimal exacto con la escala de la moneda (o sin ceros de relleno si el valor tiene más decimales). */
export function moneyText(valueExpr: string, currencyExpr: string): string {
  return `CASE WHEN ${valueExpr} IS NULL THEN NULL
        WHEN round(${valueExpr}, ${scaleOf(currencyExpr)}) = ${valueExpr}
          THEN round(${valueExpr}, ${scaleOf(currencyExpr)})::text
        ELSE trim_scale(${valueExpr})::text END`;
}

/** Expresión de lectura de una columna: el valor ya viene en su forma de archivo (texto exacto, ISO UTC…). */
export function selectExpression(section: PortabilitySection, col: ColumnInfo): string {
  const q = `t.${quoteIdent(col.name)}`;
  switch (col.kind) {
    case 'numeric': {
      const ccy = section.money?.[col.name];
      return ccy ? moneyText(q, ccy) : `trim_scale(${q})::text`;
    }
    case 'bigint':
      return `${q}::text`;
    case 'date':
    case 'time':
      return `${q}::text`;
    case 'timestamptz':
      return `to_char(${q} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
    case 'bytea':
      return `encode(${q}, 'base64')`;
    case 'numeric[]':
      return `(SELECT array_agg(trim_scale(x)::text ORDER BY ord) FROM unnest(${q}) WITH ORDINALITY AS u(x, ord))`;
    default:
      return q;
  }
}

/** Consulta de una sección acotada por el workspace (literal ya validado como UUID). */
export function buildSectionQuery(
  section: PortabilitySection,
  columns: readonly ColumnInfo[],
  workspaceLiteral: string,
): string {
  const cols = exportedColumns(section, columns);
  const wsCol = quoteIdent(section.workspaceColumn ?? 'workspace_id');
  const order = section.orderBy
    .map(quoteIdent)
    .map((c) => `t.${c}`)
    .join(', ');
  return (
    `SELECT ${cols.map((c) => `${selectExpression(section, c)} AS ${quoteIdent(c.name)}`).join(', ')}\n` +
    `  FROM ${quoteTable(section.table)} t\n` +
    ` WHERE t.${wsCol} = ${workspaceLiteral}${section.where ? ` AND (${section.where})` : ''}\n` +
    ` ORDER BY ${order}`
  );
}

export interface VerificationRows {
  readonly accountBalances: { accountId: string; currency: string; balance: string }[];
  readonly trialBalance: { ledgerAccountId: string; currency: string; balance: string }[];
}

/**
 * Saldos por cuenta de usuario y balance de comprobación por cuenta contable (suma de postings, signo contable, escala de
 * la moneda). El mismo cálculo corre al exportar (instantánea) y al verificar la importación.
 */
export async function computeVerification(exec: SqlExec, workspaceId: string): Promise<VerificationRows> {
  const total = (alias: string) => moneyText('s.total', `${alias}.currency`);
  const accounts = await exec.query(
    `SELECT s.account_id, s.currency, ${total('s')} AS balance
       FROM (SELECT la.source_account_id AS account_id, p.currency, SUM(p.amount) AS total
               FROM ledger.posting p JOIN ledger.ledger_account la ON la.id = p.ledger_account_id
              WHERE p.workspace_id = $1 AND la.source_account_id IS NOT NULL
              GROUP BY la.source_account_id, p.currency) s
      ORDER BY s.account_id, s.currency`,
    [workspaceId],
  );
  const ledger = await exec.query(
    `SELECT s.ledger_account_id, s.currency, ${total('s')} AS balance
       FROM (SELECT p.ledger_account_id, p.currency, SUM(p.amount) AS total
               FROM ledger.posting p WHERE p.workspace_id = $1 GROUP BY p.ledger_account_id, p.currency) s
      ORDER BY s.ledger_account_id, s.currency`,
    [workspaceId],
  );
  return {
    accountBalances: (accounts.rows as { account_id: string; currency: string; balance: string }[]).map(
      (r) => ({
        accountId: r.account_id,
        currency: r.currency,
        balance: r.balance,
      }),
    ),
    trialBalance: (ledger.rows as { ledger_account_id: string; currency: string; balance: string }[]).map(
      (r) => ({
        ledgerAccountId: r.ledger_account_id,
        currency: r.currency,
        balance: r.balance,
      }),
    ),
  };
}
