import type { LifecycleDto } from '@pf/audit/contracts';
import type { ResolvedRateDto, ValuationRateDto } from '@pf/fx/contracts';
import {
  DomainError,
  FlowValuation,
  LocalDate,
  Money,
  dec,
  present,
  currency as makeCurrency,
  type Currency,
  type Decimal,
  type ExactRate,
} from '@pf/shared-kernel';
import type { ActiveSubscriptionDto, MoneyDto, SubscriptionsQuery } from '../contracts/index.js';
import {
  SubscriptionCostCalculator,
  buildSchedule,
  renewalsPerYear,
  type Subscription,
} from '../domain/index.js';
import type { SubscriptionFilter, SubscriptionsDeps } from './ports/subscriptions.js';
import { assembleDetail, assembleRows } from './subscription-assembler.js';
import {
  chargeDto,
  currentPriceOf,
  type SubscriptionChargeDto,
  type SubscriptionDto,
} from './subscription-views.js';

const notFound = (id: string) => new DomainError('RESOURCE_NOT_FOUND', `subscription ${id} not found`);

export interface CostAmountsDto {
  readonly native: MoneyDto;
  /** En la moneda base; `null` si no hay tasa del par (nunca 1:1). */
  readonly base: MoneyDto | null;
}

export interface SubscriptionCostItemDto {
  readonly subscriptionId: string;
  readonly name: string;
  readonly status: string;
  readonly monthly: CostAmountsDto;
  readonly annual: CostAmountsDto;
  readonly complete: boolean;
}

/** `SubscriptionCostSummary` del contrato HTTP. */
export interface SubscriptionCostSummaryDto {
  readonly baseCurrency: string;
  readonly items: readonly SubscriptionCostItemDto[];
  readonly totals: {
    readonly monthly: MoneyDto;
    readonly annual: MoneyDto;
    readonly complete: boolean;
    readonly unconverted: readonly { readonly monthly: MoneyDto; readonly annual: MoneyDto }[];
  };
  readonly afterTrial: {
    readonly items: readonly SubscriptionCostItemDto[];
    readonly monthly: MoneyDto;
    readonly annual: MoneyDto;
    readonly complete: boolean;
  };
  readonly meta: {
    readonly ratesUsed: readonly ResolvedRateDto[];
    readonly rateWindowDays: number;
    readonly asOf: string;
  };
}

const rateKey = (r: ResolvedRateDto) =>
  `${r.rate.base}/${r.rate.quote}:${r.fxRateId ?? r.asOf}:${r.derivation}`;

/** Convierte un decimal exacto de `from` a la moneda destino con la tasa exacta (multiplica desde base, divide desde quote). */
function convert(value: Decimal, from: string, target: string, rate: ExactRate): Decimal {
  if (from === target) return value;
  if (rate.base === from && rate.quote === target) return value.times(rate.value);
  if (rate.quote === from && rate.base === target) return value.div(rate.value);
  throw new DomainError(
    'CURRENCY_MISMATCH',
    `rate ${rate.base}/${rate.quote} cannot convert ${from} to ${target}`,
  );
}

/**
 * Consultas de suscripciones (openspec add-subscriptions decisiones 5, 11 y 14): listado, detalle, cargos, costo
 * mensualizado/anualizado y recorrido. Lectura directa de la fuente de verdad; el costo no se persiste.
 */
export class SubscriptionsQueries implements SubscriptionsQuery {
  constructor(private readonly deps: SubscriptionsDeps) {}

  private async todayOf(workspaceId: string): Promise<LocalDate> {
    const calendar = await this.deps.calendar.calendarOf(workspaceId);
    return LocalDate.ofInstant(this.deps.clock.now(), calendar.timeZone);
  }

  list(workspaceId: string, filter: SubscriptionFilter): Promise<SubscriptionDto[]> {
    return this.deps.uow.run(workspaceId, async () => {
      const today = await this.todayOf(workspaceId);
      const rows = await this.deps.subscriptions.list(workspaceId, filter);
      return assembleRows(this.deps, workspaceId, rows, today);
    });
  }

  get(workspaceId: string, subscriptionId: string): Promise<SubscriptionDto> {
    return this.deps.uow.run(workspaceId, async () => {
      const sub = await this.deps.subscriptions.findById(workspaceId, subscriptionId);
      if (!sub) throw notFound(subscriptionId);
      return assembleDetail(this.deps, sub, await this.todayOf(workspaceId));
    });
  }

  listCharges(
    workspaceId: string,
    subscriptionId: string,
    limit: number,
    after?: readonly [string, string],
  ): Promise<SubscriptionChargeDto[]> {
    return this.deps.uow.run(workspaceId, async () => {
      const sub = await this.deps.subscriptions.findById(workspaceId, subscriptionId);
      if (!sub) throw notFound(subscriptionId);
      return (await this.deps.charges.list(workspaceId, subscriptionId, limit, after)).map(chargeDto);
    });
  }

  lifecycle(input: {
    readonly userId: string;
    readonly workspaceId: string;
    readonly subscriptionId: string;
  }): Promise<LifecycleDto> {
    return this.deps.uow.run(input.workspaceId, async () => {
      const sub = await this.deps.subscriptions.findById(input.workspaceId, input.subscriptionId);
      if (!sub) throw notFound(input.subscriptionId);
      const query = this.deps.lifecycleQuery;
      if (!query) throw new DomainError('INTERNAL_ERROR', 'lifecycle query is not configured');
      return query.lifecycleOf({
        userId: input.userId,
        workspaceId: input.workspaceId,
        aggregateType: 'Subscription',
        aggregateId: sub.id,
        currentState: sub.status,
      });
    });
  }

  /** `SubscriptionsQuery.listActive` (contrato público): las no canceladas. */
  listActive(input: { readonly workspaceId: string }): Promise<readonly ActiveSubscriptionDto[]> {
    return this.deps.uow.run(input.workspaceId, async () => {
      const today = (await this.todayOf(input.workspaceId)).toString();
      const rows = await this.deps.subscriptions.list(input.workspaceId, {
        statuses: ['TRIAL', 'ACTIVE', 'PAUSED'],
      });
      return rows.map((r): ActiveSubscriptionDto => {
        const price = currentPriceOf(r.subscription, today).price;
        return {
          subscriptionId: r.subscription.id,
          name: r.subscription.snapshot.name,
          status: r.subscription.status as 'TRIAL' | 'ACTIVE' | 'PAUSED',
          price: { amount: price.toFixed(), currency: price.currency.code },
          cadence: r.cadence,
          interval: r.interval,
          paymentAccountId: r.paymentAccountId,
          nextRenewalOn: r.subscription.snapshot.nextRenewalOn,
        };
      });
    });
  }

  // ───────────────────────────────────────────────────────────── costo

  /**
   * `GetSubscriptionCostSummary` (FR-COMMITMENTS-015, docs/14 §4): costo anualizado (precio × renovaciones por año) y
   * mensualizado (÷ 12) por suscripción y en total, en la moneda base con la MISMA valoración del Home y los
   * presupuestos (`FlowValuation`, tasa de hoy, ventana de REPORTING). Sin redondeo intermedio; HALF_EVEN solo al
   * presentar. Incluye `ACTIVE`; `TRIAL` va aparte (`afterTrial`); `PAUSED` y `CANCELLED` quedan fuera. Sin tasa, la
   * parte queda sin convertir y el total incompleto, nunca 1:1.
   */
  costSummary(workspaceId: string): Promise<SubscriptionCostSummaryDto> {
    const { deps } = this;
    return deps.uow.run(workspaceId, async () => {
      const now = deps.clock.now();
      const settings = await deps.settings.settingsOf(workspaceId);
      const today = LocalDate.ofInstant(now, settings.timeZone);
      const catalog = await deps.rates.workspaceCurrencies(workspaceId);
      const currencyOf = (code: string): Currency => {
        const found = catalog.find((c) => c.code === code);
        if (!found) throw new DomainError('CURRENCY_NOT_ENABLED', `currency ${code} is not in the catalog`);
        return makeCurrency(found.code, found.scale);
      };
      const target = currencyOf(settings.baseCurrency);
      const rows = await deps.subscriptions.list(workspaceId, { statuses: ['TRIAL', 'ACTIVE'] });

      interface Line {
        readonly sub: Subscription;
        readonly currency: Currency;
        readonly monthly: Decimal;
        readonly annual: Decimal;
      }
      const lines: Line[] = rows.map((r) => {
        const price =
          r.subscription.status === 'TRIAL'
            ? (r.subscription.history.active[0] ?? currentPriceOf(r.subscription, today.toString()))
            : currentPriceOf(r.subscription, today.toString());
        const schedule = buildSchedule({
          cadence: r.cadence,
          interval: r.interval,
          monthDays: r.monthDays,
          rrule: r.rrule,
          startDate: today.toString(),
        });
        const cost = SubscriptionCostCalculator.cost(price.price, renewalsPerYear(schedule, today));
        return {
          sub: r.subscription,
          currency: price.price.currency,
          monthly: cost.monthly,
          annual: cost.annual,
        };
      });

      const rates = await FlowValuation.resolveRates<ResolvedRateDto>({
        flows: lines.map((l) => ({
          date: today.toString(),
          amount: Money.zero(l.currency),
        })),
        target,
        timeZone: settings.timeZone,
        now,
        windowDays: deps.rateValidityWindowDays,
        resolve: async ({ requests, windowDays }) => {
          const found = await deps.rates.resolveValuationRates({ workspaceId, requests, windowDays });
          return found.map((r: ValuationRateDto | null) =>
            r ? { exact: r.exact, resolved: r.resolved } : null,
          );
        },
        keyOf: rateKey,
      });
      const collector = rates.collector();

      const baseOf = (value: Decimal, code: string): Decimal | null => {
        if (code === target.code) return value;
        const rate = collector.rateFor(code, today.toString());
        return rate === null ? null : convert(value, code, target.code, rate);
      };
      const native = (value: Decimal, c: Currency): MoneyDto => present(value, c).toJSON();
      const item = (l: Line): SubscriptionCostItemDto => {
        const monthlyBase = baseOf(l.monthly, l.currency.code);
        const annualBase = baseOf(l.annual, l.currency.code);
        return {
          subscriptionId: l.sub.id,
          name: l.sub.snapshot.name,
          status: l.sub.status,
          monthly: {
            native: native(l.monthly, l.currency),
            base: monthlyBase === null ? null : present(monthlyBase, target).toJSON(),
          },
          annual: {
            native: native(l.annual, l.currency),
            base: annualBase === null ? null : present(annualBase, target).toJSON(),
          },
          complete: monthlyBase !== null && annualBase !== null,
        };
      };
      const byName = (a: Line, b: Line) => a.sub.snapshot.name.localeCompare(b.sub.snapshot.name);
      const active = lines.filter((l) => l.sub.status === 'ACTIVE').sort(byName);
      const trial = lines.filter((l) => l.sub.status === 'TRIAL').sort(byName);

      const totalsOf = (group: readonly Line[]) => {
        let monthly = dec('0');
        let annual = dec('0');
        const missing = new Map<string, { monthly: Decimal; annual: Decimal; currency: Currency }>();
        for (const l of group) {
          const m = baseOf(l.monthly, l.currency.code);
          const a = baseOf(l.annual, l.currency.code);
          if (m === null || a === null) {
            const prev = missing.get(l.currency.code);
            missing.set(l.currency.code, {
              currency: l.currency,
              monthly: (prev?.monthly ?? dec('0')).plus(l.monthly),
              annual: (prev?.annual ?? dec('0')).plus(l.annual),
            });
            continue;
          }
          monthly = monthly.plus(m);
          annual = annual.plus(a);
        }
        return {
          monthly: present(monthly, target).toJSON(),
          annual: present(annual, target).toJSON(),
          complete: missing.size === 0,
          unconverted: [...missing.values()]
            .sort((x, y) => (x.currency.code < y.currency.code ? -1 : 1))
            .map((m) => ({ monthly: native(m.monthly, m.currency), annual: native(m.annual, m.currency) })),
        };
      };
      const activeTotals = totalsOf(active);
      const trialTotals = totalsOf(trial);
      return {
        baseCurrency: target.code,
        items: active.map(item),
        totals: activeTotals,
        afterTrial: {
          items: trial.map(item),
          monthly: trialTotals.monthly,
          annual: trialTotals.annual,
          complete: trialTotals.complete,
        },
        meta: {
          ratesUsed: collector.used(),
          rateWindowDays: deps.rateValidityWindowDays,
          asOf: now.toString(),
        },
      };
    });
  }
}
