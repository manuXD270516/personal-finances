import type { CreditCard } from '../domain/index.js';
import { CardEngine } from './card-engine.js';
import type { CardDeps } from './card-ports.js';
import { InstallmentsService } from './installments.service.js';

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (typeof v === 'object' && v !== null ? (v as Json) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const text = (v: unknown): string | null => (typeof v === 'string' ? v : null);

export interface CardActivityEvent {
  readonly workspaceId: string;
  readonly eventType: string;
  readonly eventId: string;
  readonly payload: unknown;
}

/**
 * Consumidor `debt.card-activity` (openspec add-credit-cards, decisión 14): ante movimientos de las cuentas de
 * tarjeta (`ledger.JournalEntryPosted`, `transactions.TransactionCreated/Updated/Voided`) recalcula el monto esperado
 * del plan de pago, la utilización y los umbrales (con `FOR UPDATE` de la tarjeta: los consumidores concurrentes se
 * serializan) y cancela el plan de cuotas de una compra anulada o corregida. La idempotencia (inbox) la da el runtime
 * de eventos; aquí solo se filtra en memoria por las cuentas de tarjeta activas.
 */
export class CardActivityService {
  private readonly engine: CardEngine;
  private readonly installments: InstallmentsService;

  constructor(private readonly deps: CardDeps) {
    this.engine = new CardEngine(deps);
    this.installments = new InstallmentsService(deps);
  }

  /** Cuentas de usuario tocadas por el evento (para los hechos que no las traen se consulta la transacción). */
  private async accountsOf(event: CardActivityEvent): Promise<string[]> {
    const p = obj(event.payload);
    const ids = new Set<string>();
    if (event.eventType === 'ledger.JournalEntryPosted') {
      for (const posting of arr(p['postings'])) {
        const id = text(obj(posting)['accountId']);
        if (id) ids.add(id);
      }
    } else if (arr(p['legs']).length > 0) {
      for (const leg of arr(p['legs'])) {
        const id = text(obj(leg)['accountId']);
        if (id) ids.add(id);
      }
    } else {
      const transactionId = text(p['transactionId']);
      if (transactionId) {
        const txn = await this.deps.links.getManyForLink({
          workspaceId: event.workspaceId,
          transactionIds: [transactionId],
        });
        for (const t of txn) {
          ids.add(t.accountId);
          if (t.toAccountId) ids.add(t.toAccountId);
        }
      }
    }
    return [...ids];
  }

  async onEvent(event: CardActivityEvent): Promise<void> {
    const { deps } = this;
    const { workspaceId } = event;
    await deps.uow.run(workspaceId, async () => {
      const p = obj(event.payload);
      const index = await deps.cards.activeAccountIndex(workspaceId);
      if (index.size === 0) return;
      const cardIds = new Set<string>();
      for (const accountId of await this.accountsOf(event)) {
        const cardId = index.get(accountId);
        if (cardId) cardIds.add(cardId);
      }
      // Compra con plan de cuotas anulada o corregida con otro monto.
      const transactionId = text(p['transactionId']);
      let cancelReason: 'PURCHASE_VOIDED' | 'PURCHASE_REVISED' | null = null;
      if (event.eventType === 'transactions.TransactionVoided') cancelReason = 'PURCHASE_VOIDED';
      else if (
        event.eventType === 'transactions.TransactionUpdated' &&
        arr(p['changedFields']).some((f) => f === 'amount' || f === 'accountId')
      ) {
        cancelReason = 'PURCHASE_REVISED';
      }
      let planCard: string | null = null;
      if (cancelReason && transactionId) {
        const plan = await deps.plans.findByPurchase(workspaceId, transactionId);
        if (plan) planCard = await deps.cards.cardIdOfCardAccount(workspaceId, plan.snapshot.cardAccountId);
        if (planCard) cardIds.add(planCard);
      }
      for (const cardId of cardIds) {
        const card = await deps.cards.findById(workspaceId, cardId, { lock: 'update' });
        if (!card || card.status !== 'ACTIVE') continue;
        const clock = await this.engine.clockOf(workspaceId);
        if (cancelReason && transactionId && planCard === cardId) {
          const plan = await deps.plans.findByPurchase(workspaceId, transactionId);
          if (plan) await this.installments.cancelPlan(plan, cancelReason, clock.at, workspaceId);
        }
        await this.sync(card, clock);
      }
    });
  }

  private async sync(card: CreditCard, clock: Awaited<ReturnType<CardEngine['clockOf']>>): Promise<void> {
    const before = card.version;
    const views = await this.engine.loadViews(card, clock);
    await this.engine.evaluateUtilization(card, views, clock);
    for (const v of views) await this.engine.syncPlan(card, v, clock, card.snapshot.createdBy);
    if (card.version !== before) {
      if (!(await this.deps.cards.save(card, card.snapshot.createdBy))) {
        throw new Error(`credit card ${card.id} changed concurrently`);
      }
      card.markPersisted();
    }
  }
}
