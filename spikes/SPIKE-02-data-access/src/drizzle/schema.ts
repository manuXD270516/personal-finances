import { pgSchema, pgTable, uuid, varchar, text, bigint, smallint, timestamp, date, integer, numeric, index, foreignKey, primaryKey, unique, check, pgPolicy } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"

export const fx = pgSchema("fx");
export const iam = pgSchema("iam");
export const ledger = pgSchema("ledger");


export const currencyInFx = fx.table("currency", {
	code: varchar({ length: 16 }).primaryKey(),
	kind: text().notNull(),
	scale: smallint().notNull(),
}, (table) => [
check("currency_kind_check", sql`(kind = ANY (ARRAY['FIAT'::text, 'CRYPTO'::text, 'COMMODITY'::text, 'CUSTOM'::text]))`),check("currency_scale_check", sql`((scale >= 0) AND (scale <= 18))`),]);

export const workspaceInIam = iam.table("workspace", {
	id: uuid().primaryKey(),
	name: text().notNull(),
	createdAt: timestamp("created_at", { withTimezone: true }).default(sql`now()`).notNull(),
});

export const journalEntryInLedger = ledger.table.withRLS("journal_entry", {
	id: uuid().primaryKey(),
	workspaceId: uuid("workspace_id").notNull().references(() => workspaceInIam.id),
	sequence: bigint({ mode: 'number' }).generatedAlwaysAsIdentity(),
	entryDate: date("entry_date").notNull(),
	entryType: text("entry_type").notNull(),
	sourceType: text("source_type").notNull(),
	sourceId: uuid("source_id").notNull(),
	sourceRevision: integer("source_revision").notNull(),
	reversesEntryId: uuid("reverses_entry_id"),
	memo: text(),
	createdAt: timestamp("created_at", { withTimezone: true }).default(sql`now()`).notNull(),
}, (table) => [
	foreignKey({
		columns: [table.workspaceId, table.reversesEntryId],
		foreignColumns: [table.workspaceId, table.id],
		name: "journal_entry_reversal_fk"
	}),
	unique("journal_entry_id_date_uk").on(table.id, table.entryDate),	unique("journal_entry_ws_id_uk").on(table.workspaceId, table.id),
	pgPolicy("ws_isolation", { using: sql`(workspace_id = platform.current_workspace_id())`, withCheck: sql`(workspace_id = platform.current_workspace_id())` }),
check("journal_entry_entry_type_check", sql`(entry_type = ANY (ARRAY['STANDARD'::text, 'REVERSAL'::text, 'OPENING'::text]))`),check("journal_entry_reversal_ck", sql`((entry_type = 'REVERSAL'::text) = (reverses_entry_id IS NOT NULL))`),]);

export const ledgerAccountInLedger = ledger.table.withRLS("ledger_account", {
	id: uuid().primaryKey(),
	workspaceId: uuid("workspace_id").notNull().references(() => workspaceInIam.id),
	type: text().notNull(),
	currency: varchar({ length: 16 }).notNull().references(() => currencyInFx.code),
	systemKind: text("system_kind"),
	sourceAccountId: uuid("source_account_id"),
	code: text().notNull(),
	createdAt: timestamp("created_at", { withTimezone: true }).default(sql`now()`).notNull(),
	archivedAt: timestamp("archived_at", { withTimezone: true }),
}, (table) => [
	unique("ledger_account_id_ccy_uk").on(table.id, table.currency, table.type),	unique("ledger_account_ws_id_uk").on(table.workspaceId, table.id),
	pgPolicy("ws_isolation", { using: sql`(workspace_id = platform.current_workspace_id())`, withCheck: sql`(workspace_id = platform.current_workspace_id())` }),
check("ledger_account_system_kind_check", sql`(system_kind = ANY (ARRAY['INCOME'::text, 'EXPENSE'::text, 'OPENING_BALANCE'::text, 'FX_TRADING'::text, 'ADJUSTMENTS'::text]))`),check("ledger_account_type_check", sql`(type = ANY (ARRAY['ASSET'::text, 'LIABILITY'::text, 'EQUITY'::text, 'INCOME'::text, 'EXPENSE'::text]))`),check("ledger_account_user_ck", sql`((type = ANY (ARRAY['ASSET'::text, 'LIABILITY'::text])) = (source_account_id IS NOT NULL))`),]);

export const postingInLedger = ledger.table.withRLS("posting", {
	id: uuid().primaryKey(),
	workspaceId: uuid("workspace_id").notNull(),
	journalEntryId: uuid("journal_entry_id").notNull(),
	entryDate: date("entry_date").notNull(),
	lineNo: smallint("line_no").notNull(),
	ledgerAccountId: uuid("ledger_account_id").notNull(),
	accountType: text("account_type").notNull(),
	currency: varchar({ length: 16 }).notNull().references(() => currencyInFx.code),
	amount: numeric({ precision: 38, scale: 18 }).notNull(),
	splitId: uuid("split_id"),
	memo: text(),
	createdAt: timestamp("created_at", { withTimezone: true }).default(sql`now()`).notNull(),
}, (table) => [
	foreignKey({
		columns: [table.ledgerAccountId, table.currency, table.accountType],
		foreignColumns: [ledgerAccountInLedger.id, ledgerAccountInLedger.currency, ledgerAccountInLedger.type],
		name: "posting_account_ccy_fk"
	}),
	foreignKey({
		columns: [table.workspaceId, table.ledgerAccountId],
		foreignColumns: [ledgerAccountInLedger.workspaceId, ledgerAccountInLedger.id],
		name: "posting_account_ws_fk"
	}),
	foreignKey({
		columns: [table.journalEntryId, table.entryDate],
		foreignColumns: [journalEntryInLedger.id, journalEntryInLedger.entryDate],
		name: "posting_entry_date_fk"
	}),
	foreignKey({
		columns: [table.workspaceId, table.journalEntryId],
		foreignColumns: [journalEntryInLedger.workspaceId, journalEntryInLedger.id],
		name: "posting_entry_fk"
	}),
	index("posting_balance_ix").using("btree", table.workspaceId.asc().nullsLast(), table.ledgerAccountId.asc().nullsLast(), table.entryDate.asc().nullsLast(), table.id.asc().nullsLast()),
	unique("posting_line_uk").on(table.journalEntryId, table.lineNo),
	pgPolicy("ws_isolation", { using: sql`(workspace_id = platform.current_workspace_id())`, withCheck: sql`(workspace_id = platform.current_workspace_id())` }),
check("posting_amount_check", sql`(amount <> (0)::numeric)`),check("posting_nominal_split_ck", sql`((account_type <> ALL (ARRAY['INCOME'::text, 'EXPENSE'::text])) OR (split_id IS NOT NULL))`),]);
