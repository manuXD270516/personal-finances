import { unitOfWorkKysely } from '@pf/platform/api';
import {
  currency as makeCurrency,
  DomainError,
  LocalDate,
  Money,
  type Clock,
  type Currency,
} from '@pf/shared-kernel';
import { sql } from 'kysely';
import type { LedgerUnitOfWork } from '../application/ports/index.js';
import type {
  AccountBalanceDto,
  AccountBalancesDto,
  AccountBalancesQuery,
  BalanceQuery,
  EntrySummaryDto,
  LedgerAccountNatureDto,
  MoneyDto,
  TrialBalanceDto,
} from '../contracts/index.js';
import { BalanceCalculator } from '../domain/index.js';

interface BalanceRow {
  ledger_account_id: string;
  code: string;
  type: LedgerAccountNatureDto;
  source_account_id: string | null;
  currency: string;
  scale: number | string;
  balance: string;
}

/**
 * `BalanceQuery` sobre PostgreSQL (design.md §Decisiones 8 y 9): saldo = snapshot vigente más reciente con
 * `as_of_date ≤ asOf` + `SUM(amount)` de los postings posteriores (`posting_balance_ix … INCLUDE (amount)`), sobre
 * `NUMERIC` y agrupado por cuenta y moneda (nunca suma monedas distintas). Un snapshot invalidado por un asiento
 * retroactivo registrado después (`sequence > last_sequence` con `entry_date ≤ as_of_date`) se descarta en la misma
 * consulta, así que la lectura nunca depende del job de reconstrucción (INV-022). Sin `asOf`, el saldo es al día de hoy
 * en la zona horaria del workspace (FR-LEDGER-012). El ledger no conoce estados de transacción: los pendientes los
 * aporta Transactions (FR-LEDGER-013).
 */
export class PgBalanceQuery implements BalanceQuery, AccountBalancesQuery {
  constructor(
    private readonly uow: LedgerUnitOfWork,
    private readonly clock?: Clock,
  ) {}

  /** `asOf` explícito o, si falta, la fecha de hoy en la zona del workspace (sin reloj: sin límite de fecha). */
  private async asOfDate(workspaceId: string, asOf: string | undefined): Promise<string | null> {
    if (asOf !== undefined) return LocalDate.parse(asOf).toString();
    if (!this.clock) return null;
    const { rows } = await sql<{ time_zone: string }>`
      SELECT time_zone FROM iam.workspace WHERE id = ${workspaceId}`.execute(unitOfWorkKysely());
    const tz = rows[0]?.time_zone;
    return tz === undefined ? null : LocalDate.ofInstant(this.clock.now(), tz).toString();
  }

  getBalance(input: {
    workspaceId: string;
    ledgerAccountId: string;
    asOf?: string;
  }): Promise<AccountBalanceDto> {
    return this.uow.run(input.workspaceId, async () => {
      const asOf = await this.asOfDate(input.workspaceId, input.asOf);
      const rows = await this.balances(input.workspaceId, asOf, [input.ledgerAccountId]);
      const row = rows[0];
      if (!row)
        throw new DomainError('REFERENCE_NOT_FOUND', `ledger account ${input.ledgerAccountId} not found`);
      return this.toDto(row);
    });
  }

  getBalances(input: {
    workspaceId: string;
    ledgerAccountIds?: readonly string[];
    asOf?: string;
  }): Promise<readonly MoneyDto[]> {
    return this.uow.run(input.workspaceId, async () => {
      // Sin ids: solo cuentas del usuario (ASSET/LIABILITY ⇔ `source_account_id`, ledger_account_user_ck), en SQL.
      const rows = await this.balances(
        input.workspaceId,
        await this.asOfDate(input.workspaceId, input.asOf),
        input.ledgerAccountIds ?? null,
        input.ledgerAccountIds === undefined ? { accountIds: null } : null,
      );
      const totals = new Map<string, Money>();
      for (const row of rows) {
        const cur = this.currencyOf(row);
        const amount = Money.parse(row.balance, cur);
        totals.set(row.currency, (totals.get(row.currency) ?? Money.zero(cur)).add(amount));
      }
      return [...totals.values()].map((m) => m.toJSON());
    });
  }

  /**
   * `GetBalances` por lote (add-basic-dashboard): una línea por cuenta del usuario y el instante del último asiento
   * del workspace, en la misma transacción (lectura consistente con los saldos).
   */
  getAccountBalances(input: {
    workspaceId: string;
    accountIds?: readonly string[];
    asOf?: string;
  }): Promise<AccountBalancesDto> {
    return this.uow.run(input.workspaceId, async () => {
      const asOf = await this.asOfDate(input.workspaceId, input.asOf);
      const rows = await this.balances(input.workspaceId, asOf, null, {
        accountIds: input.accountIds ?? null,
      });
      const balances = rows.map((row) => this.toDto(row));
      const { rows: latest } = await sql<{ created_at: Date | string }>`
        SELECT created_at FROM ledger.journal_entry WHERE workspace_id = ${input.workspaceId}
         ORDER BY sequence DESC LIMIT 1`.execute(unitOfWorkKysely());
      const at = latest[0]?.created_at;
      return {
        asOf,
        latestEntryAt: at === undefined ? null : new Date(at).toISOString(),
        balances,
      };
    });
  }

  getTrialBalance(input: { workspaceId: string; asOf?: string }): Promise<TrialBalanceDto> {
    return this.uow.run(input.workspaceId, async () => {
      const asOf = await this.asOfDate(input.workspaceId, input.asOf);
      const rows = await this.balances(input.workspaceId, asOf, null);
      const byCurrency = new Map<string, { lines: AccountBalanceDto[]; total: Money }>();
      for (const row of rows) {
        const cur = this.currencyOf(row);
        const group = byCurrency.get(row.currency) ?? { lines: [], total: Money.zero(cur) };
        group.lines.push(this.toDto(row));
        group.total = group.total.add(Money.parse(row.balance, cur));
        byCurrency.set(row.currency, group);
      }
      return {
        asOf,
        currencies: [...byCurrency.entries()].map(([currency, g]) => ({
          currency,
          lines: g.lines,
          total: g.total.toJSON(),
        })),
      };
    });
  }

  getEntriesBySource(input: { workspaceId: string; sourceId: string }): Promise<readonly EntrySummaryDto[]> {
    return this.uow.run(input.workspaceId, async () => {
      const { rows } = await sql<{
        id: string;
        entry_type: EntrySummaryDto['entryType'];
        entry_date: string;
        sequence: string;
        source_revision: number;
        reverses_entry_id: string | null;
        reversed_by: string | null;
      }>`
        SELECT e.id, e.entry_type, e.entry_date::text AS entry_date, e.sequence::text AS sequence, e.source_revision,
               e.reverses_entry_id, r.reversal_entry_id AS reversed_by
          FROM ledger.journal_entry e
          LEFT JOIN ledger.entry_reversal r ON r.original_entry_id = e.id
         WHERE e.workspace_id = ${input.workspaceId} AND e.source_id = ${input.sourceId}
         ORDER BY e.sequence`.execute(unitOfWorkKysely());
      return rows.map((r) => ({
        journalEntryId: r.id,
        entryType: r.entry_type,
        entryDate: r.entry_date,
        sequence: r.sequence,
        sourceRevision: r.source_revision,
        reversesEntryId: r.reverses_entry_id,
        reversedByEntryId: r.reversed_by,
      }));
    });
  }

  /**
   * Saldos por cuenta contable. `userAccounts` restringe a las cuentas del usuario (`source_account_id`, opcionalmente
   * solo las indicadas) EN SQL, sin calcular las de sistema. La escala de cada moneda viene del catálogo en la misma
   * consulta (sin una lectura de `fx.currency` por fila).
   *
   * Invalidación de snapshots (INV-022) sin recorrer el historial por cuenta: primero el checkpoint mínimo
   * (`last_sequence`) de los snapshots candidatos; luego, UNA vez, los postings de asientos posteriores a ese checkpoint
   * (`journal_entry_sequence_ix`, típicamente solo los del día) materializados; un snapshot es válido si ninguno de ellos
   * toca su cuenta con `sequence > last_sequence` y `entry_date ≤ as_of_date`. Mismo resultado que el `NOT EXISTS`
   * correlacionado original (el snapshot válido más reciente o, si no hay, Σ completa), con coste proporcional a lo
   * registrado desde la reconstrucción y no al historial (NFR-PERF-005). Sin snapshot válido el lateral devuelve
   * `('-infinity', 0)`, de modo que el tramo posterior es siempre `entry_date > s.as_of_date`: una comparación
   * leakproof que, también bajo RLS, es condición del índice `posting_balance_ix` (con `as_of_date IS NULL OR …` o un
   * `COALESCE` el índice recorre todos los postings de la cuenta y filtra).
   */
  private async balances(
    workspaceId: string,
    asOf: string | null,
    ids: readonly string[] | null,
    userAccounts: { readonly accountIds: readonly string[] | null } | null = null,
  ): Promise<BalanceRow[]> {
    const db = unitOfWorkKysely();
    const onlyUser = userAccounts !== null;
    const accountIds = userAccounts?.accountIds ?? null;
    const { rows: floor } = await sql<{ seq: string | null }>`
      SELECT min(bs.last_sequence)::text AS seq FROM ledger.balance_snapshot bs
       WHERE bs.workspace_id = ${workspaceId}
         AND (${asOf}::date IS NULL OR bs.as_of_date <= ${asOf}::date)
         AND (${ids === null}::boolean OR bs.ledger_account_id = ANY(${ids ?? []}::uuid[]))`.execute(db);
    // Sin snapshots candidatos no hay nada que invalidar (`> NULL` no devuelve filas).
    const checkpoint = floor[0]?.seq ?? null;
    const { rows } = await sql<BalanceRow>`
      WITH late AS MATERIALIZED (
        SELECT p2.ledger_account_id, e.sequence, e.entry_date
          FROM ledger.journal_entry e
          JOIN ledger.posting p2 ON p2.workspace_id = e.workspace_id AND p2.journal_entry_id = e.id
         WHERE e.workspace_id = ${workspaceId} AND e.sequence > ${checkpoint}::bigint)
      SELECT a.id AS ledger_account_id, a.code, a.type, a.source_account_id, a.currency, c.scale,
             (s.balance + COALESCE((
               SELECT SUM(p.amount) FROM ledger.posting p
                WHERE p.workspace_id = a.workspace_id AND p.ledger_account_id = a.id
                  AND p.entry_date > s.as_of_date
                  AND (${asOf}::date IS NULL OR p.entry_date <= ${asOf}::date)), 0))::text AS balance
        FROM ledger.ledger_account a
        JOIN fx.currency c ON c.code = a.currency
        CROSS JOIN LATERAL (
          (SELECT bs.as_of_date, bs.balance FROM ledger.balance_snapshot bs
            WHERE bs.workspace_id = a.workspace_id AND bs.ledger_account_id = a.id
              AND (${asOf}::date IS NULL OR bs.as_of_date <= ${asOf}::date)
              AND NOT EXISTS (
                SELECT 1 FROM late l
                 WHERE l.ledger_account_id = bs.ledger_account_id AND l.sequence > bs.last_sequence
                   AND l.entry_date <= bs.as_of_date)
            ORDER BY bs.as_of_date DESC LIMIT 1)
          UNION ALL SELECT '-infinity'::date, 0
          ORDER BY 1 DESC LIMIT 1) s
       WHERE a.workspace_id = ${workspaceId}
         AND (${ids === null}::boolean OR a.id = ANY(${ids ?? []}::uuid[]))
         AND (NOT ${onlyUser}::boolean OR a.source_account_id IS NOT NULL)
         AND (${accountIds === null}::boolean OR a.source_account_id = ANY(${accountIds ?? []}::uuid[]))
       ORDER BY a.currency, a.code`.execute(db);
    return rows;
  }

  private currencyOf(row: BalanceRow): Currency {
    return makeCurrency(row.currency, Number(row.scale));
  }

  private toDto(row: BalanceRow): AccountBalanceDto {
    const balance = Money.parse(row.balance, this.currencyOf(row));
    return {
      ledgerAccountId: row.ledger_account_id,
      code: row.code,
      nature: row.type,
      accountId: row.source_account_id,
      balance: balance.toJSON(),
      presented: BalanceCalculator.presented(row.type, balance).toJSON(),
    };
  }
}
