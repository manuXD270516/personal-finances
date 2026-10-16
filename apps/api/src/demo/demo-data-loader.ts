import { createAuditRuntime, type AuditPort } from '@pf/audit/interface/audit.module';
import {
  DEMO_ACTOR_PROCESS,
  identityWorkspaceTimeZones,
  type DemoDataService,
  type DemoLoadJob,
} from '@pf/identity/interface/identity.module';
import type { LedgerMaintenance } from '@pf/ledger/interface/ledger.module';
import { PgUnitOfWork, runWithRequestContext } from '@pf/platform/api';
import type { ApiConfig } from '@pf/platform/config';
import { PgOutboxWriter, type OutboxWriter } from '@pf/platform/events';
import type { Logger } from '@pf/platform/logging';
import { FixedClock, Instant, systemClock } from '@pf/shared-kernel';
import type { Pool } from 'pg';
import { AUDIT_POLICIES, financeRuntimes, LIFECYCLE_MACHINES } from '../identity/identity-wiring.js';
import { eventSchemaRegistry } from '../runtime/event-contracts.js';
import {
  buildDemoPlan,
  DEMO_MANIFEST,
  summarizeDemoPlan,
  toDecimal,
  type AccountKey,
  type CategoryRef,
  type DemoKeys,
  type DemoMoney,
  type DemoOp,
  type DemoPlan,
} from './dataset/demo-plan.js';
import golden from './dataset/golden-summary.json' with { type: 'json' };
import type { LoanKey, ModuleOp } from './dataset/module-ops.js';
import { summarizeModules } from './dataset/module-summary.js';
import { DemoModuleError, DemoModuleExecutor } from './demo-module-executor.js';
import { verifyModules } from './demo-verification.js';
import { applyPlanOp, noon, startOfDay } from './plan-executor.js';

export interface DemoDataLoaderOptions {
  /** Pool del proceso (worker: `pf_worker`; seed CLI: `pf_app`). */
  readonly pool: Pool;
  readonly logger: Logger;
  readonly demo: DemoDataService;
  readonly config: Pick<ApiConfig, 'APP_TIMEZONE'> & Parameters<typeof financeRuntimes>[0]['config'];
  /** Verificador de invariantes del ledger (worker); el seed CLI (pf_app) usa solo el balance de comprobación. */
  readonly ledgerMaintenance?: Pick<LedgerMaintenance, 'verifyLedgerIntegrity'>;
  /** Tests: falla inyectada al empezar un lote (`<módulo>/<YYYY-MM>`, p. ej. `transactions/2025-06`). */
  readonly failAt?: string;
}

export type DemoLoadOutcome = 'READY' | 'FAILED' | 'SKIPPED';

class DemoLoadError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'DemoLoadError';
  }
}

const dto = (m: DemoMoney) => ({ amount: toDecimal(m), currency: m.currency });

/** Reloj de los ticks de la ancla y de la verificación final: la tarde del día A en la zona del workspace. */
const endOfAnchor = (date: string) => Instant.parse(`${date}T23:00:00.000Z`);

/** Operaciones de módulo (v2): las ejecuta `DemoModuleExecutor`; el resto es de `applyPlanOp`. */
const MODULE_OPS: ReadonlySet<string> = new Set([
  'subscription',
  'subscriptionPrice',
  'subscriptionStatus',
  'recurring',
  'occurrence',
  'card',
  'installments',
  'loan',
  'loanPayment',
  'loanPrepayment',
  'goal',
  'goalPlan',
  'goalMovement',
  'notificationPrefs',
  'tick',
]);
const isModuleOp = (op: DemoOp): op is ModuleOp => MODULE_OPS.has(op.op);

/** Módulo del dataset al que pertenece una operación (progreso y `failAt` por lote). */
function moduleOf(op: ModuleOp): 'commitments' | 'debt' | 'goals' {
  switch (op.op) {
    case 'subscription':
    case 'subscriptionPrice':
    case 'subscriptionStatus':
    case 'recurring':
    case 'notificationPrefs':
      return 'commitments';
    case 'card':
    case 'installments':
    case 'loan':
    case 'loanPayment':
    case 'loanPrepayment':
      return 'debt';
    case 'goal':
    case 'goalPlan':
    case 'goalMovement':
      return 'goals';
    case 'occurrence':
      return op.target.type === 'goalPlan'
        ? 'goals'
        : op.target.type === 'cardPayment'
          ? 'debt'
          : 'commitments';
    case 'tick':
      return op.runner === 'cards' ? 'debt' : op.runner === 'goals' ? 'goals' : 'commitments';
  }
}

/**
 * `DemoDataLoader` (job `demo.load`; openspec add-demo-data design.md decisión 2): ejecuta el plan determinista del
 * dataset Demo con los MISMOS casos de uso públicos que la API (Classification, Accounts, FX, Transactions), con un
 * reloj simulado posicionado en cada fecha y en lotes por mes (una transacción por lote). La auditoría y los eventos de
 * los comandos llevan el actor técnico `system:demo`; el contexto RLS es el del OWNER que pidió la carga (único miembro
 * del workspace demo). Al final verifica el golden summary y las invariantes del ledger del workspace y marca
 * `READY`; ante cualquier error, `FAILED` (nunca READY con datos parciales).
 */
export class DemoDataLoader {
  constructor(private readonly options: DemoDataLoaderOptions) {}

  async load(job: DemoLoadJob): Promise<DemoLoadOutcome> {
    const { demo, logger } = this.options;
    const log = logger.child({
      'demo.workspace_id': job.demoWorkspaceId,
      'demo.dataset': job.datasetVersion,
    });
    return runWithRequestContext(
      { actor: { type: 'USER', userId: job.requestedBy }, origin: 'system' },
      async (): Promise<DemoLoadOutcome> => {
        if (!(await demo.beginDemoLoad(job))) {
          log.warn('demo load skipped (not LOADING or interrupted)');
          return 'SKIPPED';
        }
        const started = process.hrtime.bigint();
        try {
          if (job.datasetVersion !== DEMO_MANIFEST.datasetVersion) {
            throw new DemoLoadError('DEMO_DATASET_UNKNOWN', `dataset ${job.datasetVersion} not available`);
          }
          await this.execute(job, buildDemoPlan(job.anchorDate));
          await demo.markDemoLoaded(job);
          const ms = Number((process.hrtime.bigint() - started) / 1_000_000n);
          log.info({ 'demo.duration_ms': ms }, 'demo data loaded');
          return 'READY';
        } catch (err) {
          const code =
            err instanceof DemoLoadError || err instanceof DemoModuleError ? err.code : 'DEMO_LOAD_FAILED';
          log.error(
            {
              err: {
                type: err instanceof Error ? err.name : typeof err,
                message: String((err as Error)?.message),
              },
            },
            'demo data load failed',
          );
          await demo.markDemoFailed(job, code);
          return 'FAILED';
        }
      },
    );
  }

  private async execute(job: DemoLoadJob, plan: DemoPlan<DemoKeys, DemoOp>): Promise<void> {
    const { pool, logger, config, demo } = this.options;
    const ws = job.demoWorkspaceId;
    const user = job.requestedBy;
    const clock = new FixedClock(noon(plan.startDate));
    // Auditoría con el reloj real (particiones mensuales vigentes) y actor técnico; eventos con actor `system:demo`.
    const audit = createAuditRuntime({
      pool,
      clock: systemClock,
      policies: AUDIT_POLICIES,
      timeZones: identityWorkspaceTimeZones(pool),
      machines: LIFECYCLE_MACHINES,
    });
    const demoAudit: AuditPort = {
      append: (entry) =>
        audit.port.append({
          ...entry,
          actor: { type: 'SYSTEM', process: DEMO_ACTOR_PROCESS },
          origin: 'system',
        }),
    };
    const writer = new PgOutboxWriter(eventSchemaRegistry());
    const demoOutbox: OutboxWriter = {
      append: (draft) => writer.append({ ...draft, actor: { type: 'SYSTEM', id: DEMO_ACTOR_PROCESS } }),
    };
    const r = financeRuntimes({
      pool,
      clock,
      audit: demoAudit,
      // Recorrido (add-lifecycle-timeline): las transiciones del demo se registran con el mismo actor técnico.
      lifecycle: audit.lifecycleFor(demoAudit),
      lifecycleQuery: audit.lifecycleQuery,
      history: audit.history,
      logger,
      config,
      outbox: demoOutbox,
    });
    const uow = new PgUnitOfWork(pool);
    const inDemo = <T>(fn: () => Promise<T>) => uow.run({ userId: user, workspaceId: ws }, fn);
    const completed: string[] = [];
    const progress = async (module: string) => {
      completed.push(module);
      await demo.recordDemoProgress(job, {
        completedModules: [...completed],
        totalModules: DEMO_MANIFEST.modules.length,
      });
    };
    // El workspace (identity) ya existe: lo creó `RequestDemoData`. Desde aquí, un reintento NO reanuda.
    this.maybeFail('identity');
    await progress('identity');

    // ── classification: contrapartes, etiquetas y resolución de categorías del catálogo es-BO.v1.
    this.maybeFail('classification');
    const counterparties = new Map<string, string>();
    const tags = new Map<string, string>();
    const categories = new Map<string, string>();
    const systemCategories = new Map<string, string>();
    await inDemo(async () => {
      for (const cp of plan.counterparties) {
        const created = await r.classification.service.createCounterparty(user, ws, {
          name: cp.name,
          kind: cp.kind,
          notes: 'Contraparte ficticia (datos de demostración)',
        });
        counterparties.set(cp.key, created.id);
      }
      for (const tag of plan.tags) {
        tags.set(tag.key, (await r.classification.service.createTag(user, ws, { name: tag.name })).id);
      }
      for (const c of await r.classification.queries.listCategories(user, ws)) {
        if (!categories.has(c.name)) categories.set(c.name, c.id);
      }
      for (const code of ['INTEREST', 'FX_FEES'] as const) {
        const id = await r.classification.queries.systemCategoryId(user, ws, code);
        if (!id) throw new DemoLoadError('DEMO_LOAD_FAILED', `system category ${code} not provisioned`);
        systemCategories.set(code, id);
      }
    });
    const category = (ref: CategoryRef): string => {
      const id = 'name' in ref ? categories.get(ref.name) : systemCategories.get(ref.system);
      if (!id) throw new DemoLoadError('DEMO_LOAD_FAILED', `category ${JSON.stringify(ref)} not found`);
      return id;
    };
    await progress('classification');

    // ── accounts: instituciones y cuentas con saldo de apertura (asiento OPENING por el caso de uso).
    this.maybeFail('accounts');
    const accounts = new Map<AccountKey, string>();
    const institutions = new Map<string, string>();
    await inDemo(async () => {
      for (const inst of plan.institutions) {
        const created = await r.accounts.institutions.createInstitution({
          workspaceId: ws,
          name: inst.name,
          kind: inst.kind,
          countryCode: 'BO',
          notes: 'Institución ficticia (datos de demostración)',
        });
        institutions.set(inst.key, created.id);
      }
      // docs/31 D45: la moneda de cada cuenta debe estar habilitada en el workspace (p. ej. BTC, fuera del conjunto
      // por defecto BOB/USD/USDT); mismo caso de uso de FX, idempotente.
      await r.fx.service.enableCurrencies({
        workspaceId: ws,
        codes: [...new Set(plan.accounts.map((a) => a.currency))],
      });
      for (const a of plan.accounts) {
        clock.set(noon(a.openedOn));
        const view = await r.accounts.accounts.openAccount({
          workspaceId: ws,
          name: a.name,
          type: a.type,
          currency: a.currency,
          institutionId: a.institution ? (institutions.get(a.institution) ?? null) : null,
          openedOn: a.openedOn,
          openingBalance: a.opening ? { amount: dto(a.opening), date: a.openedOn } : null,
          accountNumberLast4: a.last4,
          notes: a.reference,
        });
        accounts.set(a.key, view.account.id);
      }
    });
    const account = (key: AccountKey): string => accounts.get(key) as string;
    await progress('accounts');

    // ── fx + transactions + commitments + debt + goals: lotes por mes (una transacción BD por mes). Las operaciones de
    //    módulo usan los casos de uso públicos de su contexto con el reloj simulado (design.md decisiones 2 y 3).
    const recorded = new Map<string, { id: string; version: number }>();
    const loanAccounts = new Map<LoanKey, string>();
    const executor = new DemoModuleExecutor({
      r,
      ws,
      user,
      account,
      category,
      counterparties,
      institutions,
      recorded,
      loanAccounts,
    });
    const at = (date: string) => (date === plan.anchorDate ? startOfDay(date) : noon(date));
    // TODA la ejecución del plan corre en UNA unidad de trabajo: los hechos del outbox solo se publican al confirmar,
    // así los consumidores asíncronos (tarjetas, suscripciones, metas, periodos) no compiten por los mismos bloqueos
    // con el cargador (deadlocks) y una falla a mitad de la carga no deja datos parciales (`FAILED`, nunca `READY`).
    await inDemo(async () => {
      for (const month of plan.months) {
        this.maybeFail(`transactions/${month.month}`);
        for (const mod of ['commitments', 'debt', 'goals'] as const) {
          if (month.ops.some((op) => isModuleOp(op) && moduleOf(op) === mod)) {
            this.maybeFail(`${mod}/${month.month}`);
          }
        }
        for (const op of month.ops) {
          clock.set(op.op === 'tick' && op.late ? endOfAnchor(op.date) : at(op.date));
          if (isModuleOp(op)) await executor.apply(op);
          else
            await applyPlanOp<DemoKeys>(op, {
              r,
              ws,
              user,
              account,
              category,
              counterparties,
              tags,
              recorded,
            });
        }
      }
      // Resumen estructural por módulo (cualquier ancla) con el reloj simulado al final del día A (decisión 9).
      clock.set(endOfAnchor(plan.anchorDate));
      const ids = executor.idsOf();
      await verifyModules({
        r,
        ws,
        anchor: plan.anchorDate,
        summary: summarizeModules(plan.anchorDate),
        cards: ids.cards,
        loans: ids.loans,
        goals: ids.goals,
      });
    });
    await progress('fx');
    await progress('transactions');
    await progress('commitments');
    await progress('debt');
    await progress('goals');

    // ── ledger: golden summary + invariantes (Σ = 0 por moneda) acotadas al workspace demo.
    this.maybeFail('ledger');
    const expected = summarizeDemoPlan(plan);
    // Con la ancla fija, el resumen de referencia del dataset (`golden-summary.json`); con otra ancla los saldos
    // dependen de cuántas ocurrencias y ciclos caen en la ventana y solo se comparan contra el oráculo del plan.
    if (
      plan.anchorDate === DEMO_MANIFEST.anchorDate &&
      JSON.stringify(expected.balances) !== JSON.stringify(golden.balances)
    ) {
      throw new DemoLoadError(
        'DEMO_GOLDEN_MISMATCH',
        'the dataset generator does not match its golden summary',
      );
    }
    const actual = await inDemo(() => r.accounts.accounts.listAccounts({ workspaceId: ws }));
    const balanceTargets: [string, string][] = [
      ...plan.accounts.map((a): [string, string] => [a.key, account(a.key)]),
      ...[...loanAccounts].map(([key, id]): [string, string] => [`loan_${key}`, id]),
    ];
    for (const [key, id] of balanceTargets) {
      const view = actual.data.find((v) => v.account.id === id);
      const wanted = (expected.balances as Record<string, string>)[key];
      if (view?.balance.amount !== wanted) {
        throw new DemoLoadError(
          'DEMO_GOLDEN_MISMATCH',
          `balance of ${key}: expected ${String(wanted)}, got ${String(view?.balance.amount)}`,
        );
      }
    }
    const trial = await inDemo(() => r.ledger.balances.getTrialBalance({ workspaceId: ws }));
    for (const c of trial.currencies) {
      if (!/^0(\.0+)?$/.test(c.total.amount.replace('-', ''))) {
        throw new DemoLoadError(
          'DEMO_LEDGER_INVARIANT',
          `trial balance in ${c.currency} is ${c.total.amount}`,
        );
      }
    }
    if (this.options.ledgerMaintenance) {
      const { violations } = await this.options.ledgerMaintenance.verifyLedgerIntegrity();
      if (violations.some((v) => v.workspaceId === ws)) {
        throw new DemoLoadError('DEMO_LEDGER_INVARIANT', 'ledger invariant violations in the demo workspace');
      }
    }
    await progress('ledger');
  }

  private maybeFail(step: string): void {
    if (this.options.failAt === step)
      throw new DemoLoadError('DEMO_LOAD_FAILED', `injected failure at ${step}`);
  }
}
