import { DomainError, LocalDate, type Money } from '@pf/shared-kernel';

/** Origen de una entrada del historial de precios (openspec add-subscriptions, decisión 6). */
export const PRICE_ORIGINS = ['INITIAL', 'MANUAL', 'PROPOSAL', 'CORRECTION'] as const;
export type PriceOrigin = (typeof PRICE_ORIGINS)[number];

/** Entrada inmutable del historial: monto, moneda y vigencia (`effectiveFrom`). Nunca se edita ni se borra. */
export interface PriceEntry {
  readonly id: string;
  readonly effectiveFrom: string;
  readonly price: Money;
  readonly origin: PriceOrigin;
  /** Entrada que esta corrige (solo `CORRECTION`); la corregida deja de contar. */
  readonly supersedesId: string | null;
  /** Propuesta aceptada que originó la entrada (solo `PROPOSAL`). */
  readonly proposalId: string | null;
}

const notChronological = (detail: string) =>
  new DomainError('SUBSCRIPTION_PRICE_NOT_CHRONOLOGICAL', detail).at('/effectiveFrom');

const validDate = (value: string): string => LocalDate.parse(value).toString();

function assertPositive(price: Money): void {
  if (!price.isPositive())
    throw new DomainError('AMOUNT_NOT_POSITIVE', 'the price must be positive').at('/price');
}

/**
 * Historial de precios append-only (FR-COMMITMENTS-013; design decisión 6). Valor inmutable: cada operación devuelve
 * el historial nuevo y la entrada agregada. Una entrada reemplazada es la que otra referencia con `supersedesId`
 * (a lo sumo un reemplazo por entrada). El precio vigente en una fecha `d` es el de la entrada NO reemplazada con la
 * mayor `effectiveFrom ≤ d`. Una entrada nueva no correctiva exige `effectiveFrom` posterior a la última no
 * reemplazada, lo que garantiza orden y ausencia de solapes sin intervalos explícitos.
 */
export class PriceHistory {
  private constructor(private readonly all: readonly PriceEntry[]) {}

  static of(entries: readonly PriceEntry[]): PriceHistory {
    return new PriceHistory([...entries]);
  }

  /** Historial con su primera entrada (alta de la suscripción, vigente desde la primera renovación). */
  static initial(input: { readonly id: string; readonly effectiveFrom: string; readonly price: Money }): {
    readonly history: PriceHistory;
    readonly entry: PriceEntry;
  } {
    assertPositive(input.price);
    const entry: PriceEntry = {
      id: input.id,
      effectiveFrom: validDate(input.effectiveFrom),
      price: input.price,
      origin: 'INITIAL',
      supersedesId: null,
      proposalId: null,
    };
    return { history: new PriceHistory([entry]), entry };
  }

  /** Todas las entradas, incluidas las reemplazadas, en orden de alta. */
  get entries(): readonly PriceEntry[] {
    return this.all;
  }

  get currencyCode(): string | null {
    return this.all[0]?.price.currency.code ?? null;
  }

  isSuperseded(id: string): boolean {
    return this.all.some((e) => e.supersedesId === id);
  }

  /** Entradas que cuentan (no reemplazadas), por vigencia ascendente. */
  get active(): readonly PriceEntry[] {
    return this.all
      .filter((e) => !this.isSuperseded(e.id))
      .sort((a, b) => (a.effectiveFrom === b.effectiveFrom ? 0 : a.effectiveFrom < b.effectiveFrom ? -1 : 1));
  }

  /** Última entrada no reemplazada por vigencia (el precio que rige hacia adelante). */
  get latest(): PriceEntry | null {
    return this.active.at(-1) ?? null;
  }

  /** Precio vigente en `date`; `null` si la fecha es anterior a la primera vigencia. */
  at(date: string): PriceEntry | null {
    let found: PriceEntry | null = null;
    for (const entry of this.active) if (entry.effectiveFrom <= date) found = entry;
    return found;
  }

  /** Nueva entrada con vigencia posterior a la última (cambio manual o propuesta aceptada). */
  append(input: {
    readonly id: string;
    readonly effectiveFrom: string;
    readonly price: Money;
    readonly origin: 'MANUAL' | 'PROPOSAL';
    readonly proposalId?: string | null;
  }): { readonly history: PriceHistory; readonly entry: PriceEntry } {
    assertPositive(input.price);
    this.assertCurrency(input.price);
    const effectiveFrom = validDate(input.effectiveFrom);
    const latest = this.latest;
    if (latest !== null && effectiveFrom <= latest.effectiveFrom) {
      throw notChronological(
        `effectiveFrom must be after the last price entry (${latest.effectiveFrom}); got ${effectiveFrom}`,
      );
    }
    const entry: PriceEntry = {
      id: input.id,
      effectiveFrom,
      price: input.price,
      origin: input.origin,
      supersedesId: null,
      proposalId: input.origin === 'PROPOSAL' ? (input.proposalId ?? null) : null,
    };
    return { history: new PriceHistory([...this.all, entry]), entry };
  }

  /** Corrección: reemplazo con la misma vigencia y otro monto. La original se conserva marcada como reemplazada. */
  supersede(input: { readonly id: string; readonly entryId: string; readonly price: Money }): {
    readonly history: PriceHistory;
    readonly entry: PriceEntry;
    readonly superseded: PriceEntry;
  } {
    const superseded = this.all.find((e) => e.id === input.entryId);
    if (!superseded) throw new DomainError('RESOURCE_NOT_FOUND', `price entry ${input.entryId} not found`);
    if (this.isSuperseded(superseded.id)) {
      throw new DomainError('INVALID_STATUS_TRANSITION', 'the price entry was already superseded');
    }
    assertPositive(input.price);
    this.assertCurrency(input.price);
    const entry: PriceEntry = {
      id: input.id,
      effectiveFrom: superseded.effectiveFrom,
      price: input.price,
      origin: 'CORRECTION',
      supersedesId: superseded.id,
      proposalId: null,
    };
    return { history: new PriceHistory([...this.all, entry]), entry, superseded };
  }

  private assertCurrency(price: Money): void {
    const code = this.currencyCode;
    if (code !== null && price.currency.code !== code) {
      throw new DomainError(
        'CURRENCY_MISMATCH',
        `every price of the subscription is in ${code}; got ${price.currency.code}`,
      ).at('/price/currency');
    }
  }
}
