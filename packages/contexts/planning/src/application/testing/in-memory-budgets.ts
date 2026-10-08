import type { CategoryTreeDto } from '@pf/classification/contracts';
import type {
  FxRateTypeDto,
  ResolvedRateDto,
  ValuationRateDto,
  WorkspaceCurrencyDto,
} from '@pf/fx/contracts';
import { DomainError, Instant } from '@pf/shared-kernel';
import type { NominalFlowRowDto } from '@pf/transactions/contracts';
import { PeriodQueries } from '../period.queries.js';
import {
  Budget,
  BudgetLine,
  BudgetTemplate,
  type BudgetLineState,
  type BudgetState,
  type BudgetTemplateState,
  type TemplateVersion,
} from '../../domain/index.js';
import type {
  BudgetRepository,
  BudgetTemplateRepository,
  BudgetsDeps,
  CrossingKey,
  ThresholdCrossingRepository,
  ThresholdCrossingRow,
} from '../ports/index.js';
import { InMemoryPlanning } from './in-memory.js';

export const BOB_USD_SCALE = 2;
const DAY_MS = 86_400_000;

interface StoredRate {
  readonly base: string;
  readonly quote: string;
  readonly asOf: Instant;
  readonly value: string;
  readonly rateType: FxRateTypeDto;
  readonly id: string;
}

/**
 * Dobles en memoria de los puertos de presupuestos (openspec add-budgets): reutiliza los periodos, el reloj, el outbox y
 * la auditoría de `InMemoryPlanning` y agrega planes, cruces de umbral, flujos nominales, árbol de CLASSIFICATION y un
 * valorador de tasas que respeta la ventana de vigencia. La "transacción" restaura también planes y cruces si el caso
 * de uso lanza (atomicidad de la unidad de trabajo).
 */
export class InMemoryBudgets {
  readonly mem = new InMemoryPlanning();
  readonly budgetRows = new Map<string, { state: BudgetState; lines: BudgetLineState[] }>();
  readonly crossingRows: ThresholdCrossingRow[] = [];
  readonly templateRows = new Map<string, { state: BudgetTemplateState; versions: TemplateVersion[] }>();
  readonly flowRows: NominalFlowRowDto[] = [];
  readonly rateRows: StoredRate[] = [];
  tree: CategoryTreeDto = { groups: [], categories: [], tags: [] };
  baseCurrency = 'BOB';
  windowDays = 7;
  flowCalls = 0;
  private inTx = false;
  private rateSeq = 0;

  readonly uow: BudgetsDeps['uow'] = {
    run: async (workspaceId, fn) => {
      if (this.inTx) return this.mem.uow.run(workspaceId, fn);
      const snapshot = {
        budgets: new Map([...this.budgetRows].map(([k, v]) => [k, { state: v.state, lines: [...v.lines] }])),
        crossings: this.crossingRows.length,
        templates: new Map(
          [...this.templateRows].map(([k, v]) => [k, { state: v.state, versions: [...v.versions] }]),
        ),
      };
      this.inTx = true;
      try {
        return await this.mem.uow.run(workspaceId, fn);
      } catch (err) {
        this.budgetRows.clear();
        for (const [k, v] of snapshot.budgets) this.budgetRows.set(k, v);
        this.crossingRows.length = snapshot.crossings;
        this.templateRows.clear();
        for (const [k, v] of snapshot.templates) this.templateRows.set(k, v);
        throw err;
      } finally {
        this.inTx = false;
      }
    },
  };

  readonly budgets: BudgetRepository = {
    findById: async (workspaceId, id) => {
      const row = this.budgetRows.get(id);
      return row && row.state.workspaceId === workspaceId ? this.restore(row) : null;
    },
    findByPeriod: async (workspaceId, periodId) => {
      const row = [...this.budgetRows.values()].find(
        (r) => r.state.workspaceId === workspaceId && r.state.periodId === periodId,
      );
      return row ? this.restore(row) : null;
    },
    listByTemplate: async (workspaceId, templateId) => {
      const versionIds = new Set((this.templateRows.get(templateId)?.versions ?? []).map((v) => v.id));
      return [...this.budgetRows.values()]
        .filter(
          (r) =>
            r.state.workspaceId === workspaceId &&
            r.state.templateVersionId !== null &&
            versionIds.has(r.state.templateVersionId),
        )
        .map((r) => this.restore(r));
    },
    listByPeriods: async (workspaceId, periodIds) =>
      [...this.budgetRows.values()]
        .filter((r) => r.state.workspaceId === workspaceId && periodIds.includes(r.state.periodId))
        .map((r) => this.restore(r)),
    insertIfAbsent: async (budget) => {
      const s = budget.snapshot;
      const dup = [...this.budgetRows.values()].some(
        (r) => r.state.workspaceId === s.workspaceId && r.state.periodId === s.periodId,
      );
      if (dup) return false;
      this.budgetRows.set(s.id, { state: s, lines: [] });
      return true;
    },
    save: async (budget) => {
      const row = this.budgetRows.get(budget.id);
      if (!row || row.state.version !== budget.persistedVersion) return false;
      row.state = budget.snapshot;
      return true;
    },
    insertLine: async (line) => {
      const row = this.budgetRows.get(line.snapshot.budgetId);
      if (!row) throw new Error('budget missing');
      const s = line.snapshot;
      if (row.lines.some((l) => l.target.kind === s.target.kind && l.target.id === s.target.id)) {
        throw new Error('budget_line_target_uk (23505)');
      }
      row.lines.push(s);
    },
    updateLine: async (line) => {
      const s = line.snapshot;
      const row = this.budgetRows.get(s.budgetId);
      const index = row ? row.lines.findIndex((l) => l.id === s.id) : -1;
      if (!row || index < 0 || row.lines[index]!.version !== line.persistedVersion) return false;
      row.lines[index] = s;
      return true;
    },
    deleteLine: async (_workspaceId, lineId) => {
      for (const row of this.budgetRows.values()) row.lines = row.lines.filter((l) => l.id !== lineId);
    },
  };

  private currentVersion(row: { state: BudgetTemplateState; versions: TemplateVersion[] }): TemplateVersion {
    return row.versions.find((v) => v.versionNo === row.state.currentVersionNo)!;
  }

  private templateOf(row: { state: BudgetTemplateState; versions: TemplateVersion[] }): BudgetTemplate {
    return BudgetTemplate.restore(row.state, this.currentVersion(row));
  }

  /** Doble en memoria con las barreras de BD: nombre activo único, un solo predeterminado, versiones inmutables. */
  readonly templates: BudgetTemplateRepository = {
    lockDefaults: async () => undefined,
    insert: async (template) => {
      const s = template.snapshot;
      const dup = [...this.templateRows.values()].some(
        (r) =>
          r.state.workspaceId === s.workspaceId &&
          r.state.status === 'ACTIVE' &&
          r.state.name.trim().toLowerCase() === s.name.trim().toLowerCase(),
      );
      if (dup) throw new DomainError('NAME_TAKEN', 'an active template already uses this name');
      this.templateRows.set(s.id, { state: s, versions: [template.currentVersion] });
    },
    insertCurrentVersion: async (template) => {
      const row = this.templateRows.get(template.id);
      if (!row) throw new Error('template missing');
      row.versions.push(template.currentVersion);
    },
    save: async (template) => {
      const row = this.templateRows.get(template.id);
      if (!row || row.state.version !== template.persistedVersion) return false;
      const s = template.snapshot;
      const clash = [...this.templateRows.values()].some(
        (r) =>
          r.state.id !== s.id &&
          r.state.workspaceId === s.workspaceId &&
          ((s.status === 'ACTIVE' &&
            r.state.status === 'ACTIVE' &&
            r.state.name.trim().toLowerCase() === s.name.trim().toLowerCase()) ||
            (s.isDefault && r.state.isDefault && r.state.status === 'ACTIVE')),
      );
      if (clash) throw new Error('budget_template unique violation (23505)');
      row.state = s;
      return true;
    },
    findById: async (workspaceId, id) => {
      const row = this.templateRows.get(id);
      return row && row.state.workspaceId === workspaceId ? this.templateOf(row) : null;
    },
    findActiveByName: async (workspaceId, name) => {
      const row = [...this.templateRows.values()].find(
        (r) =>
          r.state.workspaceId === workspaceId &&
          r.state.status === 'ACTIVE' &&
          r.state.name.trim().toLowerCase() === name.trim().toLowerCase(),
      );
      return row ? this.templateOf(row) : null;
    },
    findDefault: async (workspaceId) => {
      const row = [...this.templateRows.values()].find(
        (r) => r.state.workspaceId === workspaceId && r.state.isDefault && r.state.status === 'ACTIVE',
      );
      return row ? this.templateOf(row) : null;
    },
    list: async (workspaceId, status) =>
      [...this.templateRows.values()]
        .filter((r) => r.state.workspaceId === workspaceId && (!status || r.state.status === status))
        .map((r) => this.templateOf(r)),
    listVersions: async (workspaceId, templateId) => {
      const row = this.templateRows.get(templateId);
      if (!row || row.state.workspaceId !== workspaceId) return [];
      return [...row.versions]
        .sort((a, b) => b.versionNo - a.versionNo)
        .map((v) => ({
          versionNo: v.versionNo,
          basedOnVersionNo: v.basedOnVersionNo,
          changeNote: v.changeNote,
          createdAt: v.createdAt,
          createdBy: v.createdBy,
          lineCount: v.lines.length,
        }));
    },
    findVersion: async (workspaceId, templateId, versionNo) => {
      const row = this.templateRows.get(templateId);
      if (!row || row.state.workspaceId !== workspaceId) return null;
      return row.versions.find((v) => v.versionNo === versionNo) ?? null;
    },
    versionRef: async (workspaceId, versionId) => {
      for (const row of this.templateRows.values()) {
        const v = row.versions.find((x) => x.id === versionId);
        if (v && row.state.workspaceId === workspaceId) {
          return {
            versionId,
            templateId: row.state.id,
            versionNo: v.versionNo,
            templateName: row.state.name,
          };
        }
      }
      return null;
    },
  };

  readonly crossings: ThresholdCrossingRepository = {
    list: async (workspaceId, periodId): Promise<readonly CrossingKey[]> =>
      this.crossingRows
        .filter((c) => c.workspaceId === workspaceId && c.periodId === periodId)
        .map((c) => ({ targetKind: c.targetKind, targetId: c.targetId, threshold: c.threshold })),
    insertIfAbsent: async (rows) => {
      const inserted: string[] = [];
      for (const r of rows) {
        const dup = this.crossingRows.some(
          (c) =>
            c.workspaceId === r.workspaceId &&
            c.periodId === r.periodId &&
            c.targetKind === r.targetKind &&
            c.targetId === r.targetId &&
            c.threshold === r.threshold,
        );
        if (dup) continue;
        this.crossingRows.push(r);
        inserted.push(r.threshold);
      }
      return inserted;
    },
  };

  private restore(row: { state: BudgetState; lines: BudgetLineState[] }): Budget {
    return Budget.restore(
      row.state,
      row.lines.map((l) => BudgetLine.restore(l)),
    );
  }

  // ---------------------------------------------------------------- escenario

  /** Registra flujos nominales (ya agregados por fecha, moneda, naturaleza y categoría, neto de reembolsos). */
  flow(
    businessDate: string,
    nature: 'INCOME' | 'EXPENSE',
    categoryId: string,
    amount: string,
    currency = 'BOB',
    tagIds?: readonly string[],
  ): void {
    this.flowRows.push({
      businessDate,
      nature,
      categoryId,
      amount: { amount, currency },
      ...(tagIds ? { tagIds } : {}),
    });
  }

  /** Tasa de valoración `base/quote` vigente desde `asOf` (instante). */
  rate(base: string, quote: string, asOf: string, value: string, rateType: FxRateTypeDto = 'PARALLEL'): void {
    this.rateRows.push({
      base,
      quote,
      asOf: Instant.parse(asOf),
      value,
      rateType,
      id: `rate-${(this.rateSeq += 1)}`,
    });
  }

  private resolve(base: string, quote: string, at: string, windowDays: number): ValuationRateDto | null {
    const instant = Instant.parse(at);
    const candidates = this.rateRows
      .filter(
        (r) =>
          r.base === base &&
          r.quote === quote &&
          r.asOf.epochMillis <= instant.epochMillis &&
          instant.epochMillis - r.asOf.epochMillis <= windowDays * DAY_MS,
      )
      .sort((a, b) => b.asOf.epochMillis - a.asOf.epochMillis);
    const best = candidates[0];
    if (!best) return null;
    const resolved: ResolvedRateDto = {
      rate: { base, quote, value: best.value },
      fxRateId: best.id,
      derivation: 'DIRECT',
      components: [{ id: best.id }],
      rateType: best.rateType,
      requestedRateType: best.rateType,
      source: 'PROVIDER',
      sourceLabel: 'paralelo.bo',
      asOf: best.asOf.toString(),
      ageDays: 0,
      ageSeconds: 0,
      approx: false,
      provider: 'PARALELO_BO',
      selection: 'PRIMARY',
      stale: false,
      attribution: null,
    };
    return { resolved, exact: { base, quote, value: best.value } };
  }

  readonly currencies: readonly WorkspaceCurrencyDto[] = [
    { code: 'BOB', kind: 'FIAT', scale: 2, enabled: true },
    { code: 'USD', kind: 'FIAT', scale: 2, enabled: true },
    { code: 'EUR', kind: 'FIAT', scale: 2, enabled: true },
  ];

  readonly editGuard = new PeriodQueries({
    uow: this.mem.uow,
    periods: this.mem.repository,
    calendar: this.mem.calendar,
    clock: this.mem.clock,
  });

  deps(overrides: Partial<BudgetsDeps> = {}): BudgetsDeps {
    const base = this.mem.deps();
    return {
      uow: this.uow,
      periods: this.mem.repository,
      budgets: this.budgets,
      templates: this.templates,
      crossings: this.crossings,
      calendar: this.mem.calendar,
      settings: { settingsOf: async () => ({ baseCurrency: this.baseCurrency, timeZone: 'America/La_Paz' }) },
      flows: {
        summarizeNominalFlows: async ({ dateFrom, dateTo, categoryIds, withTags }) => {
          this.flowCalls += 1;
          return this.flowRows
            .filter((f) => f.businessDate >= dateFrom && f.businessDate <= dateTo)
            .filter((f) => categoryIds === undefined || categoryIds.includes(f.categoryId))
            .map((f): NominalFlowRowDto => {
              const { tagIds, ...rest } = f;
              return withTags ? { ...rest, tagIds: tagIds ?? [] } : rest;
            });
        },
      },
      catalog: { categoryTree: async () => this.tree },
      rates: {
        windowDays: this.windowDays,
        resolveValuationRates: async ({ requests, windowDays }) =>
          requests.map((r) => this.resolve(r.base, r.quote, r.at, windowDays ?? this.windowDays)),
        enabledCurrencies: async () => this.currencies.filter((c) => c.enabled),
        workspaceCurrencies: async () => this.currencies,
      },
      guard: this.editGuard,
      outbox: base.outbox,
      audit: base.audit,
      actor: { userId: () => '' },
      ids: base.ids,
      clock: this.mem.clock,
      rateValidityWindowDays: this.windowDays,
      ...overrides,
    };
  }
}
