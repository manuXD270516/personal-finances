import { Instant } from '@pf/shared-kernel';
import type { financeRuntimes } from '../identity/identity-wiring.js';
import {
  toDecimal,
  type CategoryRef,
  type DemoMoney,
  type PlanKeys,
  type PlanOp,
} from './dataset/demo-plan.js';

export const noon = (date: string): Instant => Instant.parse(`${date}T16:00:00.000Z`);
const dto = (m: DemoMoney) => ({ amount: toDecimal(m), currency: m.currency });

export class PlanLoadError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'PlanLoadError';
  }
}

export interface PlanOpContext<K extends PlanKeys> {
  readonly r: ReturnType<typeof financeRuntimes>;
  readonly ws: string;
  readonly user: string;
  readonly account: (key: K['account']) => string;
  readonly category: (ref: CategoryRef) => string;
  readonly counterparties: ReadonlyMap<string, string>;
  readonly tags: ReadonlyMap<string, string>;
  /** Transacciones registradas por clave del plan (id + versión vigente), para reembolsos, ediciones y anulaciones. */
  readonly recorded: Map<string, { id: string; version: number }>;
  /** Proveedor declarado de una conversión (por defecto, el de la demo). */
  readonly conversionProvider?: (op: Extract<PlanOp<K>, { op: 'conversion' }>) => string;
}

/**
 * Ejecuta UNA operación de un plan determinista (dataset Demo o `large`, docs/29) con los MISMOS casos de uso públicos
 * que la API (FX, Transactions). El llamador posiciona el reloj simulado en la fecha de la operación y abre la unidad
 * de trabajo del workspace.
 */
export async function applyPlanOp<K extends PlanKeys>(op: PlanOp<K>, ctx: PlanOpContext<K>): Promise<void> {
  const { r, ws, user, account, category, counterparties, tags, recorded } = ctx;
  const ref = (key: string) => {
    const found = recorded.get(key);
    if (!found) throw new PlanLoadError('DEMO_LOAD_FAILED', `unknown demo transaction ${key}`);
    return found;
  };
  const tx = r.transactions.service;
  switch (op.op) {
    case 'rate':
      await r.fx.service.recordManualRate({
        workspaceId: ws,
        userId: user,
        base: op.base,
        quote: op.quote,
        value: op.value,
        rateType: op.rateType,
        asOf: noon(op.date).toString(),
        sourceLabel: 'Demo',
      });
      return;
    case 'income':
    case 'expense': {
      const { transaction } = await tx.recordTransaction({
        workspaceId: ws,
        userId: user,
        kind: op.op === 'income' ? 'INCOME' : 'EXPENSE',
        status: op.pending ? 'PENDING' : 'POSTED',
        transactionDate: op.date,
        accountId: account(op.account),
        amount: dto(op.amount),
        description: op.description,
        counterpartyId: op.counterparty ? (counterparties.get(op.counterparty) ?? null) : null,
        paymentMethod: op.paymentMethod,
        source: 'SYSTEM',
        splits: op.splits.map((s) => ({
          amount: dto(s.amount),
          categoryId: category(s.category),
          ...(s.tag ? { tagIds: [tags.get(s.tag) as string] } : {}),
        })),
      });
      recorded.set(op.key, { id: transaction.id, version: transaction.version });
      return;
    }
    case 'refund': {
      const { transaction } = await tx.recordTransaction({
        workspaceId: ws,
        userId: user,
        kind: 'REFUND',
        transactionDate: op.date,
        accountId: account(op.account),
        amount: dto(op.amount),
        description: op.description,
        paymentMethod: 'CREDIT_CARD',
        source: 'SYSTEM',
        refundOfTransactionId: ref(op.of).id,
      });
      recorded.set(op.key, { id: transaction.id, version: transaction.version });
      return;
    }
    case 'adjustment':
      await tx.recordTransaction({
        workspaceId: ws,
        userId: user,
        kind: 'ADJUSTMENT',
        transactionDate: op.date,
        accountId: account(op.account),
        amount: dto(op.amount),
        direction: op.direction,
        reason: op.reason,
        description: op.reason,
        source: 'SYSTEM',
      });
      return;
    case 'transfer':
      await tx.recordTransfer({
        workspaceId: ws,
        userId: user,
        transactionDate: op.date,
        fromAccountId: account(op.from),
        toAccountId: account(op.to),
        amount: dto(op.amount),
        description: op.description,
        paymentMethod: op.paymentMethod,
        source: 'SYSTEM',
      });
      return;
    case 'conversion':
      await r.transactions.conversions.recordConversion({
        workspaceId: ws,
        userId: user,
        transactionDate: op.date,
        sourceAccountId: account(op.from),
        targetAccountId: account(op.to),
        sourceAmount: dto(op.source),
        targetAmount: dto(op.target),
        quotedRate: op.quoted,
        fees: op.fee
          ? [{ type: op.fee.type, amount: dto(op.fee.amount), categoryId: category({ system: 'FX_FEES' }) }]
          : [],
        provider: {
          name: ctx.conversionProvider
            ? ctx.conversionProvider(op)
            : op.from === 'usdt' || op.to === 'usdt'
              ? 'P2P Exchange Demo'
              : 'Banco Andino Demo',
        },
        executedAt: noon(op.date).toString(),
        description: op.description,
      });
      return;
    case 'edit': {
      const target = ref(op.of);
      const updated = await tx.updateTransaction({
        workspaceId: ws,
        userId: user,
        transactionId: target.id,
        expectedVersion: target.version,
        amount: dto(op.amount),
        splits: [{ amount: dto(op.amount), categoryId: category(op.category) }],
      });
      recorded.set(op.of, { id: updated.id, version: updated.version });
      return;
    }
    case 'void': {
      const target = ref(op.of);
      await tx.voidTransaction(ws, target.id, target.version, op.reason);
      recorded.delete(op.of);
      return;
    }
  }
}
