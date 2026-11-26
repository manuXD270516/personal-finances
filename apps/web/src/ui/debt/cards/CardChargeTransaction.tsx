'use client';

import { useEffect, useState } from 'react';
import { problemMessage } from '../../../errors/error-messages';
import type { Transaction } from '../../common/types';
import { cardStyle, mutedStyle } from '../../common/ui';
import { useFormat, type WorkspaceContext } from '../../common/workspace';
import type { FormatContext } from '../../dashboard/types';
import { ChargeFormPanel } from './CardCharges';
import { emptyChargeForm } from './charges-logic';
import { cardPath } from './logic';
import type { CreditCard } from './types';
import { useCardOfAccount } from './useCardLookup';

/** Cuenta de usuario (pata `MAIN`) de un gasto. */
const accountOf = (tx: Pick<Transaction, 'legs'>): string | undefined => tx.legs[0]?.accountId;

/** Distintivo «Cargo de la tarjeta» del listado (presentacional). */
export function CardChargeBadge({ label }: { label: string }) {
  return (
    <span
      data-testid="tx-card-charge-badge"
      style={{
        border: '1px solid var(--pf-border)',
        borderRadius: 'var(--pf-radius-sm)',
        padding: '0 var(--pf-space-2)',
        fontSize: 'var(--pf-text-sm)',
      }}
    >
      {label}
    </span>
  );
}

/** Detalle de un cargo de la tarjeta (presentacional): la tarjeta que lo administra y por qué no se edita ni se anula. */
export function CardChargeView({
  f,
  cardName,
  cardId,
  href,
  managedMessage,
}: {
  f: FormatContext;
  cardName: string | undefined;
  cardId: string | null | undefined;
  href: (path: string) => string;
  managedMessage: string;
}) {
  return (
    <section aria-labelledby="tx-card-charge-title" style={cardStyle} data-testid="tx-card-charge">
      <h2 id="tx-card-charge-title" style={{ fontSize: '1rem', marginTop: 0 }}>
        {f.t('transaction.badge')}
      </h2>
      {cardId ? (
        <p style={{ margin: 0 }}>
          <a href={href(`/debts/tarjetas/${cardId}`)} data-testid="tx-card-charge-link">
            {cardName ?? f.t('transaction.viewCard')}
          </a>
        </p>
      ) : null}
      <p style={mutedStyle} data-testid="tx-card-charge-managed">
        {managedMessage}
      </p>
    </section>
  );
}

/** Para el detalle de transacciones: la tarjeta que administra el cargo. */
export function CardChargeInfo({ ctx, tx }: { ctx: WorkspaceContext; tx: Transaction }) {
  const f = useFormat('Cards', ctx);
  const [name, setName] = useState<string | undefined>();
  useEffect(() => {
    if (!tx.debtCardId) return;
    let cancelled = false;
    ctx.api
      .get<CreditCard>(cardPath(ctx.base, tx.debtCardId))
      .then((r) => {
        if (!cancelled) setName(r.data?.name);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [ctx.api, ctx.base, tx.debtCardId]);
  return (
    <CardChargeView
      f={f}
      cardName={name}
      cardId={tx.debtCardId}
      href={ctx.href}
      managedMessage={problemMessage({ code: 'TRANSACTION_MANAGED_EXTERNALLY' }, ctx.uiLocale)}
    />
  );
}

/**
 * Acción «Es un cargo de la tarjeta» (tarea 6.2): un gasto posteado de una cuenta de tarjeta se declara cargo repartiéndolo
 * en componentes (suman su monto); no crea otra transacción ni cambia el saldo. Solo EDITOR/OWNER.
 */
export function CardChargeAdoption({
  ctx,
  tx,
  onAdopted,
}: {
  ctx: WorkspaceContext;
  tx: Transaction;
  onAdopted: (message: string) => void;
}) {
  const f = useFormat('Cards', ctx);
  const accountId = accountOf(tx);
  const eligible =
    ctx.canEdit &&
    tx.kind === 'EXPENSE' &&
    (tx.status === 'POSTED' || tx.status === 'CLEARED') &&
    (tx.debtRole === undefined || tx.debtRole === null) &&
    tx.source !== 'DEBT' &&
    tx.source !== 'GOAL';
  const card = useCardOfAccount(ctx.api, ctx.base, eligible ? accountId : undefined);
  const [open, setOpen] = useState(false);
  if (!eligible || !accountId || !card) return null;
  return (
    <section aria-label={f.t('charges.adopt.title')} style={cardStyle} data-testid="tx-card-charge-adopt">
      {open ? (
        <ChargeFormPanel
          ctx={ctx}
          f={f}
          card={card}
          accountId={accountId}
          currency={tx.amount.currency}
          initial={emptyChargeForm(tx.transactionDate, tx.amount.amount)}
          adoptTransactionId={tx.id}
          testId="adopt-form"
          onCancel={() => setOpen(false)}
          onDone={() => {
            setOpen(false);
            onAdopted(f.t('charges.adopt.done'));
          }}
        />
      ) : (
        <>
          <p style={{ ...mutedStyle, marginTop: 0 }}>{f.t('charges.adopt.prompt', { card: card.name })}</p>
          <button type="button" onClick={() => setOpen(true)} data-testid="adopt-open">
            {f.t('charges.adopt.action')}
          </button>
        </>
      )}
    </section>
  );
}
