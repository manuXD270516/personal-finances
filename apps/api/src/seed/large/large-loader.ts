import { createAuditRuntime, type AuditPort } from '@pf/audit/interface/audit.module';
import { identityWorkspaceTimeZones } from '@pf/identity/interface/identity.module';
import { PgUnitOfWork, runWithRequestContext } from '@pf/platform/api';
import { PgOutboxWriter, type OutboxWriter } from '@pf/platform/events';
import type { Logger } from '@pf/platform/logging';
import { FixedClock, systemClock } from '@pf/shared-kernel';
import type { Pool } from 'pg';
import { toDecimal, type CategoryRef, type DemoMoney } from '../../demo/dataset/demo-plan.js';
import { applyPlanOp, noon, PlanLoadError } from '../../demo/plan-executor.js';
import { AUDIT_POLICIES, financeRuntimes, LIFECYCLE_MACHINES } from '../../identity/identity-wiring.js';
import { eventSchemaRegistry } from '../../runtime/event-contracts.js';
import { summarizeLargeWorkspace, type LargeWorkspacePlan } from './large-plan.js';

/** Actor técnico de la seed (docs/29 §3: "las mutaciones se ejecutan con un actor técnico `system:seed`"). */
export const SEED_ACTOR_PROCESS = 'system:seed';

export interface LargeLoaderOptions {
  /** Pool con el rol de la app (`pf_app`, RLS activa). */
  readonly pool: Pool;
  readonly logger: Logger;
  readonly config: Parameters<typeof financeRuntimes>[0]['config'];
}

export interface LargeWorkspaceReport {
  readonly workspaceId: string;
  readonly transactions: number;
  readonly operations: number;
  readonly durationMs: number;
  /** Clave del plan → id de transacción (para exportar las etiquetas de anomalías). */
  readonly transactionIds: ReadonlyMap<string, string>;
}

const dto = (m: DemoMoney) => ({ amount: toDecimal(m), currency: m.currency });
const elapsedMs = (started: bigint) => Number((process.hrtime.bigint() - started) / 1_000_000n);

/**
 * Carga un workspace del Large Seed (docs/29 §2.3) con los MISMOS casos de uso públicos que la API y el dataset Demo
 * (`applyPlanOp`): reloj simulado posicionado en cada fecha, un lote (transacción BD) por mes, auditoría y eventos con
 * el actor técnico `system:seed`, RLS con el contexto del owner. Al final verifica los saldos contra el resumen del
 * plan (aritmética entera) y que el balance de comprobación sume cero por moneda (INV-001).
 */
export async function loadLargeWorkspace(
  plan: LargeWorkspacePlan,
  ownerId: string,
  options: LargeLoaderOptions,
): Promise<LargeWorkspaceReport> {
  const { pool, logger, config } = options;
  const log = logger.child({ 'seed.workspace_id': plan.workspaceId, 'seed.profile': 'large' });
  return runWithRequestContext({ actor: { type: 'USER', userId: ownerId }, origin: 'system' }, async () => {
    const started = process.hrtime.bigint();
    const ws = plan.workspaceId;
    const user = ownerId;
    const clock = new FixedClock(noon(plan.startDate));
    const audit = createAuditRuntime({
      pool,
      clock: systemClock,
      policies: AUDIT_POLICIES,
      timeZones: identityWorkspaceTimeZones(pool),
      machines: LIFECYCLE_MACHINES,
    });
    const seedAudit: AuditPort = {
      append: (entry) =>
        audit.port.append({
          ...entry,
          actor: { type: 'SYSTEM', process: SEED_ACTOR_PROCESS },
          origin: 'system',
        }),
    };
    const writer = new PgOutboxWriter(eventSchemaRegistry());
    const seedOutbox: OutboxWriter = {
      append: (draft) => writer.append({ ...draft, actor: { type: 'SYSTEM', id: SEED_ACTOR_PROCESS } }),
    };
    const r = financeRuntimes({
      pool,
      clock,
      audit: seedAudit,
      lifecycle: audit.lifecycleFor(seedAudit),
      lifecycleQuery: audit.lifecycleQuery,
      history: audit.history,
      logger: log,
      config,
      outbox: seedOutbox,
    });
    const uow = new PgUnitOfWork(pool);
    const inWs = <T>(fn: () => Promise<T>) => uow.run({ userId: user, workspaceId: ws }, fn);

    // ── classification: contrapartes, etiquetas, categorías del catálogo + extra (≈ 120 en el principal).
    const counterparties = new Map<string, string>();
    const tags = new Map<string, string>();
    const categories = new Map<string, string>();
    const systemCategories = new Map<string, string>();
    await inWs(async () => {
      for (const cp of plan.counterparties) {
        const created = await r.classification.service.createCounterparty(user, ws, {
          name: cp.name,
          kind: cp.kind,
          notes: 'Contraparte ficticia (Large Seed)',
        });
        counterparties.set(cp.key, created.id);
      }
      for (const tag of plan.tags) {
        tags.set(tag.key, (await r.classification.service.createTag(user, ws, { name: tag.name })).id);
      }
      const existing = await r.classification.queries.listCategories(user, ws);
      for (const c of existing) if (!categories.has(c.name)) categories.set(c.name, c.id);
      for (const extra of plan.extraCategories) {
        const anchor = existing.find((c) => c.name === extra.groupOf);
        if (!anchor) throw new PlanLoadError('SEED_LOAD_FAILED', `category ${extra.groupOf} not provisioned`);
        const created = await r.classification.service.createCategory(user, ws, {
          groupId: anchor.groupId,
          name: extra.name,
        });
        categories.set(extra.name, created.id);
      }
      for (const code of ['INTEREST', 'FX_FEES'] as const) {
        const id = await r.classification.queries.systemCategoryId(user, ws, code);
        if (!id) throw new PlanLoadError('SEED_LOAD_FAILED', `system category ${code} not provisioned`);
        systemCategories.set(code, id);
      }
    });
    const category = (ref: CategoryRef): string => {
      const id = 'name' in ref ? categories.get(ref.name) : systemCategories.get(ref.system);
      if (!id) throw new PlanLoadError('SEED_LOAD_FAILED', `category ${JSON.stringify(ref)} not found`);
      return id;
    };

    // ── accounts: instituciones y cuentas con saldo de apertura (asiento OPENING por el caso de uso).
    const accounts = new Map<string, string>();
    await inWs(async () => {
      const institutions = new Map<string, string>();
      for (const inst of plan.institutions) {
        const created = await r.accounts.institutions.createInstitution({
          workspaceId: ws,
          name: inst.name,
          kind: inst.kind,
          countryCode: 'BO',
          notes: 'Institución ficticia (Large Seed)',
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
    const account = (key: string): string => {
      const id = accounts.get(key);
      if (!id) throw new PlanLoadError('SEED_LOAD_FAILED', `account ${key} not found`);
      return id;
    };

    // ── fx + transactions: un lote (transacción BD) por mes.
    const recorded = new Map<string, { id: string; version: number }>();
    const transactionIds = new Map<string, string>();
    let operations = 0;
    let transactions = 0;
    for (const month of plan.months) {
      const monthStarted = process.hrtime.bigint();
      await inWs(async () => {
        for (const op of month.ops) {
          clock.set(noon(op.date));
          await applyPlanOp(op, {
            r,
            ws,
            user,
            account,
            category,
            counterparties,
            tags,
            recorded,
            conversionProvider: (c) =>
              c.from.startsWith('usdt') || c.to.startsWith('usdt')
                ? 'P2P Exchange Demo'
                : 'Banco Andino Demo',
          });
          operations += 1;
          if (op.op !== 'rate' && op.op !== 'edit' && op.op !== 'void') transactions += 1;
          if ((op.op === 'income' || op.op === 'expense' || op.op === 'refund') && recorded.has(op.key))
            transactionIds.set(`${ws}/${op.key}`, recorded.get(op.key)!.id);
        }
      });
      log.debug(
        { 'seed.month': month.month, 'seed.ops': month.ops.length, 'seed.month_ms': elapsedMs(monthStarted) },
        'large seed month loaded',
      );
    }

    // ── verificación: saldos presentados del plan (aritmética entera) y balance de comprobación en cero.
    const expected = summarizeLargeWorkspace(plan);
    const actual = await inWs(() => r.accounts.accounts.listAccounts({ workspaceId: ws }));
    for (const a of plan.accounts) {
      const view = actual.data.find((v) => v.account.id === account(a.key));
      if (view?.balance.amount !== expected.balances[a.key]) {
        throw new PlanLoadError(
          'SEED_GOLDEN_MISMATCH',
          `balance of ${a.key}: expected ${expected.balances[a.key]}, got ${String(view?.balance.amount)}`,
        );
      }
    }
    const trial = await inWs(() => r.ledger.balances.getTrialBalance({ workspaceId: ws }));
    for (const c of trial.currencies) {
      if (!/^0(\.0+)?$/.test(c.total.amount.replace('-', ''))) {
        throw new PlanLoadError(
          'SEED_LEDGER_INVARIANT',
          `trial balance in ${c.currency} is ${c.total.amount}`,
        );
      }
    }
    const durationMs = elapsedMs(started);
    log.info(
      { 'seed.transactions': transactions, 'seed.operations': operations, 'seed.duration_ms': durationMs },
      'large seed workspace loaded',
    );
    return { workspaceId: ws, transactions, operations, durationMs, transactionIds };
  });
}
