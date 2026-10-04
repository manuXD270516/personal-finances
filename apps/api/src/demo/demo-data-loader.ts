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
  type DemoMoney,
  type DemoOp,
  type DemoPlan,
} from './dataset/demo-plan.js';
import golden from './dataset/golden-summary.json' with { type: 'json' };

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

const noon = (date: string): Instant => Instant.parse(`${date}T16:00:00.000Z`);
const dto = (m: DemoMoney) => ({ amount: toDecimal(m), currency: m.currency });

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
          const code = err instanceof DemoLoadError ? err.code : 'DEMO_LOAD_FAILED';
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

  private async execute(job: DemoLoadJob, plan: DemoPlan): Promise<void> {
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
    await inDemo(async () => {
      const institutions = new Map<string, string>();
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

    // ── fx + transactions: lotes por mes (una transacción BD por mes).
    const recorded = new Map<string, { id: string; version: number }>();
    for (const month of plan.months) {
      this.maybeFail(`transactions/${month.month}`);
      await inDemo(async () => {
        for (const op of month.ops) {
          clock.set(noon(op.date));
          await this.apply(op, { r, ws, user, account, category, counterparties, tags, recorded });
        }
      });
    }
    await progress('fx');
    await progress('transactions');

    // ── ledger: golden summary + invariantes (Σ = 0 por moneda) acotadas al workspace demo.
    this.maybeFail('ledger');
    const expected = summarizeDemoPlan(plan);
    if (JSON.stringify(expected.balances) !== JSON.stringify(golden.balances)) {
      throw new DemoLoadError(
        'DEMO_GOLDEN_MISMATCH',
        'the dataset generator does not match its golden summary',
      );
    }
    const actual = await inDemo(() => r.accounts.accounts.listAccounts({ workspaceId: ws }));
    for (const a of plan.accounts) {
      const view = actual.data.find((v) => v.account.id === account(a.key));
      if (view?.balance.amount !== expected.balances[a.key]) {
        throw new DemoLoadError(
          'DEMO_GOLDEN_MISMATCH',
          `balance of ${a.key}: expected ${expected.balances[a.key]}, got ${String(view?.balance.amount)}`,
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

  private async apply(
    op: DemoOp,
    ctx: {
      readonly r: ReturnType<typeof financeRuntimes>;
      readonly ws: string;
      readonly user: string;
      readonly account: (key: AccountKey) => string;
      readonly category: (ref: CategoryRef) => string;
      readonly counterparties: ReadonlyMap<string, string>;
      readonly tags: ReadonlyMap<string, string>;
      readonly recorded: Map<string, { id: string; version: number }>;
    },
  ): Promise<void> {
    const { r, ws, user, account, category, counterparties, tags, recorded } = ctx;
    const tx = r.transactions.service;
    const ref = (key: string) => {
      const found = recorded.get(key);
      if (!found) throw new DemoLoadError('DEMO_LOAD_FAILED', `unknown demo transaction ${key}`);
      return found;
    };
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
            name: op.from === 'usdt' || op.to === 'usdt' ? 'P2P Exchange Demo' : 'Banco Andino Demo',
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

  private maybeFail(step: string): void {
    if (this.options.failAt === step)
      throw new DemoLoadError('DEMO_LOAD_FAILED', `injected failure at ${step}`);
  }
}
