import { DomainError } from '@pf/shared-kernel';
import type { ClassificationEvidenceDto } from '@pf/transactions/contracts';
import {
  BACKTEST_MIN_MONTHS,
  CategorySuggestionIndex,
  backtestFigures,
  categoryKindFor,
  type BacktestFigures,
  type CategorySuggestion,
  type CategorySuggestionBasis,
  type CategorySuggestionLevel,
  type SubjectKind,
  type SuggestionEvidence,
} from '../domain/index.js';
import type {
  CategorySuggestionOutcomeKind,
  CategorySuggestionOutcomeRecord,
  CategorySuggestionSurface,
  RulesDeps,
} from './ports/index.js';
import type { RulesQueries } from './rules.queries.js';

const DAY_MS = 86_400_000;
const NIL_ACCOUNT = '00000000-0000-0000-0000-000000000000';
export const CATEGORY_SUGGEST_MAX_DESCRIPTION = 500;
export const CATEGORY_SUGGEST_STATS_MAX_DAYS = 366;
/** Métricas (sin descripciones ni montos). */
export const CATEGORY_SUGGEST_METRICS = {
  queries: 'rules_category_suggestion_queries_total',
  suggested: 'rules_category_suggestion_suggested_total',
  evidenceTruncated: 'rules_category_suggestion_evidence_truncated_total',
  stageFailures: 'rules_category_suggestion_stage_failures_total',
} as const;

const invalid = (message: string, pointer: string) =>
  new DomainError('VALIDATION_FAILED', message).at(pointer);

const addDays = (date: string, days: number): string =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

const KINDS: readonly SubjectKind[] = ['INCOME', 'EXPENSE', 'REFUND'];

export type CategorySuggestionStatus = 'SUGGESTED' | 'RULE_APPLIES' | 'NONE' | 'DISABLED';

export interface CategorySuggestionResult {
  readonly status: CategorySuggestionStatus;
  readonly suggestion: CategorySuggestion | null;
  readonly ruleId: string | null;
}

export interface CategorySuggestionQueryCommand {
  readonly kind: unknown;
  readonly description?: unknown;
  readonly counterpartyId?: unknown;
  readonly accountId?: unknown;
  readonly date?: unknown;
}

export interface CategorySuggestionFeedbackCommand {
  readonly surface: unknown;
  readonly level: unknown;
  readonly suggestedCategoryId: unknown;
  readonly chosenCategoryId: unknown;
  readonly transactionId?: unknown;
}

export interface OutcomeCounts {
  readonly shown: number;
  readonly accepted: number;
  readonly corrected: number;
  readonly ignored: number;
}

export interface CategorySuggestionStats extends OutcomeCounts {
  readonly from: string;
  readonly to: string;
  /** `accepted ÷ shown`, 4 decimales HALF_EVEN; `null` sin sugerencias. */
  readonly acceptanceRate: string | null;
  readonly bySurface: readonly (OutcomeCounts & { readonly surface: CategorySuggestionSurface })[];
  readonly byLevel: readonly (OutcomeCounts & { readonly level: CategorySuggestionLevel })[];
}

export interface BacktestSlice extends BacktestFigures {
  /** `YYYY-MM`; `null` en el total. */
  readonly month: string | null;
  readonly truncated: boolean;
}

export interface BacktestReport {
  readonly months: number;
  readonly asOf: string;
  readonly total: BacktestSlice;
  readonly byMonth: readonly BacktestSlice[];
  readonly byLevel: readonly (BacktestCell & { readonly level: CategorySuggestionLevel })[];
  readonly byBasis: readonly (BacktestCell & { readonly basis: CategorySuggestionBasis })[];
}

/** Precisión de un nivel o de una base (la cobertura solo tiene sentido sobre el total). */
export interface BacktestCell {
  readonly suggestions: number;
  readonly hits: number;
  readonly precision: string | null;
}

interface CachedIndex {
  readonly index: CategorySuggestionIndex;
  readonly expiresAt: number;
  readonly truncated: boolean;
}

const rate = (numerator: number, denominator: number): string | null =>
  denominator === 0 ? null : backtestFigures(denominator, denominator, numerator).precision;

const countsOf = (
  rows: readonly { outcome: CategorySuggestionOutcomeKind; count: number }[],
): OutcomeCounts => {
  const sum = (kind: CategorySuggestionOutcomeKind) =>
    rows.filter((r) => r.outcome === kind).reduce((n, r) => n + r.count, 0);
  const accepted = sum('ACCEPTED');
  const corrected = sum('CORRECTED');
  const ignored = sum('IGNORED');
  return { shown: accepted + corrected + ignored, accepted, corrected, ignored };
};

/**
 * Sugerencias de categoría por historial (openspec add-category-suggestions, FR-CLASSIFICATION-014, D476 y D477). Se
 * calculan a pedido, en la API y en la etapa de clasificación del import: sin trabajos, sin consumidores y sin el
 * servicio de pronósticos (D249). Nunca modifican una transacción: la sugerencia solo se aplica por una acción del usuario.
 */
export class CategorySuggestionService {
  /** Caché en proceso del índice de evidencia por workspace (TTL y tope LRU; nunca mezcla workspaces). */
  private readonly cache = new Map<string, CachedIndex>();

  constructor(
    private readonly deps: RulesDeps,
    private readonly queries: RulesQueries,
  ) {}

  private get settings() {
    return this.deps.settings.categorySuggest;
  }

  private nowMs(): number {
    return Date.parse(this.deps.clock.now().toString());
  }

  // ----------------------------------------------------------------- evidencia

  /** Evidencia utilizable: categoría activa y compatible con el tipo de la transacción. */
  private async usableEvidence(
    workspaceId: string,
    items: readonly ClassificationEvidenceDto[],
  ): Promise<SuggestionEvidence[]> {
    const rawIds = [...new Set(items.flatMap((i) => (i.categoryId === null ? [] : [i.categoryId])))];
    // D496 (add-category-and-counterparty-merge): la evidencia de una categoría fusionada cuenta como la de su destino
    // vigente, incluidas las porciones que conservaron la origen por estar en periodos cerrados; nunca se propone una
    // categoría fusionada (la destino es la que resulta activa).
    const merged = this.deps.categoryMerge
      ? await this.deps.categoryMerge.resolve({ workspaceId, categoryIds: rawIds })
      : new Map<string, string>();
    const resolve = (id: string): string => merged.get(id) ?? id;
    const categoryIds = [...new Set(rawIds.map(resolve))];
    const catalog = await this.deps.catalog.load({
      workspaceId,
      actions: categoryIds.map((categoryId) => ({ type: 'SET_CATEGORY' as const, categoryId })),
    });
    return items.flatMap((i) => {
      if (i.categoryId === null) return [];
      const categoryId = resolve(i.categoryId);
      return catalog.activeCategoryKind(categoryId) === categoryKindFor(i.kind)
        ? [
            {
              kind: i.kind,
              description: i.description,
              counterpartyId: i.counterpartyId,
              categoryId,
            },
          ]
        : [];
    });
  }

  private async loadIndex(
    workspaceId: string,
    window: { readonly from: string; readonly to: string },
  ): Promise<{ readonly index: CategorySuggestionIndex; readonly truncated: boolean }> {
    const page = await this.deps.subjects.listEvidence({
      workspaceId,
      from: window.from,
      to: window.to,
      limit: this.settings.maxEvidence,
    });
    if (page.truncated) this.deps.metrics?.increment(CATEGORY_SUGGEST_METRICS.evidenceTruncated, {});
    const usable = await this.usableEvidence(workspaceId, page.items);
    return { index: CategorySuggestionIndex.build(usable), truncated: page.truncated };
  }

  private async currentIndex(workspaceId: string, useCache: boolean): Promise<CategorySuggestionIndex> {
    const now = this.nowMs();
    if (useCache) {
      const hit = this.cache.get(workspaceId);
      if (hit && hit.expiresAt > now) {
        // LRU: el más recientemente usado queda al final del mapa.
        this.cache.delete(workspaceId);
        this.cache.set(workspaceId, hit);
        return hit.index;
      }
    }
    const to = await this.deps.calendar.today(workspaceId);
    const built = await this.loadIndex(workspaceId, { from: addDays(to, -this.settings.windowDays), to });
    if (useCache) {
      this.cache.delete(workspaceId);
      this.cache.set(workspaceId, {
        index: built.index,
        truncated: built.truncated,
        expiresAt: now + this.settings.cacheTtlSeconds * 1000,
      });
      while (this.cache.size > this.settings.cacheMaxWorkspaces) {
        const oldest = this.cache.keys().next().value as string;
        this.cache.delete(oldest);
      }
    }
    return built.index;
  }

  /** Vacía la caché (los tests y el cambio de configuración). */
  clearCache(): void {
    this.cache.clear();
  }

  // ----------------------------------------------------------------- consulta del alta manual

  /** `queryCategorySuggestion`: lectura sin efectos, en la unidad de trabajo de la petición. */
  async query(workspaceId: string, cmd: CategorySuggestionQueryCommand): Promise<CategorySuggestionResult> {
    const kind = cmd.kind;
    if (typeof kind !== 'string' || !(KINDS as readonly string[]).includes(kind)) {
      throw invalid(`kind must be one of ${KINDS.join(', ')}`, '/kind');
    }
    const description = cmd.description ?? null;
    if (description !== null && typeof description !== 'string') {
      throw invalid('description must be a string', '/description');
    }
    if (description !== null && Array.from(description).length > CATEGORY_SUGGEST_MAX_DESCRIPTION) {
      throw invalid(`description has at most ${CATEGORY_SUGGEST_MAX_DESCRIPTION} characters`, '/description');
    }
    const counterpartyId = cmd.counterpartyId ?? null;
    if (counterpartyId !== null && typeof counterpartyId !== 'string') {
      throw invalid('counterpartyId must be an id', '/counterpartyId');
    }
    const accountId = cmd.accountId ?? null;
    if (accountId !== null && typeof accountId !== 'string') {
      throw invalid('accountId must be an id', '/accountId');
    }
    const date = cmd.date ?? null;
    if (date !== null && (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(date))) {
      throw invalid('date must be YYYY-MM-DD', '/date');
    }
    if ((description === null || description.trim() === '') && counterpartyId === null) {
      throw invalid('description or counterpartyId is required', '/description');
    }
    if (!this.settings.enabled) return { status: 'DISABLED', suggestion: null, ruleId: null };

    return this.deps.uow.run(workspaceId, async () => {
      this.deps.metrics?.increment(CATEGORY_SUGGEST_METRICS.queries, {});
      const today = date ?? (await this.deps.calendar.today(workspaceId));
      // Las reglas de alta manual mandan: si una fijaría la categoría, no se sugiere (FR-RULES-009).
      const [outcome] = await this.queries.evaluate({
        workspaceId,
        trigger: 'MANUAL_CREATE',
        mode: 'FILL_EMPTY',
        subjects: [
          {
            ref: 'draft',
            kind: kind as SubjectKind,
            accountId: accountId ?? NIL_ACCOUNT,
            date: today,
            amount: { amount: '0', currency: 'BOB' },
            description,
            counterpartyId,
            counterpartyOrigin: counterpartyId === null ? null : 'USER',
            categoryId: null,
            tagIds: [],
            externalSource: null,
            customFields: [],
            splitCount: 1,
          },
        ],
      });
      if (outcome?.category) {
        return { status: 'RULE_APPLIES', suggestion: null, ruleId: outcome.category.origin.ruleId };
      }
      const index = await this.currentIndex(workspaceId, true);
      const suggestion = index.suggest(
        { kind: kind as SubjectKind, description, counterpartyId },
        this.settings,
      );
      if (suggestion) {
        this.deps.metrics?.increment(CATEGORY_SUGGEST_METRICS.suggested, { level: suggestion.level });
        return { status: 'SUGGESTED', suggestion, ruleId: null };
      }
      return { status: 'NONE', suggestion: null, ruleId: null };
    });
  }

  // ----------------------------------------------------------------- vista previa del import

  /**
   * `CategorySuggestionQuery.suggestMany`: un índice por llamada (sin caché: el import ve la evidencia vigente) y las
   * sugerencias de las filas que la tienen. En la unidad de trabajo del llamador si existe.
   */
  async suggestMany(input: {
    readonly workspaceId: string;
    readonly subjects: readonly {
      readonly ref: string;
      readonly kind: SubjectKind;
      readonly description: string | null;
      readonly counterpartyId: string | null;
    }[];
  }): Promise<Map<string, CategorySuggestion>> {
    const out = new Map<string, CategorySuggestion>();
    if (!this.settings.enabled || input.subjects.length === 0) return out;
    return this.deps.uow.run(input.workspaceId, async () => {
      const index = await this.currentIndex(input.workspaceId, false);
      for (const s of input.subjects) {
        const suggestion = index.suggest(s, this.settings);
        if (suggestion) {
          out.set(s.ref, suggestion);
          this.deps.metrics?.increment(CATEGORY_SUGGEST_METRICS.suggested, { level: suggestion.level });
        }
      }
      return out;
    });
  }

  // ----------------------------------------------------------------- resultados y tasa de aceptación

  /** `recordBatch` (IMPORTS al aprobar): sin auditoría, en la unidad de trabajo del llamador. */
  async recordBatch(input: {
    readonly workspaceId: string;
    readonly surface: CategorySuggestionSurface;
    readonly importJobId: string | null;
    readonly outcomes: readonly {
      readonly level: CategorySuggestionLevel;
      readonly outcome: CategorySuggestionOutcomeKind;
      readonly occurredOn: string;
      readonly transactionId: string | null;
    }[];
  }): Promise<void> {
    if (input.outcomes.length === 0) return;
    await this.deps.uow.run(input.workspaceId, () =>
      this.deps.outcomes.insertMany(
        input.workspaceId,
        input.outcomes.map((o): CategorySuggestionOutcomeRecord => ({
          id: this.deps.ids.next(),
          surface: input.surface,
          level: o.level,
          outcome: o.outcome,
          occurredOn: o.occurredOn,
          importJobId: input.importJobId,
          transactionId: o.transactionId,
        })),
      ),
    );
  }

  /** `recordCategorySuggestionOutcome`: el alta manual informa si el usuario aceptó, corrigió o ignoró la sugerencia. */
  async recordManualOutcome(workspaceId: string, cmd: CategorySuggestionFeedbackCommand): Promise<void> {
    if (cmd.surface !== 'MANUAL_ENTRY') throw invalid('surface must be MANUAL_ENTRY', '/surface');
    if (cmd.level !== 'HIGH' && cmd.level !== 'MEDIUM')
      throw invalid('level must be HIGH or MEDIUM', '/level');
    if (typeof cmd.suggestedCategoryId !== 'string' || cmd.suggestedCategoryId === '') {
      throw invalid('suggestedCategoryId is required', '/suggestedCategoryId');
    }
    const chosen = cmd.chosenCategoryId ?? null;
    if (chosen !== null && typeof chosen !== 'string') {
      throw invalid('chosenCategoryId must be an id or null', '/chosenCategoryId');
    }
    const transactionId = cmd.transactionId ?? null;
    if (transactionId !== null && typeof transactionId !== 'string') {
      throw invalid('transactionId must be an id', '/transactionId');
    }
    const outcome: CategorySuggestionOutcomeKind =
      chosen === null ? 'IGNORED' : chosen === cmd.suggestedCategoryId ? 'ACCEPTED' : 'CORRECTED';
    const occurredOn = await this.deps.uow.run(workspaceId, () => this.deps.calendar.today(workspaceId));
    await this.recordBatch({
      workspaceId,
      surface: 'MANUAL_ENTRY',
      importJobId: null,
      outcomes: [{ level: cmd.level, outcome, occurredOn, transactionId }],
    });
  }

  /** `getCategorySuggestionStats`: mostradas, aceptadas, corregidas, ignoradas y tasa de aceptación del rango. */
  async stats(workspaceId: string, from: unknown, to: unknown): Promise<CategorySuggestionStats> {
    const day = /^\d{4}-\d{2}-\d{2}$/u;
    if (typeof from !== 'string' || !day.test(from) || typeof to !== 'string' || !day.test(to)) {
      throw new DomainError('INVALID_FILTER', 'from and to must be YYYY-MM-DD dates').at('/from');
    }
    const span = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS;
    if (!(span >= 0) || span + 1 > CATEGORY_SUGGEST_STATS_MAX_DAYS) {
      throw new DomainError(
        'INVALID_FILTER',
        `the range must go forward and span at most ${CATEGORY_SUGGEST_STATS_MAX_DAYS} days`,
      ).at('/to');
    }
    const rows = await this.deps.uow.run(workspaceId, () =>
      this.deps.outcomes.aggregate(workspaceId, from, to),
    );
    const total = countsOf(rows);
    const surfaces: CategorySuggestionSurface[] = ['MANUAL_ENTRY', 'IMPORT'];
    const levels: CategorySuggestionLevel[] = ['HIGH', 'MEDIUM'];
    return {
      from,
      to,
      ...total,
      acceptanceRate: rate(total.accepted, total.shown),
      bySurface: surfaces.map((surface) => ({
        surface,
        ...countsOf(rows.filter((r) => r.surface === surface)),
      })),
      byLevel: levels.map((level) => ({ level, ...countsOf(rows.filter((r) => r.level === level)) })),
    };
  }

  // ----------------------------------------------------------------- backtesting (D477)

  /**
   * Backtesting temporal sin efectos: para cada uno de los últimos `months` meses (≥ 3) arma el índice con el historial
   * hasta el fin del mes anterior, con los mismos límites que en producción, y compara la sugerencia con la categoría
   * que el usuario eligió en las transacciones del mes. `asOf` (`YYYY-MM`) es el último mes incluido; por omisión, el
   * último mes completo. Informa precisión y cobertura sin descripciones ni montos.
   */
  async backtest(
    workspaceId: string,
    input: { readonly months: number; readonly asOf?: string },
  ): Promise<BacktestReport> {
    if (!Number.isInteger(input.months) || input.months < BACKTEST_MIN_MONTHS || input.months > 60) {
      throw invalid(
        `months must be an integer between ${BACKTEST_MIN_MONTHS} and 60 (at least ${BACKTEST_MIN_MONTHS} months are needed)`,
        '/months',
      );
    }
    if (input.asOf !== undefined && !/^\d{4}-(0[1-9]|1[0-2])$/u.test(input.asOf)) {
      throw invalid('asOf must be YYYY-MM', '/asOf');
    }
    return this.deps.uow.run(workspaceId, async () => {
      let asOf = input.asOf;
      if (asOf === undefined) {
        const today = await this.deps.calendar.today(workspaceId);
        asOf = monthOf(addDays(`${today.slice(0, 7)}-01`, -1));
      }
      const months: string[] = [];
      for (let i = input.months - 1; i >= 0; i -= 1) months.push(shiftMonth(asOf, -i));

      const slices: BacktestSlice[] = [];
      const level = new Map<CategorySuggestionLevel, { suggestions: number; hits: number }>();
      const basis = new Map<CategorySuggestionBasis, { suggestions: number; hits: number }>();
      let transactions = 0;
      let suggestions = 0;
      let hits = 0;
      let anyTruncated = false;
      for (const month of months) {
        const start = `${month}-01`;
        const end = addDays(`${shiftMonth(month, 1)}-01`, -1);
        const before = addDays(start, -1);
        const history = await this.loadIndex(workspaceId, {
          from: addDays(before, -this.settings.windowDays),
          to: before,
        });
        const page = await this.deps.subjects.listEvidence({
          workspaceId,
          from: start,
          to: end,
          limit: this.settings.maxEvidence,
        });
        const test = await this.usableEvidence(workspaceId, page.items);
        let monthSuggestions = 0;
        let monthHits = 0;
        for (const t of test) {
          const s = history.index.suggest(t, this.settings);
          if (!s) continue;
          monthSuggestions += 1;
          const hit = s.categoryId === t.categoryId;
          if (hit) monthHits += 1;
          for (const [map, key] of [
            [level, s.level],
            [basis, s.basis],
          ] as const) {
            const cell = (map as Map<string, { suggestions: number; hits: number }>).get(key) ?? {
              suggestions: 0,
              hits: 0,
            };
            cell.suggestions += 1;
            if (hit) cell.hits += 1;
            (map as Map<string, { suggestions: number; hits: number }>).set(key, cell);
          }
        }
        const truncated = history.truncated || page.truncated;
        anyTruncated ||= truncated;
        transactions += test.length;
        suggestions += monthSuggestions;
        hits += monthHits;
        slices.push({ month, truncated, ...backtestFigures(test.length, monthSuggestions, monthHits) });
      }
      const cellOf = (cell: { suggestions: number; hits: number }): BacktestCell => ({
        suggestions: cell.suggestions,
        hits: cell.hits,
        precision: backtestFigures(cell.suggestions, cell.suggestions, cell.hits).precision,
      });
      return {
        months: input.months,
        asOf,
        total: { month: null, truncated: anyTruncated, ...backtestFigures(transactions, suggestions, hits) },
        byMonth: slices,
        byLevel: (['HIGH', 'MEDIUM'] as const).map((l) => {
          const cell = level.get(l) ?? { suggestions: 0, hits: 0 };
          return { level: l, ...cellOf(cell) };
        }),
        byBasis: (['COUNTERPARTY', 'DESCRIPTION', 'BOTH'] as const).map((b) => {
          const cell = basis.get(b) ?? { suggestions: 0, hits: 0 };
          return { basis: b, ...cellOf(cell) };
        }),
      };
    });
  }
}

const monthOf = (date: string): string => date.slice(0, 7);

/** `YYYY-MM` desplazado `delta` meses. */
function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const index = y * 12 + (m - 1) + delta;
  return `${String(Math.floor(index / 12)).padStart(4, '0')}-${String((index % 12) + 1).padStart(2, '0')}`;
}
