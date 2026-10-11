import { DomainError, Money, currency as makeCurrency, type Currency } from '@pf/shared-kernel';
import {
  isTransferLike,
  type TemplateInput,
  type ScheduleInput,
  type MaterializationInput,
  type RecurringKind,
} from '../domain/index.js';
import type { CommitmentsDeps } from './ports/index.js';
import type { MoneyDto } from '../contracts/index.js';

/** Monto de la plantilla tal como llega por la API (`RecurringAmount` con `Money`). */
export interface AmountInput {
  readonly type: string;
  readonly amount?: MoneyDto | null | undefined;
  readonly min?: MoneyDto | null | undefined;
  readonly max?: MoneyDto | null | undefined;
  /**
   * Precio indexado (solo definiciones administradas, openspec add-subscriptions N3): precio en OTRA moneda que la de
   * la cuenta. El motor estima cada ocurrencia con la tasa de valoración vigente al generarla.
   */
  readonly indexedTo?: MoneyDto | null | undefined;
}

/** Plantilla tal como llega por la API (creación y cambios de una revisión). */
export interface ApiTemplate {
  readonly accountId: string;
  readonly toAccountId?: string | null | undefined;
  readonly amount: AmountInput;
  readonly categoryId?: string | null | undefined;
  readonly counterpartyId?: string | null | undefined;
  readonly tagIds?: readonly string[] | undefined;
  readonly paymentMethod?: string | null | undefined;
  readonly schedule: ScheduleInput;
  readonly materialization?: MaterializationInput | undefined;
}

export interface ResolvedTemplate {
  readonly template: TemplateInput;
  readonly currency: Currency;
}

/** Moneda de la cuenta (con su escala canónica del catálogo de FX) o `CURRENCY_NOT_ENABLED`. */
async function currencyOf(deps: CommitmentsDeps, workspaceId: string, code: string): Promise<Currency> {
  const catalog = await deps.rates.workspaceCurrencies(workspaceId);
  const found = catalog.find((c) => c.code === code);
  if (!found) throw new DomainError('CURRENCY_NOT_ENABLED', `currency ${code} is not in the catalog`);
  return makeCurrency(found.code, found.scale);
}

/**
 * Valida contra los contextos dueños (cuentas utilizables y de la misma moneda que el monto, transferencia de una sola
 * moneda, categoría/contraparte/tags activos y del tipo correcto) y devuelve la plantilla de dominio con montos como
 * texto a la escala de la moneda. Toda definición debe poder materializarse (FR-COMMITMENTS-001).
 */
export async function resolveTemplate(
  deps: CommitmentsDeps,
  input: {
    readonly workspaceId: string;
    readonly userId: string;
    readonly kind: RecurringKind;
    readonly template: ApiTemplate;
  },
): Promise<ResolvedTemplate> {
  const { workspaceId, kind, template } = input;
  const indexedTo = template.amount.indexedTo ?? null;
  if (indexedTo !== null && template.amount.type !== 'ESTIMATED') {
    throw new DomainError('RECURRING_INVALID_AMOUNT', 'an indexed amount is always ESTIMATED').at(
      '/amount/type',
    );
  }
  const amountMoney = [template.amount.amount, template.amount.min, template.amount.max].filter(
    (m): m is MoneyDto => m !== null && m !== undefined,
  );
  const declared = new Set(amountMoney.map((m) => m.currency));
  if (declared.size > 1) {
    throw new DomainError('CURRENCY_MISMATCH', 'all amounts of the template must share one currency').at(
      '/amount',
    );
  }
  const amountCurrency = indexedTo !== null ? undefined : amountMoney[0]?.currency;

  const accounts = [
    { accountId: template.accountId, ...(amountCurrency ? { currency: amountCurrency } : {}) },
    ...(isTransferLike(kind) && template.toAccountId ? [{ accountId: template.toAccountId }] : []),
  ];
  let eligibility;
  try {
    eligibility = await deps.accounts.assertCanPost({ workspaceId, accounts });
  } catch (err) {
    if (err instanceof DomainError && err.violations.length === 0) {
      throw err.at(err.code === 'CURRENCY_MISMATCH' ? '/amount' : '/accountId');
    }
    throw err;
  }
  const from = eligibility.find((e) => e.accountId === template.accountId);
  if (!from) throw new DomainError('REFERENCE_NOT_FOUND', 'account not found').at('/accountId');
  if (isTransferLike(kind) && template.toAccountId) {
    const to = eligibility.find((e) => e.accountId === template.toAccountId);
    if (!to) throw new DomainError('REFERENCE_NOT_FOUND', 'destination account not found').at('/toAccountId');
    if (kind === 'CARD_PAYMENT') {
      // Pago de tarjeta: de una cuenta de activo a la cuenta de pasivo de la tarjeta.
      if (from.nature !== 'ASSET') {
        throw new DomainError('VALIDATION_FAILED', 'the payment account must be an asset account').at(
          '/accountId',
        );
      }
      if (to.nature !== 'LIABILITY') {
        throw new DomainError('VALIDATION_FAILED', 'the card account must be a liability account').at(
          '/toAccountId',
        );
      }
    }
    if (to.currency !== from.currency) {
      throw new DomainError(
        'TRANSFER_CURRENCY_MISMATCH',
        `a recurring transfer uses one currency: ${from.currency} vs ${to.currency}`,
      ).at('/toAccountId');
    }
  }
  const currency = await currencyOf(deps, workspaceId, from.currency);
  let indexedPrice: { amount: string; currency: string } | null = null;
  if (indexedTo !== null) {
    if (amountMoney.length > 0) {
      throw new DomainError('RECURRING_INVALID_AMOUNT', 'an indexed amount takes no amount of its own').at(
        '/amount',
      );
    }
    const priceCurrency = await currencyOf(deps, workspaceId, indexedTo.currency);
    let price: Money;
    try {
      price = Money.parse(indexedTo.amount, priceCurrency);
    } catch (err) {
      if (err instanceof DomainError)
        throw new DomainError(err.code, err.message).at('/amount/indexedTo/amount');
      throw err;
    }
    if (!price.isPositive()) {
      throw new DomainError('AMOUNT_NOT_POSITIVE', 'the indexed price must be positive').at(
        '/amount/indexedTo/amount',
      );
    }
    indexedPrice = { amount: price.toFixed(), currency: priceCurrency.code };
  }

  if (!isTransferLike(kind) && (template.categoryId || (template.tagIds?.length ?? 0) > 0)) {
    await deps.classification.validate({
      userId: input.userId,
      workspaceId,
      ...(template.categoryId
        ? {
            categoryIds: [
              { categoryId: template.categoryId, splitKind: kind === 'INCOME' ? 'INCOME' : 'EXPENSE' },
            ],
          }
        : {}),
      ...(template.tagIds && template.tagIds.length > 0 ? { tagIds: template.tagIds } : {}),
    });
  }
  if (template.counterpartyId) {
    await deps.classification.validate({
      userId: input.userId,
      workspaceId,
      counterpartyId: template.counterpartyId,
    });
  }

  return {
    currency,
    template: {
      accountId: template.accountId,
      toAccountId: template.toAccountId ?? null,
      amount:
        indexedPrice !== null
          ? { type: 'VARIABLE', amount: null, min: null, max: null }
          : {
              type: template.amount.type,
              amount: template.amount.amount?.amount ?? null,
              min: template.amount.min?.amount ?? null,
              max: template.amount.max?.amount ?? null,
            },
      categoryId: template.categoryId ?? null,
      counterpartyId: template.counterpartyId ?? null,
      tagIds: template.tagIds ?? [],
      paymentMethod: template.paymentMethod ?? null,
      schedule: template.schedule,
      ...(template.materialization ? { materialization: template.materialization } : {}),
      ...(indexedPrice !== null ? { indexedPrice } : {}),
    },
  };
}
