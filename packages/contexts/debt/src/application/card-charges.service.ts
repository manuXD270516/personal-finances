import type { AuditChangeInput } from '@pf/audit/contracts';
import { DomainError, LocalDate, currency as makeCurrency, type Money } from '@pf/shared-kernel';
import {
  CardCharge,
  assertCardChargeDate,
  parseCardChargeComponents,
  type CARD_CHARGE_COMPONENT_KEYS,
  type CardChargeComponentInput,
  type CardChargeState,
  type CardAccountState,
  type CreditCard,
} from '../domain/index.js';
import { CardEngine } from './card-engine.js';
import type { CardDeps } from './card-ports.js';
import { cardChargeView, type CardChargeView } from './card-views.js';

const AGGREGATE = 'CardCharge';
const notFound = (what: string, id: string) =>
  new DomainError('RESOURCE_NOT_FOUND', `${what} ${id} not found`);
const preconditionFailed = (currentVersion: number) =>
  new DomainError('PRECONDITION_FAILED', 'If-Match does not match the current version', {
    details: { currentVersion },
  });

export interface RecordCardChargeCommand {
  readonly workspaceId: string;
  readonly userId: string;
  readonly cardId: string;
  /** Cuenta de usuario (`accountId`) de la tarjeta a la que se carga. */
  readonly accountId: unknown;
  /** Con `adoptTransactionId` la fecha es la de la transacción: no se admite. */
  readonly businessDate?: unknown;
  readonly interest?: unknown;
  readonly fees?: unknown;
  readonly insurance?: unknown;
  readonly taxes?: unknown;
  readonly adoptTransactionId?: unknown;
  readonly description?: unknown;
}

export interface VoidCardChargeCommand {
  readonly workspaceId: string;
  readonly userId: string;
  readonly cardId: string;
  readonly chargeId: string;
  readonly expectedVersion: number;
  readonly reason: unknown;
}

const DEFAULT_DESCRIPTION = 'Intereses y cargos de la tarjeta';

/** Auditoría de un cargo: componentes como `Money` y los textos tal cual (sin descripciones del usuario). */
function chargeChanges(s: CardChargeState): AuditChangeInput[] {
  const m = (v: Money) => ({ amount: v.toFixed(), currency: s.currency.code });
  return [
    { field: 'cardId', before: null, after: s.cardId },
    { field: 'accountId', before: null, after: s.accountId },
    { field: 'businessDate', before: null, after: s.businessDate },
    { field: 'interest', before: null, after: m(s.interest) },
    { field: 'fees', before: null, after: m(s.fees) },
    { field: 'insurance', before: null, after: m(s.insurance) },
    { field: 'taxes', before: null, after: m(s.taxes) },
    { field: 'origin', before: null, after: s.origin },
    { field: 'transactionId', before: null, after: s.transactionId },
    { field: 'status', before: null, after: s.status },
  ];
}

const textOf = (value: unknown, pointer: string): string | undefined => {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new DomainError('VALIDATION_FAILED', 'must be a string').at(pointer);
  return value;
};

/**
 * Casos de uso de DEBT sobre los cargos de una tarjeta (openspec add-card-interest-ledger-portions, decisiones 4 y 5):
 * registrar los intereses y cargos que cobra el banco, adoptar un gasto existente como cargo y anularlo. Cada comando
 * corre en UNA unidad de trabajo: la transacción del ledger (`CardChargeTransactionsPort`, con su asiento, auditoría,
 * recorrido y outbox), el cargo y su auditoría se confirman juntos. DEBT no escribe asientos: los crea TRANSACTIONS.
 */
export class CardChargesService {
  private readonly engine: CardEngine;

  constructor(private readonly deps: CardDeps) {
    this.engine = new CardEngine(deps);
  }

  private async loadCard(workspaceId: string, cardId: string): Promise<CreditCard> {
    const card = await this.deps.cards.findById(workspaceId, cardId, { lock: 'update' });
    if (!card) throw notFound('credit card', cardId);
    return card;
  }

  /** Fecha del primer asiento de apertura de la cuenta (anterior a ella no hay cargos), si la cuenta tiene uno. */
  private async openedOn(workspaceId: string, accountId: string, today: LocalDate): Promise<string | null> {
    const rows = await this.deps.openings.listOpeningEntries({
      workspaceId,
      accountIds: [accountId],
      from: '1900-01-01',
      to: today.toString(),
    });
    const dates = rows.map((r) => r.entryDate).sort();
    return dates[0] ?? null;
  }

  async record(cmd: RecordCardChargeCommand): Promise<CardChargeView> {
    const { deps } = this;
    return deps.uow.run(cmd.workspaceId, async () => {
      const clock = await this.engine.clockOf(cmd.workspaceId);
      const card = await this.loadCard(cmd.workspaceId, cmd.cardId);
      const snapshot = card.snapshot;
      if (snapshot.status !== 'ACTIVE') {
        throw new DomainError('CARD_CHARGE_INVALID', 'the credit card is archived').at('/cardId');
      }
      const account = snapshot.accounts.find((a) => a.accountId === cmd.accountId);
      if (typeof cmd.accountId !== 'string' || !account) {
        throw new DomainError('CARD_CHARGE_INVALID', 'the account does not belong to the card').at(
          '/accountId',
        );
      }
      const currency = makeCurrency(account.currency, account.scale);
      const input: CardChargeComponentInput = {
        interest: textOf(cmd.interest, '/interest'),
        fees: textOf(cmd.fees, '/fees'),
        insurance: textOf(cmd.insurance, '/insurance'),
        taxes: textOf(cmd.taxes, '/taxes'),
      };
      const components = parseCardChargeComponents(input, currency);
      const adoptId = textOf(cmd.adoptTransactionId, '/adoptTransactionId');
      const description = textOf(cmd.description, '/description') ?? DEFAULT_DESCRIPTION;
      if (description.length > 200) {
        throw new DomainError('VALIDATION_FAILED', 'at most 200 characters').at('/description');
      }
      const chargeId = deps.ids.next();
      let transactionId: string;
      let businessDate: string;
      let origin: 'RECORDED' | 'ADOPTED';
      let accountOfUser = account.accountId;
      if (adoptId !== undefined) {
        if (cmd.businessDate !== undefined && cmd.businessDate !== null) {
          throw new DomainError('VALIDATION_FAILED', 'the date of an adopted expense is its own').at(
            '/businessDate',
          );
        }
        if (await deps.charges.findActiveByTransaction(cmd.workspaceId, adoptId)) {
          throw new DomainError('CARD_CHARGE_INVALID', 'the expense is already a card charge').at(
            '/adoptTransactionId',
          );
        }
        const adopted = await deps.chargeTransactions.adoptCharge({
          workspaceId: cmd.workspaceId,
          userId: cmd.userId,
          cardId: card.id,
          cardAccountIds: snapshot.accounts.map((a) => a.accountId),
          transactionId: adoptId,
          amounts: this.amountsOf(components),
        });
        transactionId = adopted.transactionId;
        businessDate = adopted.businessDate;
        accountOfUser = adopted.accountId;
        origin = 'ADOPTED';
      } else {
        businessDate = await this.resolveDate(cmd, account, clock.today);
        assertCardChargeDate(
          businessDate,
          clock.today,
          await this.openedOn(cmd.workspaceId, account.accountId, clock.today),
        );
        const recorded = await deps.chargeTransactions.recordCharge({
          workspaceId: cmd.workspaceId,
          userId: cmd.userId,
          chargeId,
          cardId: card.id,
          accountId: account.accountId,
          businessDate,
          currency: account.currency,
          amounts: this.amountsOf(components),
          description,
        });
        transactionId = recorded.transactionId;
        businessDate = recorded.businessDate;
        origin = 'RECORDED';
      }
      // En una adopción la cuenta es la del gasto (puede ser la de otra moneda de la misma tarjeta).
      const owner = snapshot.accounts.find((a) => a.accountId === accountOfUser) ?? account;
      const charge = CardCharge.create({
        id: chargeId,
        workspaceId: cmd.workspaceId,
        cardId: card.id,
        cardAccountId: owner.id,
        accountId: owner.accountId,
        transactionId,
        businessDate,
        currency: makeCurrency(owner.currency, owner.scale),
        components,
        origin,
        createdAt: clock.at,
        createdBy: cmd.userId,
      });
      await deps.charges.insert(charge);
      const s = charge.snapshot;
      await deps.audit.append({
        workspaceId: cmd.workspaceId,
        action: origin === 'ADOPTED' ? 'debt.card_charge.adopted' : 'debt.card_charge.recorded',
        aggregateType: AGGREGATE,
        aggregateId: s.id,
        aggregateVersion: s.version,
        changes: chargeChanges(s),
      });
      return cardChargeView(s);
    });
  }

  async void(cmd: VoidCardChargeCommand): Promise<CardChargeView> {
    const { deps } = this;
    return deps.uow.run(cmd.workspaceId, async () => {
      const clock = await this.engine.clockOf(cmd.workspaceId);
      const charge = await deps.charges.findById(cmd.workspaceId, cmd.chargeId, { lock: 'update' });
      if (!charge || charge.snapshot.cardId !== cmd.cardId) throw notFound('card charge', cmd.chargeId);
      const before = charge.snapshot;
      if (typeof cmd.reason !== 'string') {
        throw new DomainError('VALIDATION_FAILED', 'reason is required').at('/reason');
      }
      if (before.status === 'VOIDED') return cardChargeView(before);
      if (before.version !== cmd.expectedVersion) throw preconditionFailed(before.version);
      // La reversa del asiento la hace TRANSACTIONS; un periodo cerrado se rechaza con `PERIOD_CLOSED` sin tocar nada.
      charge.void(cmd.reason, cmd.userId, clock.at);
      await deps.chargeTransactions.voidCharge({
        workspaceId: cmd.workspaceId,
        userId: cmd.userId,
        transactionId: before.transactionId,
        reason: charge.snapshot.voidReason as string,
      });
      if (!(await deps.charges.saveVoid(charge))) {
        throw new DomainError('CONCURRENCY_CONFLICT', 'the card charge was modified concurrently');
      }
      const after = charge.snapshot;
      await deps.audit.append({
        workspaceId: cmd.workspaceId,
        action: 'debt.card_charge.voided',
        aggregateType: AGGREGATE,
        aggregateId: after.id,
        aggregateVersion: after.version,
        reason: after.voidReason,
        changes: [{ field: 'status', before: before.status, after: after.status }],
      });
      return cardChargeView(after);
    });
  }

  /** Fecha por omisión: el cierre del último estado de cuenta emitido de la cuenta. */
  private async resolveDate(
    cmd: RecordCardChargeCommand,
    account: CardAccountState,
    today: LocalDate,
  ): Promise<string> {
    const given = textOf(cmd.businessDate, '/businessDate');
    if (given !== undefined) return given;
    const records = await this.deps.statements.listForAccounts(cmd.workspaceId, [account.id]);
    const last = records
      .filter((r) => LocalDate.parse(r.closingDate).compare(today) <= 0)
      .map((r) => r.closingDate)
      .sort()
      .at(-1);
    if (!last) {
      throw new DomainError(
        'VALIDATION_FAILED',
        'the account has no issued statement: the date of the charge is required',
      ).at('/businessDate');
    }
    return last;
  }

  private amountsOf(components: Record<(typeof CARD_CHARGE_COMPONENT_KEYS)[number], Money>) {
    return {
      interest: components.interest.toFixed(),
      fees: components.fees.toFixed(),
      insurance: components.insurance.toFixed(),
      taxes: components.taxes.toFixed(),
    };
  }
}
