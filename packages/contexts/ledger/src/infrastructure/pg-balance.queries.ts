import { unitOfWorkKysely } from '@pf/platform/api';
import { DomainError, LocalDate, Money, type Clock } from '@pf/shared-kernel';
import { sql } from 'kysely';
import type { CurrencyCatalog, LedgerUnitOfWork } from '../application/ports/index.js';
import type {
  AccountBalanceDto,
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
export class PgBalanceQuery implements BalanceQuery {
  constructor(
    private readonly uow: LedgerUnitOfWork,
    private readonly currencies: CurrencyCatalog,
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
      const rows = await this.balances(
        input.workspaceId,
        await this.asOfDate(input.workspaceId, input.asOf),
        input.ledgerAccountIds ?? null,
      );
      const totals = new Map<string, Money>();
      for (const row of rows) {
        if (input.ledgerAccountIds === undefined && row.type !== 'ASSET' && row.type !== 'LIABILITY')
          continue;
        const cur = await this.currencies.currencyOf(row.currency);
        const amount = Money.parse(row.balance, cur);
        totals.set(row.currency, (totals.get(row.currency) ?? Money.zero(cur)).add(amount));
      }
      return [...totals.values()].map((m) => m.toJSON());
    });
  }

  getTrialBalance(input: { workspaceId: string; asOf?: string }): Promise<TrialBalanceDto> {
    return this.uow.run(input.workspaceId, async () => {
      const asOf = await this.asOfDate(input.workspaceId, input.asOf);
      const rows = await this.balances(input.workspaceId, asOf, null);
      const byCurrency = new Map<string, { lines: AccountBalanceDto[]; total: Money }>();
      for (const row of rows) {
        const cur = await this.currencies.currencyOf(row.currency);
        const group = byCurrency.get(row.currency) ?? { lines: [], total: Money.zero(cur) };
        group.lines.push(await this.toDto(row));
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

  private async balances(
    workspaceId: string,
    asOf: string | null,
    ids: readonly string[] | null,
  ): Promise<BalanceRow[]> {
    const { rows } = await sql<BalanceRow>`
      SELECT a.id AS ledger_account_id, a.code, a.type, a.source_account_id, a.currency,
             (COALESCE(s.balance, 0) + COALESCE((
               SELECT SUM(p.amount) FROM ledger.posting p
                WHERE p.workspace_id = a.workspace_id AND p.ledger_account_id = a.id
                  AND (s.as_of_date IS NULL OR p.entry_date > s.as_of_date)
                  AND (${asOf}::date IS NULL OR p.entry_date <= ${asOf}::date)), 0))::text AS balance
        FROM ledger.ledger_account a
        LEFT JOIN LATERAL (
          SELECT bs.as_of_date, bs.balance FROM ledger.balance_snapshot bs
           WHERE bs.workspace_id = a.workspace_id AND bs.ledger_account_id = a.id
             AND (${asOf}::date IS NULL OR bs.as_of_date <= ${asOf}::date)
             AND NOT EXISTS (
               SELECT 1 FROM ledger.journal_entry e JOIN ledger.posting p2 ON p2.journal_entry_id = e.id
                WHERE e.workspace_id = bs.workspace_id AND e.sequence > bs.last_sequence
                  AND e.entry_date <= bs.as_of_date AND p2.ledger_account_id = bs.ledger_account_id)
           ORDER BY bs.as_of_date DESC LIMIT 1) s ON true
       WHERE a.workspace_id = ${workspaceId}
         AND (${ids === null}::boolean OR a.id = ANY(${ids ?? []}::uuid[]))
       ORDER BY a.currency, a.code`.execute(unitOfWorkKysely());
    return rows;
  }

  private async toDto(row: BalanceRow): Promise<AccountBalanceDto> {
    const balance = Money.parse(row.balance, await this.currencies.currencyOf(row.currency));
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
