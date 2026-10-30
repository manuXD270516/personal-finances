import { unitOfWorkKysely } from '@pf/platform/api';
import { canonicalDecimal, DomainError } from '@pf/shared-kernel';
import { sql, type Kysely } from 'kysely';
import type {
  CategoryOriginDto,
  ClassificationCoverageQuery,
  ClassificationSubjectDto,
  ClassificationSubjectsQuery,
} from '../contracts/index.js';

const db = () => unitOfWorkKysely<Record<string, never>>() as Kysely<Record<string, never>>;

/** Tope de sujetos por consulta (D339: el dry-run lee hasta 5 000 transacciones). */
const MAX_SUBJECTS = 5000;

interface SubjectRow {
  id: string;
  version: number;
  status: string;
  kind: 'INCOME' | 'EXPENSE' | 'REFUND';
  account_id: string;
  currency: string;
  amount: string;
  scale: number;
  description: string | null;
  notes: string | null;
  counterparty_id: string | null;
  source: string;
  external_ref_namespace: string | null;
  transaction_date: string;
  review_status: string | null;
}

interface SplitRow {
  transaction_id: string;
  split_count: string;
  category_id: string | null;
  category_origin: CategoryOriginDto | null;
  tag_ids: string[];
  custom_fields: {
    field_id: string;
    text: string | null;
    num: string | null;
    date: string | null;
    bool: boolean | null;
  }[];
}

const encodeCursor = (date: string, id: string): string => Buffer.from(`${date}|${id}`).toString('base64url');
function decodeCursor(cursor: string): { date: string; id: string } {
  const [date, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  if (!date || !id || !/^\d{4}-\d{2}-\d{2}$/u.test(date)) {
    throw new DomainError('VALIDATION_FAILED', 'invalid cursor').at('/after');
  }
  return { date, id };
}

/**
 * Sujetos de clasificación para RULES (openspec add-rule-engine): lectura SIN efectos de las transacciones de ingreso,
 * gasto y reembolso no anuladas, con su categoría (null si es «sin categoría» de sistema), origen, etiquetas y valores de
 * campos personalizados. Corre en la unidad de trabajo del llamador (RLS del workspace).
 */
export class PgClassificationSubjects implements ClassificationSubjectsQuery {
  async list(input: Parameters<ClassificationSubjectsQuery['list']>[0]) {
    const limit = Math.min(Math.max(input.limit, 1), MAX_SUBJECTS);
    const after = input.after ? decodeCursor(input.after) : null;
    const accountFilter =
      input.accountIds && input.accountIds.length > 0
        ? sql`AND t.account_id = ANY (${[...input.accountIds]}::uuid[])`
        : sql``;
    const cursor = after
      ? sql`AND (t.transaction_date, t.id) > (${after.date}::date, ${after.id}::uuid)`
      : sql``;
    const { rows } = await sql<SubjectRow>`
      SELECT t.id, t.version, t.status, t.kind, t.account_id, t.currency, t.amount::text AS amount, c.scale,
             t.description, t.notes, t.counterparty_id, t.source, t.external_ref_namespace,
             t.transaction_date::text AS transaction_date, t.review_status
        FROM txn.transaction t
        JOIN fx.currency c ON c.code = t.currency
       WHERE t.workspace_id = ${input.workspaceId}
         AND t.kind IN ('INCOME', 'EXPENSE', 'REFUND') AND t.status <> 'VOIDED'
         AND t.transaction_date BETWEEN ${input.from}::date AND ${input.to}::date
         ${accountFilter} ${cursor}
       ORDER BY t.transaction_date, t.id
       LIMIT ${limit + 1}`.execute(db());
    const page = rows.slice(0, limit);
    const items = await this.hydrate(input.workspaceId, page);
    const last = page[page.length - 1];
    return {
      items,
      next: rows.length > limit && last ? encodeCursor(last.transaction_date, last.id) : null,
    };
  }

  async byIds(input: Parameters<ClassificationSubjectsQuery['byIds']>[0]) {
    if (input.transactionIds.length === 0) return [];
    const { rows } = await sql<SubjectRow>`
      SELECT t.id, t.version, t.status, t.kind, t.account_id, t.currency, t.amount::text AS amount, c.scale,
             t.description, t.notes, t.counterparty_id, t.source, t.external_ref_namespace,
             t.transaction_date::text AS transaction_date, t.review_status
        FROM txn.transaction t
        JOIN fx.currency c ON c.code = t.currency
       WHERE t.workspace_id = ${input.workspaceId} AND t.id = ANY (${[...input.transactionIds]}::uuid[])
         AND t.kind IN ('INCOME', 'EXPENSE', 'REFUND') AND t.status <> 'VOIDED'
       ORDER BY t.transaction_date, t.id`.execute(db());
    return this.hydrate(input.workspaceId, rows);
  }

  private async hydrate(
    workspaceId: string,
    rows: readonly SubjectRow[],
  ): Promise<ClassificationSubjectDto[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    // Por transacción: nº de splits vigentes y, para las de un solo split, categoría, origen, etiquetas y campos.
    const { rows: splits } = await sql<SplitRow>`
      SELECT s.transaction_id, count(*) OVER (PARTITION BY s.transaction_id)::text AS split_count,
             CASE WHEN cat.system_code IN ('UNCATEGORIZED', 'UNCATEGORIZED_INCOME') THEN NULL ELSE s.category_id END
               AS category_id,
             s.category_origin,
             COALESCE((SELECT array_agg(st.tag_id::text ORDER BY st.tag_id) FROM txn.split_tag st
                        WHERE st.workspace_id = s.workspace_id AND st.split_id = s.id), '{}') AS tag_ids,
             COALESCE((SELECT jsonb_agg(jsonb_build_object('field_id', v.field_id, 'text', v.value_text,
                          'num', v.value_number::text, 'date', v.value_date::text, 'bool', v.value_bool))
                         FROM txn.split_custom_field_value v
                        WHERE v.workspace_id = s.workspace_id AND v.split_id = s.id), '[]'::jsonb) AS custom_fields
        FROM txn.transaction_split s
        LEFT JOIN classification.category cat ON cat.id = s.category_id AND cat.workspace_id = s.workspace_id
       WHERE s.workspace_id = ${workspaceId} AND s.transaction_id = ANY (${ids}::uuid[])
         AND s.superseded_in_revision IS NULL
       ORDER BY s.transaction_id, s.position`.execute(db());
    const firstOf = new Map<string, SplitRow>();
    for (const s of splits) if (!firstOf.has(s.transaction_id)) firstOf.set(s.transaction_id, s);
    return rows.map((r): ClassificationSubjectDto => {
      const s = firstOf.get(r.id);
      const fields = (s?.custom_fields ?? []).flatMap((v) => {
        const value =
          v.text !== null
            ? v.text
            : v.num !== null
              ? canonicalDecimal(v.num)
              : v.date !== null
                ? v.date
                : v.bool;
        return value === null ? [] : [{ fieldId: v.field_id, value }];
      });
      return {
        transactionId: r.id,
        version: r.version,
        status: r.status,
        managedBy: r.source === 'DEBT' ? 'DEBT' : r.source === 'GOAL' ? 'GOAL' : null,
        date: r.transaction_date,
        kind: r.kind,
        accountId: r.account_id,
        amount: {
          amount: Number(r.scale) === 0 ? r.amount.split('.')[0]! : padScale(r.amount, Number(r.scale)),
          currency: r.currency,
        },
        description: r.description,
        notes: r.notes,
        counterpartyId: r.counterparty_id,
        categoryId: s?.category_id ?? null,
        categoryOrigin: s?.category_origin ?? 'UNKNOWN',
        tagIds: s?.tag_ids ?? [],
        externalSource: r.external_ref_namespace ?? r.source,
        customFields: fields,
        splitCount: Number(s?.split_count ?? 1),
        needsReview: r.review_status === 'PENDING',
      };
    });
  }
}

/** `numeric(38,18)` llega con 18 decimales: se lleva a la escala de la moneda (exacto, sin redondeo). */
function padScale(value: string, scale: number): string {
  const canonical = canonicalDecimal(value);
  const [whole = '0', fraction = ''] = canonical.split('.');
  return `${whole}.${fraction.padEnd(scale, '0').slice(0, Math.max(scale, fraction.length))}`;
}

const ORIGINS: readonly CategoryOriginDto[] = [
  'MANUAL',
  'RULE',
  'COUNTERPARTY_DEFAULT',
  'SYSTEM_DEFAULT',
  'UNKNOWN',
];

/**
 * Cobertura y estadísticas de reglas (design decisión 11, D334): una consulta agregada sobre los splits vigentes. El
 * origen de una transacción es `RULE` si TODOS sus splits lo son; si no, el del primer split por orden alfabético
 * (determinista). Una corrección manual posterior deja el origen en `MANUAL`: sale del numerador.
 */
export class PgClassificationCoverage implements ClassificationCoverageQuery {
  async coverage(input: Parameters<ClassificationCoverageQuery['coverage']>[0]) {
    const scope =
      input.importJobId !== undefined
        ? sql`AND t.import_job_id = ${input.importJobId}::uuid`
        : sql`${input.from ? sql`AND t.transaction_date >= ${input.from}::date` : sql``}
              ${input.to ? sql`AND t.transaction_date <= ${input.to}::date` : sql``}`;
    const { rows } = await sql<{ origin: CategoryOriginDto; n: string }>`
      WITH universe AS (
        SELECT t.id FROM txn.transaction t
         WHERE t.workspace_id = ${input.workspaceId} AND t.source = 'IMPORT'
           AND t.kind IN ('INCOME', 'EXPENSE', 'REFUND') AND t.status <> 'VOIDED' ${scope}
      ), per AS (
        SELECT u.id,
               bool_and(COALESCE(s.category_origin = 'RULE', false)) AS all_rule,
               min(COALESCE(s.category_origin, 'UNKNOWN')) AS any_origin
          FROM universe u
          JOIN txn.transaction_split s
            ON s.workspace_id = ${input.workspaceId} AND s.transaction_id = u.id AND s.superseded_in_revision IS NULL
         GROUP BY u.id
      )
      SELECT CASE WHEN all_rule THEN 'RULE' ELSE any_origin END AS origin, count(*)::text AS n
        FROM per GROUP BY 1`.execute(db());
    const byOrigin = Object.fromEntries(ORIGINS.map((o) => [o, 0])) as Record<CategoryOriginDto, number>;
    for (const r of rows) byOrigin[r.origin] = Number(r.n);
    const { rows: rules } = await sql<{ rule_id: string; version: number; n: string; last: string | null }>`
      WITH universe AS (
        SELECT t.id, t.updated_at FROM txn.transaction t
         WHERE t.workspace_id = ${input.workspaceId} AND t.source = 'IMPORT'
           AND t.kind IN ('INCOME', 'EXPENSE', 'REFUND') AND t.status <> 'VOIDED' ${scope}
      )
      SELECT s.category_rule_id AS rule_id, max(s.category_rule_version) AS version, count(DISTINCT u.id)::text AS n,
             to_char(max(u.updated_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS last
        FROM universe u
        JOIN txn.transaction_split s
          ON s.workspace_id = ${input.workspaceId} AND s.transaction_id = u.id AND s.superseded_in_revision IS NULL
       WHERE s.category_rule_id IS NOT NULL
       GROUP BY s.category_rule_id
       ORDER BY count(DISTINCT u.id) DESC, s.category_rule_id`.execute(db());
    return {
      count: Object.values(byOrigin).reduce((a, b) => a + b, 0),
      byOrigin,
      byRule: rules.map((r) => ({
        ruleId: r.rule_id,
        ruleVersion: r.version,
        count: Number(r.n),
        lastAppliedAt: r.last,
      })),
    };
  }

  /**
   * Por regla, en todo el workspace: transacciones no anuladas con algún split cuya categoría o cuyas referencias fijó
   * la regla hoy, y la última actualización (aproxima «última aplicación»).
   */
  async ruleStats(input: Parameters<ClassificationCoverageQuery['ruleStats']>[0]) {
    const { rows } = await sql<{ rule_id: string; version: number | null; n: string; last: string | null }>`
      WITH refs AS (
        SELECT s.transaction_id, s.category_rule_id AS rule_id, s.category_rule_version AS version
          FROM txn.transaction_split s
         WHERE s.workspace_id = ${input.workspaceId} AND s.category_rule_id IS NOT NULL
           AND s.superseded_in_revision IS NULL
        UNION ALL
        SELECT s.transaction_id, (e.value ->> 'ruleId')::uuid, (e.value ->> 'ruleVersion')::int
          FROM txn.transaction_split s, jsonb_array_elements(s.rule_refs) AS e(value)
         WHERE s.workspace_id = ${input.workspaceId} AND s.rule_refs IS NOT NULL AND s.superseded_in_revision IS NULL
      )
      SELECT r.rule_id, max(r.version) AS version, count(DISTINCT r.transaction_id)::text AS n,
             to_char(max(t.updated_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS last
        FROM refs r
        JOIN txn.transaction t ON t.workspace_id = ${input.workspaceId} AND t.id = r.transaction_id
       WHERE t.status <> 'VOIDED'
       GROUP BY r.rule_id`.execute(db());
    return rows.map((r) => ({
      ruleId: r.rule_id,
      ruleVersion: r.version,
      count: Number(r.n),
      lastAppliedAt: r.last,
    }));
  }
}
