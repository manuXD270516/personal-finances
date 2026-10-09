import type { AuditChangeInput, AuditEntry, LifecycleEventRefDto } from '@pf/audit/contracts';
import { DomainError, type FieldViolation } from '@pf/shared-kernel';
import { TRANSACTION_EVENTS } from '../contracts/index.js';
import {
  applyBulkToSplits,
  BULK_EDIT_MAX_ITEMS,
  bulkApplicability,
  parseBulkEditChanges,
  splitKindOf,
  Transaction,
  type BulkEditChanges,
  type ChangedField,
  type ResolvedCustomFieldPatch,
  type TransactionState,
} from '../domain/index.js';
import { buildEvent, transactionSteps } from './posting-support.js';
import type { OutboxEvent, TransactionsDeps } from './ports/index.js';
import {
  changedFieldName,
  diff,
  UPDATED_EVENT_FIELDS,
  type ListTransactionsQuery,
  type TransactionsService,
} from './transactions.service.js';

/** Un ítem del lote: la transacción y su versión esperada (equivale a `If-Match` por ítem, design decisión 2). */
export interface BulkEditItem {
  readonly id: string;
  readonly version: number;
}

export interface BulkEditCommand {
  readonly workspaceId: string;
  readonly userId: string;
  readonly items: readonly BulkEditItem[];
  /** Se valida con `parseBulkEditChanges`: cualquier propiedad fuera de la lista ⇒ `VALIDATION_FAILED`. */
  readonly changes: unknown;
}

/** Filtros de la vista previa: los mismos del listado de transacciones. */
export type BulkEditFilter = Omit<ListTransactionsQuery, 'workspaceId' | 'offset' | 'limit'>;

export interface PreviewBulkEditCommand {
  readonly workspaceId: string;
  readonly userId: string;
  readonly selection:
    { readonly items: readonly { readonly id: string }[] } | { readonly filter: BulkEditFilter };
  readonly changes: unknown;
}

export interface BulkEditPreviewItem {
  readonly id: string;
  /** Versión vigente (la que debe enviar la ejecución); `null` si la transacción no existe. */
  readonly version: number | null;
  readonly applicable: boolean;
  /** Códigos de error por los que el cambio no es aplicable (vacío si lo es). */
  readonly reasons: readonly string[];
}

export interface BulkEditPreview {
  /** Cantidad de transacciones de la vista previa (en la API, `total`). */
  readonly count: number;
  /** `true` si el filtro devuelve más de 500 transacciones (solo se informan las primeras 500). */
  readonly truncated: boolean;
  readonly items: readonly BulkEditPreviewItem[];
}

export interface BulkEditResult {
  readonly bulkOperationId: string;
  readonly data: readonly TransactionState[];
}

/**
 * Prioridad del código HTTP cuando varios ítems fallan (design decisión 3): 404 > 403 > 412 > 409 > 422; el estado de la
 * respuesta es el del error de mayor prioridad y `errors[]` lleva el código de cada ítem.
 */
const ERROR_PRIORITY: readonly string[] = [
  'RESOURCE_NOT_FOUND',
  'PRECONDITION_FAILED',
  'CONCURRENCY_CONFLICT',
  'PERIOD_CLOSED',
  'TRANSACTION_RECONCILED',
  'INVALID_STATUS_TRANSITION',
  'CATEGORY_ARCHIVED',
  'TAG_ARCHIVED',
  'COUNTERPARTY_ARCHIVED',
  'CUSTOM_FIELD_ARCHIVED',
  'BULK_EDIT_NOT_APPLICABLE',
  'CATEGORY_KIND_MISMATCH',
  'CUSTOM_FIELD_VALUE_INVALID',
  'CUSTOM_FIELD_REQUIRED',
  'CUSTOM_FIELD_TARGET_MISMATCH',
  'REFERENCE_NOT_FOUND',
  'VALIDATION_FAILED',
];
const priorityOf = (code: string): number => {
  const i = ERROR_PRIORITY.indexOf(code);
  return i === -1 ? ERROR_PRIORITY.length : i;
};

interface Problem {
  readonly code: string;
  readonly detail: string;
  readonly pointer: string;
}

interface Evaluation {
  readonly id: string;
  readonly tx: Transaction | null;
  readonly before: TransactionState | null;
  readonly problems: readonly Problem[];
  /** Resultado de aplicar los cambios en memoria (no persistido); `null` si hubo problemas. */
  readonly outcome: ReturnType<Transaction['bulkEdit']> | null;
  readonly changedFields: readonly ChangedField[];
}

/** Cachés por operación: cada validación de catálogo y cada fecha se consulta una sola vez, no una por ítem. */
class BulkContext {
  private readonly cache = new Map<string, Promise<DomainError | null>>();
  private readonly patches = new Map<string, Promise<ResolvedCustomFieldPatch | DomainError>>();

  constructor(
    readonly deps: TransactionsDeps,
    readonly userId: string,
    readonly workspaceId: string,
    readonly changes: BulkEditChanges,
  ) {}

  /** Ejecuta `run` una vez por clave y devuelve el `DomainError` (o `null` si es válido). */
  once(key: string, run: () => Promise<void>): Promise<DomainError | null> {
    let hit = this.cache.get(key);
    if (!hit) {
      hit = run().then(
        () => null,
        (err: unknown) => {
          if (err instanceof DomainError) return err;
          throw err;
        },
      );
      this.cache.set(key, hit);
    }
    return hit;
  }

  periodOpen(date: string): Promise<DomainError | null> {
    return this.once(`period:${date}`, () =>
      this.deps.ledger.assertPeriodOpen({ workspaceId: this.workspaceId, date }),
    );
  }

  /** Valida (una vez por tipo de split) la categoría pedida y, una sola vez, los tags a agregar y la contraparte. */
  async classification(kind: TransactionState['kind']): Promise<DomainError | null> {
    const c = this.changes;
    if (c.categoryId !== undefined) {
      const splitKind = splitKindOf(kind);
      const err = await this.once(`category:${splitKind}`, () =>
        this.deps.classification.validate({
          userId: this.userId,
          workspaceId: this.workspaceId,
          categoryIds: [{ categoryId: c.categoryId as string, splitKind }],
        }),
      );
      if (err) return err;
    }
    if ((c.addTagIds?.length ?? 0) > 0) {
      const err = await this.once('tags', () =>
        this.deps.classification.validate({
          userId: this.userId,
          workspaceId: this.workspaceId,
          tagIds: c.addTagIds as readonly string[],
        }),
      );
      if (err) return err;
    }
    if (c.counterpartyId) {
      const err = await this.once('counterparty', () =>
        this.deps.classification.validate({
          userId: this.userId,
          workspaceId: this.workspaceId,
          counterpartyId: c.counterpartyId as string,
        }),
      );
      if (err) return err;
    }
    return null;
  }

  /**
   * Valores de custom fields validados contra las definiciones (mismo puerto que la edición individual,
   * `requireMandatory` como allí: los obligatorios deben quedar con valor). Una vez por combinación de campos que la
   * transacción ya tiene.
   */
  customFields(
    existingFieldIds: readonly (readonly string[])[],
  ): Promise<ResolvedCustomFieldPatch | DomainError> {
    const key = JSON.stringify(existingFieldIds);
    let hit = this.patches.get(key);
    if (!hit) {
      const values = (this.changes.customFields ?? []).map((v) => ({
        ...(v.fieldId !== undefined ? { fieldId: v.fieldId } : {}),
        ...(v.key !== undefined ? { key: v.key } : {}),
        value: v.value,
      }));
      hit = this.deps.classification
        .validateCustomFieldValues({
          userId: this.userId,
          workspaceId: this.workspaceId,
          target: 'TRANSACTION',
          requireMandatory: true,
          items: existingFieldIds.map((ids, i) => ({
            pointer: `/splits/${i}/customFields`,
            values,
            existingFieldIds: ids,
          })),
        })
        .then(
          (results): ResolvedCustomFieldPatch => {
            const first = results[0] ?? { set: [], removeFieldIds: [] };
            return { set: first.set, removeFieldIds: first.removeFieldIds };
          },
          (err: unknown) => {
            if (err instanceof DomainError) return err;
            throw err;
          },
        );
      this.patches.set(key, hit);
    }
    return hit;
  }
}

/**
 * `BulkEditTransactions` y `PreviewBulkEdit` (openspec add-bulk-edit, FR-TRANSACTIONS-033): edición masiva de
 * clasificación (categoría, tags, contraparte, notas, custom fields) y del estado `cleared` de hasta 500
 * transacciones, TODO O NADA en una sola unidad de trabajo, con la versión de cada ítem, auditoría por transacción y
 * agregada con el mismo `bulkOperationId` (que es el `correlation_id` de todos los registros). Nunca toca montos,
 * cuentas, fechas ni el ledger (INV-033) y respeta los periodos cerrados con el alcance único de docs/33 D65.
 */
export class BulkEditService {
  constructor(
    private readonly deps: TransactionsDeps,
    private readonly transactions: TransactionsService,
  ) {}

  // ------------------------------------------------------------------ ejecución

  async bulkEdit(cmd: BulkEditCommand): Promise<BulkEditResult> {
    const { workspaceId, items } = cmd;
    if (items.length === 0 || items.length > BULK_EDIT_MAX_ITEMS) {
      throw new DomainError('VALIDATION_FAILED', `between 1 and ${BULK_EDIT_MAX_ITEMS} items`).at('/items');
    }
    const repeated = items.findIndex((x, i) => items.findIndex((y) => y.id === x.id) !== i);
    if (repeated >= 0) {
      throw new DomainError('VALIDATION_FAILED', 'an item appears more than once').at(
        `/items/${repeated}/id`,
      );
    }
    const changes = parseBulkEditChanges(cmd.changes);
    return this.deps.uow.run(workspaceId, async () => {
      // Todas las filas bloqueadas `FOR UPDATE` ordenadas por id (sin deadlocks entre operaciones masivas).
      const loaded = await this.deps.transactions.findMany(
        workspaceId,
        items.map((x) => x.id),
        { forUpdate: true },
      );
      const evaluations = await this.evaluate(cmd, changes, items, loaded);
      const problems = evaluations.flatMap((e) => e.problems);
      if (problems.length > 0) throw bulkError(problems);

      const bulkOperationId = this.deps.ids.next();
      const changed = evaluations.filter((e) => e.outcome && e.changedFields.length > 0);
      if (
        !(await this.deps.transactions.updateClassificationBatch(changed.map((e) => e.tx as Transaction)))
      ) {
        throw new DomainError('CONCURRENCY_CONFLICT', 'a transaction was modified concurrently');
      }
      // Se arma todo (eventos, auditoría y pasos del recorrido) y se escribe por lotes: una sentencia multi-fila por tabla
      // en lugar de varias por transacción (p95 ≤ 2 s con 500 ítems, design decisión 9).
      const prepared = changed.map((e) => this.prepare(e, bulkOperationId));
      const events = prepared.flatMap((p) => p.events);
      const { outbox, lifecycle } = this.deps;
      if (outbox.appendMany) await outbox.appendMany(events);
      else for (const ev of events) await outbox.append(ev);
      const records = prepared.map((p) => ({ entry: p.entry, steps: p.steps }));
      if (lifecycle.recordMany) await lifecycle.recordMany(records);
      else for (const it of records) await lifecycle.record(it.entry, it.steps);
      await this.deps.audit.append({
        workspaceId,
        action: 'transactions.transaction.bulk_edited',
        aggregateType: 'TransactionBulkOperation',
        aggregateId: bulkOperationId,
        correlationId: bulkOperationId,
        changes: [
          { field: 'bulkOperationId', before: null, after: bulkOperationId },
          { field: 'count', before: null, after: changed.length },
          { field: 'requestedCount', before: null, after: items.length },
          { field: 'requestedChanges', before: null, after: JSON.stringify(changes) },
          // Con más de 50 transacciones la lista completa se reconstruye por `correlation_id` (design decisión 6).
          ...(changed.length <= 50
            ? [
                {
                  field: 'transactionIds',
                  before: null,
                  after: JSON.stringify(changed.map((e) => (e.tx as Transaction).id)),
                },
              ]
            : []),
        ],
      });
      // Releer las cambiadas: `updated_at` lo fija la base al escribir.
      const fresh = await this.deps.transactions.findMany(
        workspaceId,
        changed.map((e) => (e.tx as Transaction).id),
      );
      const data = evaluations.map((e) => {
        const tx = e.tx as Transaction;
        return (fresh.get(tx.id) ?? tx).snapshot;
      });
      return { bulkOperationId, data };
    });
  }

  // ------------------------------------------------------------------ vista previa

  /** Sin efectos: informa cuántas transacciones se afectarían, su versión vigente y la aplicabilidad de cada una. */
  async preview(cmd: PreviewBulkEditCommand): Promise<BulkEditPreview> {
    const { workspaceId } = cmd;
    const changes = parseBulkEditChanges(cmd.changes);
    return this.deps.uow.run(workspaceId, async () => {
      let truncated = false;
      let txs: Transaction[];
      let order: string[];
      if ('items' in cmd.selection) {
        const ids = cmd.selection.items.map((x) => x.id);
        if (ids.length === 0 || ids.length > BULK_EDIT_MAX_ITEMS) {
          throw new DomainError('VALIDATION_FAILED', `between 1 and ${BULK_EDIT_MAX_ITEMS} items`).at(
            '/selection/items',
          );
        }
        const found = await this.deps.transactions.findMany(workspaceId, ids);
        txs = ids.flatMap((id) => found.get(id) ?? []);
        order = ids;
      } else {
        const page = await this.transactions.listTransactions({
          ...cmd.selection.filter,
          workspaceId,
          offset: 0,
          limit: BULK_EDIT_MAX_ITEMS + 1,
        });
        truncated = page.length > BULK_EDIT_MAX_ITEMS;
        txs = page.slice(0, BULK_EDIT_MAX_ITEMS).map((s) => Transaction.rehydrate(s));
        order = txs.map((t) => t.id);
      }
      const byId = new Map(txs.map((t) => [t.id, t]));
      const items = txs.map((t) => ({ id: t.id, version: t.version }));
      const evaluations = await this.evaluate(
        { workspaceId, userId: cmd.userId },
        changes,
        items,
        byId,
        false,
      );
      const evalById = new Map(evaluations.map((e) => [e.id, e]));
      const out: BulkEditPreviewItem[] = order.map((id) => {
        const e = evalById.get(id);
        if (!e || !e.tx) {
          return { id, version: null, applicable: false, reasons: ['RESOURCE_NOT_FOUND'] };
        }
        const reasons = [...new Set(e.problems.map((p) => p.code))];
        return {
          id,
          version: (e.before as TransactionState).version,
          applicable: reasons.length === 0,
          reasons,
        };
      });
      return { count: out.length, truncated, items: out };
    });
  }

  // ------------------------------------------------------------------ evaluación

  /**
   * Evalúa TODOS los ítems (nunca se detiene en el primer error, design decisión 3) aplicando los cambios en memoria al
   * agregado: existencia → versión → aplicabilidad → catálogos → reglas del agregado → periodo cerrado.
   */
  private async evaluate(
    cmd: { readonly workspaceId: string; readonly userId: string },
    changes: BulkEditChanges,
    items: readonly BulkEditItem[] | readonly { readonly id: string; readonly version?: number }[],
    loaded: ReadonlyMap<string, Transaction>,
    checkVersion = true,
  ): Promise<Evaluation[]> {
    const ctx = new BulkContext(this.deps, cmd.userId, cmd.workspaceId, changes);
    const out: Evaluation[] = [];
    for (const [i, item] of items.entries()) {
      const tx = loaded.get(item.id);
      if (!tx) {
        out.push({
          id: item.id,
          tx: null,
          before: null,
          outcome: null,
          changedFields: [],
          problems: [
            {
              code: 'RESOURCE_NOT_FOUND',
              detail: `transaction ${item.id} not found`,
              pointer: `/items/${i}/id`,
            },
          ],
        });
        continue;
      }
      const before = tx.snapshot;
      const problems: Problem[] = [];
      const add = (code: string, detail: string, pointer = `/items/${i}`) =>
        problems.push({ code, detail, pointer });
      if (checkVersion && item.version !== undefined && tx.version !== item.version) {
        add('PRECONDITION_FAILED', `current version ${tx.version}`, `/items/${i}/version`);
      }
      for (const r of bulkApplicability(before, changes)) add(r.code, r.detail);
      let outcome: Evaluation['outcome'] = null;
      let changedFields: ChangedField[] = [];
      if (!problems.some((p) => p.code === 'BULK_EDIT_NOT_APPLICABLE')) {
        const catalogError = await ctx.classification(before.kind);
        if (catalogError) add(catalogError.code, catalogError.message);
        const touchesFields = (changes.customFields?.length ?? 0) > 0;
        let patch: ResolvedCustomFieldPatch | undefined;
        if (touchesFields) {
          const resolved = await ctx.customFields(
            before.splits.map((s) => s.customFields.map((v) => v.fieldId)),
          );
          if (resolved instanceof DomainError) add(resolved.code, resolved.message);
          else patch = resolved;
        }
        if (problems.every((p) => p.code === 'PRECONDITION_FAILED') || problems.length === 0) {
          try {
            const touchesSplits =
              changes.categoryId !== undefined ||
              (changes.addTagIds?.length ?? 0) > 0 ||
              (changes.removeTagIds?.length ?? 0) > 0 ||
              touchesFields;
            const splits = touchesSplits ? applyBulkToSplits(before.splits, changes, patch) : undefined;
            if (splits?.some((s) => (s.customFields?.length ?? 0) > 20)) {
              throw new DomainError('VALIDATION_FAILED', 'at most 20 custom field values per split');
            }
            outcome = tx.bulkEdit(
              {
                ...(changes.counterpartyId !== undefined ? { counterpartyId: changes.counterpartyId } : {}),
                ...(changes.notes !== undefined ? { notes: changes.notes } : {}),
                ...(splits ? { splits } : {}),
              },
              changes.cleared,
            );
            changedFields = outcome.statusChanged
              ? [...outcome.changedFields, 'status']
              : [...outcome.changedFields];
            problems.push(
              ...(await this.periodProblems(ctx, i, before, tx.snapshot, outcome, changedFields)),
            );
          } catch (err) {
            if (!(err instanceof DomainError)) throw err;
            add(err.code, err.message);
          }
        }
      }
      out.push({
        id: item.id,
        tx,
        before,
        problems,
        outcome: problems.length === 0 ? outcome : null,
        changedFields: problems.length === 0 ? changedFields : [],
      });
    }
    return out;
  }

  /**
   * Alcance único de la edición en periodos cerrados (docs/33 D65, `planning/month-closing`): cambios de categoría,
   * tags, contraparte, custom fields y estado `cleared` sobre una fecha de un periodo cerrado ⇒ `PERIOD_CLOSED`;
   * notas (y descripción) se permiten. Una `PENDING` no se edita con fecha en periodo cerrado (D69).
   */
  private async periodProblems(
    ctx: BulkContext,
    index: number,
    before: TransactionState,
    after: TransactionState,
    outcome: NonNullable<Evaluation['outcome']>,
    changedFields: readonly ChangedField[],
  ): Promise<Problem[]> {
    if (changedFields.length === 0) return [];
    const tagsChanged = outcome.classificationChanges.some(
      (c) => c.addedTagIds.length > 0 || c.removedTagIds.length > 0,
    );
    const counterpartyChanged = before.counterpartyId !== after.counterpartyId;
    const classifies =
      outcome.classificationChanges.some((c) => c.previousCategoryId !== c.newCategoryId) ||
      outcome.customFieldChanges.length > 0 ||
      tagsChanged ||
      counterpartyChanged ||
      outcome.statusChanged;
    if (!classifies && before.status !== 'PENDING') return [];
    const err = await ctx.periodOpen(before.businessDate);
    return err ? [{ code: err.code, detail: err.message, pointer: `/items/${index}` }] : [];
  }

  // ------------------------------------------------------------------ registro

  /**
   * Eventos, entrada de auditoría y pasos del recorrido de UNA transacción cambiada, con la correlación de la operación.
   * No escribe nada: `bulkEdit` reúne los de todas las transacciones y los escribe por lotes.
   */
  private prepare(
    e: Evaluation,
    bulkOperationId: string,
  ): {
    readonly events: OutboxEvent[];
    readonly entry: AuditEntry;
    readonly steps: ReturnType<typeof transactionSteps>;
  } {
    const tx = e.tx as Transaction;
    const before = e.before as TransactionState;
    const outcome = e.outcome as NonNullable<Evaluation['outcome']>;
    const after = tx.snapshot;
    const transition = tx.lastTransition?.transition;
    const events: OutboxEvent[] = [];
    const refs: LifecycleEventRefDto[] = [];
    const publish = (event: { eventType: string; eventVersion: number }, payload: object) => {
      const built = buildEvent(this.deps, tx, event, payload, bulkOperationId);
      events.push(built.record);
      refs.push(built.ref);
    };
    if (outcome.statusChanged && (transition === 'CLEAR' || transition === 'UNCLEAR')) {
      publish(TRANSACTION_EVENTS.cleared, {
        transactionId: after.id,
        accountId: after.accountId,
        cleared: transition === 'CLEAR',
        status: after.status,
        previousStatus: outcome.statusPrevious,
        revision: after.revision,
        reconciliationId: null,
        bulkOperationId,
        transition,
      });
    }
    // `TransactionUpdated` solo lleva lo que no cubre un evento específico (docs/11): categoría y tags viajan en
    // `TransactionCategorized`, así una recategorización masiva de 500 emite 500 hechos y no 1 000 (design decisión 7).
    const eventFields = e.changedFields.filter((f) => f !== 'splits' && UPDATED_EVENT_FIELDS.has(f));
    if (eventFields.length > 0) {
      publish(TRANSACTION_EVENTS.updated, {
        transactionId: after.id,
        revision: after.revision,
        status: after.status,
        previousStatus: outcome.statusPrevious,
        changedFields: [...new Set(eventFields)],
        ledgerImpact: false,
        reason: null,
        paymentMethod: after.paymentMethod,
        bulkOperationId,
        ...(transition ? { transition } : {}),
      });
    }
    if (outcome.classificationChanges.length > 0) {
      publish(TRANSACTION_EVENTS.categorized, {
        transactionId: after.id,
        status: after.status,
        businessDate: after.businessDate,
        appliedBy: 'USER',
        ruleId: null,
        bulkOperationId,
        changes: outcome.classificationChanges.map((c) => ({ ...c, amount: c.amount.toJSON() })),
      });
    }
    const changes: AuditChangeInput[] = [
      ...diff(before, after, e.changedFields, null, outcome.customFieldChanges),
      { field: 'bulkOperationId', before: null, after: bulkOperationId },
    ];
    return {
      events,
      entry: {
        workspaceId: after.workspaceId,
        action: 'transactions.transaction.updated',
        aggregateType: 'Transaction',
        aggregateId: after.id,
        aggregateVersion: after.version,
        correlationId: bulkOperationId,
        changes,
      },
      steps: transactionSteps(tx, {
        events: refs,
        changedFields: e.changedFields.map(changedFieldName),
        revisionBefore: before.revision,
      }),
    };
  }
}

/** Un `DomainError` con el código de mayor prioridad y una violación por problema (`errors[]` por ítem). */
function bulkError(problems: readonly Problem[]): DomainError {
  const top = [...problems].sort((a, b) => priorityOf(a.code) - priorityOf(b.code))[0] as Problem;
  const violations: FieldViolation[] = problems.map((p) => ({
    pointer: p.pointer,
    code: p.code,
    detail: p.detail,
  }));
  return new DomainError(top.code, `${problems.length} item(s) cannot be edited: ${top.detail}`, {
    violations,
  });
}
