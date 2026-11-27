'use client';

import { useState, type FormEvent } from 'react';
import type { ApiProblemBody } from '../../bff/finance-api-client';
import { ProblemMessage } from '../../errors/ProblemMessage';
import type { Transaction } from '../common/types';
import { Field, formStyle, inputStyle, mutedStyle, rowStyle } from '../common/ui';
import { problemOf, useFormat, type WorkspaceContext } from '../common/workspace';
import { formatLocalDate, formatMoney } from '../dashboard/format';
import type { Catalogs } from './catalogs';
import { CounterpartyPicker } from './CounterpartyPicker';

/**
 * Edición descriptiva de una transacción que administra otro contexto (openspec fix-phase-4-debt-followups, decisión 1):
 *  - pagos y desembolsos de préstamo (`LOAN_*`): solo descripción y notas;
 *  - cargos de tarjeta (`debtRole = CARD_CHARGE`): descripción, notas y contraparte editables; monto, cuenta, fecha, moneda
 *    y categoría de las porciones se muestran de solo lectura con el aviso de que los administra la tarjeta.
 * Manda `PATCH` con `If-Match` y únicamente los campos descriptivos que cambiaron; el servidor sigue rechazando los demás
 * con `TRANSACTION_MANAGED_EXTERNALLY`.
 */
export function ManagedEditForm({
  ctx,
  tx,
  catalogs,
  cardName,
  onCancel,
  onSaved,
}: {
  ctx: WorkspaceContext;
  tx: Transaction;
  catalogs: Catalogs;
  /** Nombre de la tarjeta que administra el cargo (si se conoce). */
  cardName?: string | undefined;
  onCancel: () => void;
  onSaved: (next: Transaction) => void;
}) {
  const f = useFormat('Transactions', ctx);
  const { t, locale } = f;
  const card = tx.debtRole === 'CARD_CHARGE';
  const [description, setDescription] = useState(tx.description ?? '');
  const [notes, setNotes] = useState(tx.notes ?? '');
  const [counterpartyId, setCounterpartyId] = useState(tx.counterpartyId ?? '');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<ApiProblemBody | undefined>();

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const patch: Record<string, unknown> = {};
    if ((description.trim() || null) !== (tx.description ?? null))
      patch['description'] = description.trim() || null;
    if ((notes.trim() || null) !== (tx.notes ?? null)) patch['notes'] = notes.trim() || null;
    if (card && (counterpartyId || null) !== (tx.counterpartyId ?? null))
      patch['counterpartyId'] = counterpartyId || null;
    if (Object.keys(patch).length === 0) {
      onCancel();
      return;
    }
    setBusy(true);
    setProblem(undefined);
    try {
      const r = await ctx.api.command<Transaction>('PATCH', `${ctx.base}/transactions/${tx.id}`, patch, {
        ifMatch: tx.version,
      });
      onSaved(r.data!);
    } catch (err) {
      setProblem(problemOf(err));
    } finally {
      setBusy(false);
    }
  }

  const account = tx.legs.find((l) => l.role === 'MAIN') ?? tx.legs[0];
  return (
    <form onSubmit={(e) => void submit(e)} style={formStyle} data-testid="managed-edit-form" noValidate>
      <h2 style={{ fontSize: '1rem', marginTop: 0 }}>{t('managedEdit.title')}</h2>
      {card ? (
        <>
          <p style={mutedStyle} data-testid="managed-edit-notice">
            {cardName ? t('managedEdit.cardManagedNamed', { name: cardName }) : t('managedEdit.cardManaged')}
          </p>
          {tx.debtCardId ? (
            <p style={{ margin: 0 }}>
              <a href={ctx.href(`/debts/tarjetas/${tx.debtCardId}`)} data-testid="managed-edit-card-link">
                {t('managedEdit.viewCard')}
              </a>
            </p>
          ) : null}
          <dl data-testid="managed-edit-readonly" style={{ margin: 0 }}>
            <dt>{t('detail.amount')}</dt>
            <dd>{formatMoney(tx.amount, locale)}</dd>
            <dt>{t('managedEdit.account')}</dt>
            <dd>{account ? catalogs.names.account(account.accountId) : ''}</dd>
            <dt>{t('detail.date')}</dt>
            <dd>{formatLocalDate(tx.transactionDate, locale)}</dd>
            <dt>{t('managedEdit.currency')}</dt>
            <dd>{tx.amount.currency}</dd>
            <dt>{t('managedEdit.categories')}</dt>
            <dd>{tx.splits.map((s) => catalogs.names.category(s.categoryId)).join(', ')}</dd>
          </dl>
        </>
      ) : (
        <p style={mutedStyle} data-testid="managed-edit-notice">
          {t('managedEdit.loanManaged')}
        </p>
      )}
      <Field label={t('form.description')}>
        {(p) => (
          <input
            {...p}
            name="description"
            maxLength={500}
            style={inputStyle}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        )}
      </Field>
      <Field label={t('form.notes')}>
        {(p) => (
          <input
            {...p}
            name="notes"
            maxLength={4000}
            style={inputStyle}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        )}
      </Field>
      {card ? (
        <CounterpartyPicker
          ctx={ctx}
          f={f}
          counterparties={catalogs.counterparties}
          value={counterpartyId}
          onChange={setCounterpartyId}
          onCreated={catalogs.addCounterparty}
        />
      ) : null}
      <div style={rowStyle}>
        <button type="submit" disabled={busy}>
          {busy ? t('form.saving') : t('form.save')}
        </button>
        <button type="button" onClick={onCancel} disabled={busy}>
          {t('form.cancel')}
        </button>
      </div>
      {problem ? <ProblemMessage problem={problem} locale={ctx.uiLocale} /> : null}
    </form>
  );
}
