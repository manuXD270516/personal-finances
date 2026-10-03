import type { AccountOpeningBalancePort } from '@pf/accounts/contracts';
import type { LedgerPostingPort } from '@pf/ledger/contracts';

const negate = (amount: string): string => (amount.startsWith('-') ? amount.slice(1) : `-${amount}`);

/**
 * Orquestación de la apertura con saldo inicial (ARCHITECTURE §7, docs/06 §3.1; openspec add-accounts-management
 * tarea 6.1) en el composition root: ACCOUNTS la invoca DENTRO de la unidad de trabajo de `OpenAccount` (misma
 * transacción PG + RLS + idempotencia), y aquí se postea el asiento `OPENING` contra `EQUITY:OPENING_BALANCE:<CCY>`
 * con get-or-create del ledger account de la cuenta y del de sistema. Si el ledger rechaza el asiento (escala,
 * periodo, moneda), el error aborta la transacción completa: ni cuenta, ni asiento, ni auditoría, ni outbox.
 *
 * Signo (docs/09 §6.7): el monto llega como saldo PRESENTADO; para pasivos (positivo = adeudado) el posting en la
 * cuenta es negativo (crédito) y la contrapartida de patrimonio, positiva.
 *
 * Hasta `add-transaction-recording` no existe la transacción `OPENING_BALANCE`: el origen del asiento es
 * `Transaction/<accountId>/1` (determinista ⇒ un reintento nunca duplica el asiento, FR-LEDGER-010). Cuando exista
 * Transactions, este adaptador delegará en `RecordOpeningBalance` (design.md §Implementación).
 */
export class OpenAccountWithOpeningBalance implements AccountOpeningBalancePort {
  constructor(private readonly ledger: LedgerPostingPort) {}

  async recordOpeningBalance(input: Parameters<AccountOpeningBalancePort['recordOpeningBalance']>[0]) {
    const { amount, currency } = input.amount;
    const signed = input.nature === 'LIABILITY' ? negate(amount) : amount;
    const posted = await this.ledger.postJournalEntry({
      workspaceId: input.workspaceId,
      entryDate: input.date,
      entryType: 'OPENING',
      sourceRef: { type: 'Transaction', id: input.accountId, revision: 1 },
      memo: 'Saldo inicial',
      postings: [
        {
          target: { kind: 'USER_ACCOUNT', accountId: input.accountId, nature: input.nature },
          amount: { amount: signed, currency },
        },
        {
          target: { kind: 'SYSTEM', systemKind: 'OPENING_BALANCE' },
          amount: { amount: negate(signed), currency },
        },
      ],
    });
    return { journalEntryId: posted.journalEntryId };
  }
}
