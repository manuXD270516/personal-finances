import { type Instant, LocalDate, type Clock } from '@pf/shared-kernel';
import {
  CRYPTO_PIVOT_CURRENCY,
  isCryptoRateProvider,
  ProviderSample,
  type CryptoRateProvider,
  type FxRateProvider,
  type PollableProvider,
} from '../domain/index.js';
import type {
  ExchangeRateRepository,
  FirstBalanceDatePort,
  HistoryClose,
  IdGenerator,
  ProviderHistoryCache,
  ProviderRunKind,
  ProviderRunRepository,
  UnitOfWork,
} from './ports/index.js';
import type { ProviderCycleResult, ProviderRunLog } from './provider-run-log.js';
import { enabledCryptoProviders, type FxProviderSettings } from './provider-settings.js';
import type { RatePairResolver } from './rate-pairs.js';
import type { RecordTarget, SampleRecorder } from './sample-recorder.js';

export interface CryptoHistoryDeps {
  readonly uow: UnitOfWork;
  readonly rates: ExchangeRateRepository;
  readonly runs: ProviderRunRepository;
  readonly runLog: ProviderRunLog;
  readonly cache: ProviderHistoryCache;
  readonly firstBalance: FirstBalanceDatePort;
  readonly recorder: SampleRecorder;
  readonly pairs: RatePairResolver;
  readonly workspaces: { list(): Promise<readonly RecordTarget[]> };
  readonly ids: IdGenerator;
  readonly clock: Clock;
  readonly settings: FxProviderSettings;
  readonly providers: Partial<Record<FxRateProvider, PollableProvider>>;
}

/** Sufijo de la vigencia de un cierre diario (`D T23:59:59Z`, normalizada por `Instant`). */
const CLOSE_SUFFIX = 'T23:59:59.000Z';

/** Último día completo (UTC) a la hora dada: un día D está completo cuando D < hoy en UTC. */
export const lastCompleteDay = (now: Instant): string =>
  LocalDate.ofInstant(now, 'UTC').plusDays(-1).toString();

/** Páginas por mes calendario UTC de `[from, to]` (rangos fijos de la instalación; FR-FX-015). */
export function monthPages(from: string, to: string): { from: string; to: string }[] {
  const pages: { from: string; to: string }[] = [];
  let cursor = LocalDate.parse(from);
  const end = LocalDate.parse(to);
  while (cursor.compare(end) <= 0) {
    const monthEnd = LocalDate.of(
      cursor.year,
      cursor.month,
      LocalDate.daysInMonth(cursor.year, cursor.month),
    );
    const pageEnd = monthEnd.compare(end) <= 0 ? monthEnd : end;
    pages.push({ from: cursor.toString(), to: pageEnd.toString() });
    cursor = pageEnd.plusDays(1);
  }
  return pages;
}

/**
 * Histórico de cierres diarios cripto (fx/market-rate-providers, D229; add-crypto-rate-providers decisión 6):
 *   1. `refreshCache`: pide al provider cripto los cierres diarios de días COMPLETOS con rangos fijos de la instalación
 *      (`FX_CRYPTO_HISTORY_FROM` y páginas por mes UTC, nunca una fecha de un workspace) y los guarda en la caché de
 *      instalación `fx.provider_history_point`. Respeta `Retry-After` persistido, también a mitad del backfill paginado.
 *   2. `BackfillCryptoHistory` / `FillCryptoGaps`: copia a `fx.exchange_rate` de cada workspace los cierres de cada par
 *      cripto configurado desde la primera fecha con saldo (LEDGER) hasta ayer, con vigencia = cierre del día
 *      (`D T23:59:59Z`), sin detección de anomalías, idempotente por (workspace, provider, par, tipo, vigencia). Si un
 *      movimiento con fecha pasada adelanta la primera fecha con saldo, el relleno diario agrega los cierres anteriores
 *      sin alterar los ya registrados.
 */
export class CryptoHistorySync {
  constructor(private readonly deps: CryptoHistoryDeps) {}

  /** `BackfillCryptoHistory` de un workspace. */
  backfill(target: RecordTarget): Promise<ProviderCycleResult[]> {
    return this.run('BACKFILL', [target]);
  }

  /** `FillCryptoGaps` diario en todos los workspaces activos. */
  async fillGaps(): Promise<ProviderCycleResult[]> {
    return this.run('GAP_FILL', await this.deps.workspaces.list());
  }

  private adapters(): { id: FxRateProvider; adapter: CryptoRateProvider }[] {
    const out: { id: FxRateProvider; adapter: CryptoRateProvider }[] = [];
    for (const id of enabledCryptoProviders(this.deps.settings)) {
      const adapter = this.deps.providers[id];
      if (adapter && isCryptoRateProvider(adapter) && adapter.descriptor().dailyCloses)
        out.push({ id, adapter });
    }
    return out;
  }

  private async run(kind: ProviderRunKind, targets: readonly RecordTarget[]): Promise<ProviderCycleResult[]> {
    if (!this.deps.settings.backfillEnabled) return [];
    const adapters = this.adapters();
    if (adapters.length === 0) return [];
    const startedAt = this.deps.clock.now();
    const to = lastCompleteDay(startedAt);
    const failures = new Map<FxRateProvider, ProviderCycleResult>();
    const cacheInserted = new Map<FxRateProvider, number>();
    for (const { id, adapter } of adapters) {
      const refreshed = await this.refreshCache(id, adapter, kind, startedAt, to);
      if (refreshed.failure) failures.set(id, refreshed.failure);
      cacheInserted.set(id, refreshed.inserted);
    }
    const correlationId = this.deps.ids.next();
    const copied = new Map<FxRateProvider, number>();
    for (const target of targets) {
      const perProvider = await this.copyTo(target, adapters, to, correlationId);
      for (const [id, n] of perProvider) copied.set(id, (copied.get(id) ?? 0) + n);
    }
    const results: ProviderCycleResult[] = [];
    for (const { id } of adapters) {
      const failure = failures.get(id);
      if (failure) {
        results.push(failure);
        continue;
      }
      const summary = await this.deps.cache.summary(id);
      const inserted = copied.get(id) ?? 0;
      results.push(
        await this.deps.runLog.finish(
          id,
          kind,
          startedAt,
          inserted > 0 || (cacheInserted.get(id) ?? 0) > 0 ? 'OK' : 'NO_NEW_SAMPLE',
          inserted,
          null,
          { historyPoints: summary.points, historyFrom: summary.from, historyTo: summary.to },
        ),
      );
    }
    return results;
  }

  /**
   * Completa la caché de instalación: desde el día siguiente al último en caché (o `FX_CRYPTO_HISTORY_FROM`) hasta el
   * último día completo, por páginas de un mes UTC y en orden ascendente (una falla deja la caché sin huecos: el
   * siguiente ciclo continúa donde quedó).
   */
  private async refreshCache(
    id: FxRateProvider,
    adapter: CryptoRateProvider,
    kind: ProviderRunKind,
    startedAt: Instant,
    to: string,
  ): Promise<{ inserted: number; failure: ProviderCycleResult | null }> {
    const blocked = (await this.deps.runs.recent(id, 50, ['POLL', 'BACKFILL', 'GAP_FILL'])).find(
      (r) => r.retryAfterUntil !== null && Date.parse(r.retryAfterUntil) > startedAt.epochMillis,
    );
    if (blocked) {
      const result = await this.deps.runLog.finish(id, kind, startedAt, 'SKIPPED_RATE_LIMIT', 0, null, {
        retryAfterUntil: blocked.retryAfterUntil,
      });
      return { inserted: 0, failure: result };
    }
    const feeds = adapter.descriptor().feeds.filter((f) => f.quote === CRYPTO_PIVOT_CURRENCY);
    let from = this.deps.settings.cryptoHistoryFrom;
    const last: string[] = [];
    for (const feed of feeds) {
      const day = await this.deps.cache.lastDay(id, feed.base, feed.quote);
      last.push(day ? LocalDate.parse(day).plusDays(1).toString() : this.deps.settings.cryptoHistoryFrom);
    }
    if (last.length > 0) from = last.reduce((a, b) => (a < b ? a : b));
    if (from < this.deps.settings.cryptoHistoryFrom) from = this.deps.settings.cryptoHistoryFrom;
    if (from > to) return { inserted: 0, failure: null };
    let inserted = 0;
    for (const page of monthPages(from, to)) {
      try {
        const samples = await adapter.fetchDailyCloses(page);
        inserted += await this.deps.cache.insertCloses(
          samples
            .filter((s) => s.rateType === 'MARKET' && s.quote === CRYPTO_PIVOT_CURRENCY)
            .map((s): HistoryClose => ({
              provider: id,
              base: s.base,
              quote: s.quote,
              day: s.asOf.slice(0, 10),
              close: s.value,
              closeAt: s.asOf,
              fetchedAt: s.fetchedAt,
              rawPayload: s.rawPayload,
            }))
            .filter((c) => c.day >= page.from && c.day <= page.to),
        );
      } catch (err) {
        return { inserted, failure: await this.deps.runLog.failure(id, kind, startedAt, err) };
      }
    }
    return { inserted, failure: null };
  }

  /** Copia al workspace los cierres que faltan de sus pares cripto; cuenta por provider las tasas nuevas. */
  private copyTo(
    target: RecordTarget,
    adapters: readonly { id: FxRateProvider }[],
    to: string,
    correlationId: string,
  ): Promise<Map<FxRateProvider, number>> {
    const { workspaceId } = target;
    return this.deps.uow.run(workspaceId, async () => {
      const inserted = new Map<FxRateProvider, number>();
      const effective = await this.deps.pairs.effective(workspaceId, target.baseCurrency ?? 'BOB');
      const cryptoPairs = effective.pairs.filter(
        (p) => p.assetClass === 'VOLATILE_CRYPTO' && p.quote === CRYPTO_PIVOT_CURRENCY,
      );
      if (cryptoPairs.length === 0) return inserted;
      const firstDates = await this.deps.firstBalance.byCurrency(workspaceId);
      const samplesBy = new Map<FxRateProvider, ProviderSample[]>();
      for (const pair of cryptoPairs) {
        const from = firstDates.get(pair.base);
        if (!from || from > to) continue;
        // Cierres ya registrados por cualquiera de los providers cripto (un día se registra una sola vez).
        const takenAsOf = new Set<string>();
        const takenDays = new Set<string>();
        for (const { id } of adapters) {
          const existing = await this.deps.rates.providerAsOfs(
            workspaceId,
            { provider: id, base: pair.base, quote: pair.quote, rateType: 'MARKET' },
            `${from}T00:00:00.000Z`,
            `${to}T23:59:59.999Z`,
          );
          for (const asOf of existing) {
            takenAsOf.add(asOf);
            if (asOf.endsWith(CLOSE_SUFFIX)) takenDays.add(asOf.slice(0, 10));
          }
        }
        for (const { id } of adapters) {
          const closes = await this.deps.cache.closes(id, {
            bases: [pair.base],
            quote: pair.quote,
            from,
            to,
          });
          for (const close of closes) {
            if (takenAsOf.has(close.closeAt) || takenDays.has(close.day)) continue;
            takenDays.add(close.day);
            const list = samplesBy.get(id) ?? [];
            list.push(
              ProviderSample.of({
                provider: id,
                base: close.base,
                quote: close.quote,
                rateType: 'MARKET',
                value: close.close,
                asOf: close.closeAt,
                fetchedAt: close.fetchedAt,
                rawPayload: close.rawPayload,
                sourceLabel: `${id} (cierre diario)`,
              }),
            );
            samplesBy.set(id, list);
          }
        }
      }
      for (const { id } of adapters) {
        const samples = samplesBy.get(id);
        if (!samples || samples.length === 0) continue;
        inserted.set(
          id,
          await this.deps.recorder.recordIn(target, samples, {
            detectAnomalies: false,
            eventPerRate: false,
            correlationId,
            skipDaysWithRates: false,
          }),
        );
      }
      return inserted;
    });
  }
}
