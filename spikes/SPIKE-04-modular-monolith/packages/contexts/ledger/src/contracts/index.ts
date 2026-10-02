/**
 * API pública del contexto Ledger. Es lo ÚNICO que otros contextos pueden importar
 * (package.json#exports + dependency-cruiser). Solo tipos/DTOs/tokens: sin Nest, sin clases de dominio.
 */
export interface PostJournalEntryCommand {
  readonly description: string;
  readonly lines: ReadonlyArray<{
    readonly ledgerAccountRef: string;
    /** Unidades menores serializadas como string (nunca number). */
    readonly amountMinor: string;
    readonly currency: string;
  }>;
}

export interface JournalEntryDto {
  readonly id: string;
  readonly description: string;
  readonly lines: PostJournalEntryCommand['lines'];
}

/** Application service público. Participa en la Unit of Work activa del llamador. */
export interface LedgerPostingApi {
  postJournalEntry(cmd: PostJournalEntryCommand): Promise<{ journalEntryId: string }>;
}

export interface LedgerQueryApi {
  listJournalEntries(): Promise<JournalEntryDto[]>;
}

export const LEDGER_POSTING_API = Symbol.for('pf.ledger.LedgerPostingApi');
export const LEDGER_QUERY_API = Symbol.for('pf.ledger.LedgerQueryApi');
