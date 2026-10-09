import { Body, Controller, Get, HttpCode, Inject, Param, Patch, Post, Req, Res } from '@nestjs/common';
import { isDomainError } from '@pf/shared-kernel';
import { ApiProblem, DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT, buildPage } from '@pf/platform/api';
import {
  API_CONVENTIONS,
  ExpectedVersion,
  ValidatedQuery,
  principalOf,
  type ApiConventionsOptions,
  type ApiRequest,
  type ApiResponse,
} from '@pf/platform/nest';
import type { AuditLogEntryDto } from '@pf/audit/contracts';
import type { ConversionCostDto } from '@pf/fx/contracts';
import type { CustomFieldFilter, TransactionSort } from '../application/ports/index.js';
import type {
  ListTransactionsQuery,
  MoneyDto,
  RecordTransactionCommand,
  RecordTransferCommand,
  SplitDto,
  TransactionsService,
  UpdateTransactionCommand,
} from '../application/transactions.service.js';
import {
  systemFlagsOf,
  type PaymentMethod,
  type SystemFlag,
  type TransactionKind,
  type TransactionSource,
  type TransactionState,
  type TransactionStatus,
} from '../domain/index.js';
import { conversionDetailDto, rateDto } from './conversion-dto.js';

export const TRANSACTIONS_SERVICE = Symbol('TRANSACTIONS_SERVICE');

export type Json = Record<string, unknown>;
export const str = (b: Json, k: string): string | undefined =>
  typeof b[k] === 'string' ? (b[k] as string) : undefined;
export const list = (q: Json, k: string): string[] | undefined => {
  const v = q[k];
  if (v === undefined) return undefined;
  return (Array.isArray(v) ? v : String(v).split(',')).map(String);
};

/**
 * `customField[<clave>]=v` (igualdad) y `customField[<clave>][gte|lte]=v` (rango) ya anidados por el contrato
 * (`style: deepObject`) ⇒ filtros por clave, ordenados para que el cursor firmado sea estable.
 */
function customFieldFilters(q: Json): CustomFieldFilter[] {
  const raw = q['customField'];
  if (typeof raw !== 'object' || raw === null) return [];
  return Object.entries(raw as Record<string, unknown>)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, v]) =>
      typeof v === 'string'
        ? { key, eq: v }
        : {
            key,
            ...(typeof (v as Json)['gte'] === 'string' ? { gte: (v as Json)['gte'] as string } : {}),
            ...(typeof (v as Json)['lte'] === 'string' ? { lte: (v as Json)['lte'] as string } : {}),
          },
    );
}

/** Filtros del listado tal como firman el cursor (`null` = ausente), a partir de los parámetros de consulta. */
export function listFiltersOf(query: Json) {
  return {
    q: str(query, 'q') ?? null,
    accountId: list(query, 'accountId') ?? null,
    source: list(query, 'source') ?? null,
    categoryId: list(query, 'categoryId') ?? null,
    tagId: list(query, 'tagId') ?? null,
    paymentMethod: list(query, 'paymentMethod') ?? null,
    counterpartyId: list(query, 'counterpartyId') ?? null,
    kind: list(query, 'kind') ?? null,
    status: list(query, 'status') ?? null,
    systemFlag: list(query, 'systemFlag') ?? null,
    currency: str(query, 'currency') ?? null,
    dateFrom: str(query, 'dateFrom') ?? null,
    dateTo: str(query, 'dateTo') ?? null,
    amountMin: str(query, 'amountMin') ?? null,
    amountMax: str(query, 'amountMax') ?? null,
    customField: customFieldFilters(query),
    sort: str(query, 'sort') ?? '-transactionDate',
  };
}

/** Filtros del listado en la forma del caso de uso (compartidos con la vista previa de la edición masiva). */
export function listQueryOf(
  filters: ReturnType<typeof listFiltersOf>,
): Omit<ListTransactionsQuery, 'workspaceId' | 'offset' | 'limit'> {
  return {
    sort: filters.sort as TransactionSort,
    ...(filters.q ? { q: filters.q } : {}),
    ...(filters.accountId ? { accountIds: filters.accountId } : {}),
    ...(filters.source ? { sources: filters.source as TransactionSource[] } : {}),
    ...(filters.categoryId ? { categoryIds: filters.categoryId } : {}),
    ...(filters.tagId ? { tagIds: filters.tagId } : {}),
    ...(filters.paymentMethod ? { paymentMethods: filters.paymentMethod as PaymentMethod[] } : {}),
    ...(filters.counterpartyId ? { counterpartyIds: filters.counterpartyId } : {}),
    ...(filters.kind ? { kinds: filters.kind as TransactionKind[] } : {}),
    ...(filters.status ? { statuses: filters.status as TransactionStatus[] } : {}),
    ...(filters.systemFlag ? { systemFlags: filters.systemFlag as SystemFlag[] } : {}),
    ...(filters.currency ? { currency: filters.currency } : {}),
    ...(filters.dateFrom ? { dateFrom: filters.dateFrom } : {}),
    ...(filters.dateTo ? { dateTo: filters.dateTo } : {}),
    ...(filters.amountMin ? { amountMin: filters.amountMin } : {}),
    ...(filters.amountMax ? { amountMax: filters.amountMax } : {}),
    ...(filters.customField.length > 0 ? { customFields: filters.customField } : {}),
  };
}

export function limitOf(q: Json): number {
  const raw = Number(q['limit'] ?? DEFAULT_PAGE_LIMIT);
  return Number.isInteger(raw) ? Math.min(Math.max(raw, 1), MAX_PAGE_LIMIT) : DEFAULT_PAGE_LIMIT;
}

export function userIdOf(req: ApiRequest): string {
  const principal = principalOf(req);
  if (!principal) throw new ApiProblem('UNAUTHENTICATED', 'an authenticated user is required');
  return principal.userId;
}

/** `Transaction` del contrato OpenAPI (dinero como string decimal). */
export function toTransactionDto(s: TransactionState, totalCost?: ConversionCostDto | null) {
  return {
    id: s.id,
    kind: s.kind,
    status: s.status,
    // Modo de conciliación (docs/33 D74) y marca de seguimiento derivada de solo lectura (D111).
    reconciliationMode: s.reconciliationMode,
    systemFlags: systemFlagsOf(s),
    transactionDate: s.businessDate,
    postingDate: s.postingDate,
    amount: s.amount.toJSON(),
    refundOfTransactionId: s.refundOfTransactionId,
    adjustmentReason: s.adjustmentReason,
    adjustmentDirection: s.direction,
    activeJournalEntryId: s.activeEntryId,
    description: s.description,
    paymentMethod: s.paymentMethod,
    notes: s.notes,
    counterpartyId: s.counterpartyId,
    legs: s.legs.map((l) => ({ accountId: l.accountId, amount: l.amount.toJSON(), role: l.role })),
    splits: s.splits.map((x) => ({
      id: x.id,
      amount: x.amount.toJSON(),
      categoryId: x.categoryId,
      counterpartyId: x.counterpartyId,
      tagIds: [...x.tagIds],
      memo: x.memo,
      customFields: Object.fromEntries(x.customFields.map((v) => [v.key, v.value])),
    })),
    conversion: s.conversion ? conversionDetailDto(s.conversion, totalCost) : null,
    source: s.source,
    externalRef: s.externalRef,
    revision: s.revision,
    voidedAt: s.voidedAt,
    voidReason: s.voidReason,
    attachmentCount: 0,
    version: s.version,
    createdAt: s.createdAt ?? '1970-01-01T00:00:00.000Z',
    ...(s.updatedAt ? { updatedAt: s.updatedAt } : {}),
  };
}

const auditEntryDto = (e: AuditLogEntryDto) => ({ ...e, changes: [...e.changes] });

/**
 * `splits[]` del cuerpo. `customFields` viaja como mapa `clave → valor` (`null` quita); el caso de uso lo recibe como
 * lista de cambios por clave.
 */
const splitsOf = (body: Json): SplitDto[] | undefined =>
  Array.isArray(body['splits'])
    ? (
        body['splits'] as (Omit<SplitDto, 'customFields'> & {
          customFields?: Record<string, string | boolean | null>;
        })[]
      ).map(({ customFields, ...rest }) => ({
        ...rest,
        ...(customFields
          ? { customFields: Object.entries(customFields).map(([key, value]) => ({ key, value })) }
          : {}),
      }))
    : undefined;

/**
 * `/api/v1/workspaces/{workspaceId}/transactions*` (design.md § Contratos + D27/D28). Autenticación y
 * `x-required-role` los aplica el guard global de IDENTITY; validación de contrato, Problem Details, ETag/If-Match e
 * `Idempotency-Key` (en la transacción del comando), las convenciones globales de `@pf/platform/nest`.
 */
@Controller()
export class TransactionsController {
  constructor(
    @Inject(TRANSACTIONS_SERVICE) private readonly service: TransactionsService,
    @Inject(API_CONVENTIONS) private readonly options: ApiConventionsOptions,
  ) {}

  @Get('workspaces/:workspaceId/transactions')
  async listTransactions(@Param('workspaceId') workspaceId: string, @ValidatedQuery() query: Json) {
    const limit = limitOf(query);
    const filters = listFiltersOf(query);
    const scope = { resource: 'transactions', workspaceId, filters };
    const cursor = str(query, 'cursor');
    let offset = 0;
    if (cursor !== undefined) {
      const [n] = this.options.cursors.decode(cursor, scope);
      if (typeof n !== 'number' || !Number.isInteger(n) || n < 0) {
        throw new ApiProblem('INVALID_CURSOR', 'cursor is invalid for this resource');
      }
      offset = n;
    }
    const found = await this.service.listTransactions({
      workspaceId,
      offset,
      limit: limit + 1,
      ...listQueryOf(filters),
    });
    const rows = found.map((s, i) => ({ s, at: offset + i + 1 }));
    const page = buildPage(
      rows,
      limit,
      (r) => [r.at],
      (position) => this.options.cursors.encode(scope, position),
    );
    return { data: page.data.map((r) => toTransactionDto(r.s)), page: page.page };
  }

  @Post('workspaces/:workspaceId/transactions')
  @HttpCode(201)
  async createTransaction(
    @Req() req: ApiRequest,
    @Param('workspaceId') workspaceId: string,
    @Body() body: Json,
    @Res({ passthrough: true }) res: ApiResponse,
  ) {
    const cmd: RecordTransactionCommand = {
      workspaceId,
      userId: userIdOf(req),
      kind: body['kind'] as TransactionKind,
      transactionDate: str(body, 'transactionDate') ?? '',
      accountId: str(body, 'accountId') ?? '',
      amount: body['amount'] as MoneyDto,
      ...(str(body, 'id') ? { id: str(body, 'id') as string } : {}),
      ...(body['status'] ? { status: body['status'] as 'PENDING' | 'POSTED' | 'CLEARED' } : {}),
      ...(body['direction'] ? { direction: body['direction'] as 'INCREASE' | 'DECREASE' } : {}),
      postingDate: str(body, 'postingDate') ?? null,
      description: str(body, 'description') ?? null,
      notes: str(body, 'notes') ?? null,
      counterpartyId: str(body, 'counterpartyId') ?? null,
      paymentMethod: (body['paymentMethod'] as PaymentMethod | null | undefined) ?? null,
      refundOfTransactionId: str(body, 'refundOfTransactionId') ?? null,
      confirmRefundExceedsOriginal: body['confirmRefundExceedsOriginal'] === true,
      reason: str(body, 'reason') ?? null,
      externalRef: (body['externalRef'] as { namespace: string; id: string } | undefined) ?? null,
      ...(splitsOf(body) ? { splits: splitsOf(body) as SplitDto[] } : {}),
    };
    const { transaction, warnings } = await this.service.recordTransaction(cmd);
    res.setHeader('location', `/api/v1/workspaces/${workspaceId}/transactions/${transaction.id}`);
    return {
      ...toTransactionDto(transaction),
      warnings: warnings.map((w) => ({ ...w, transactionIds: [...w.transactionIds] })),
    };
  }

  /**
   * `POST W/transfers` (add-transfers tarea 5.1): fachada que devuelve el `Transaction` `kind=TRANSFER`. Ante
   * `TRANSFER_CURRENCY_MISMATCH` el problem lleva `suggestedOperationId: createConversion` (RFC 9457).
   */
  @Post('workspaces/:workspaceId/transfers')
  @HttpCode(201)
  async createTransfer(
    @Req() req: ApiRequest,
    @Param('workspaceId') workspaceId: string,
    @Body() body: Json,
    @Res({ passthrough: true }) res: ApiResponse,
  ) {
    const fee = body['fee'] as { amount: MoneyDto; categoryId?: string } | undefined;
    const cmd: RecordTransferCommand = {
      workspaceId,
      userId: userIdOf(req),
      transactionDate: str(body, 'transactionDate') ?? '',
      fromAccountId: str(body, 'fromAccountId') ?? '',
      toAccountId: str(body, 'toAccountId') ?? '',
      amount: body['amount'] as MoneyDto,
      ...(str(body, 'id') ? { id: str(body, 'id') as string } : {}),
      ...(body['status'] ? { status: body['status'] as 'PENDING' | 'POSTED' | 'CLEARED' } : {}),
      postingDate: str(body, 'postingDate') ?? null,
      description: str(body, 'description') ?? null,
      notes: str(body, 'notes') ?? null,
      paymentMethod: (body['paymentMethod'] as PaymentMethod | null | undefined) ?? null,
      fee: fee ? { amount: fee.amount, categoryId: fee.categoryId ?? null } : null,
    };
    let transaction: TransactionState;
    try {
      transaction = await this.service.recordTransfer(cmd);
    } catch (err) {
      if (isDomainError(err) && err.code === 'TRANSFER_CURRENCY_MISMATCH') {
        throw new ApiProblem('TRANSFER_CURRENCY_MISMATCH', err.message, {
          fields: err.violations.map((v) => ({
            pointer: v.pointer,
            code: v.code,
            detail: v.detail ?? err.message,
          })),
          extensions: { suggestedOperationId: 'createConversion' },
          cause: err,
        });
      }
      throw err;
    }
    res.setHeader('location', `/api/v1/workspaces/${workspaceId}/transactions/${transaction.id}`);
    return toTransactionDto(transaction);
  }

  @Post('workspaces/:workspaceId/transactions/mark-cleared')
  @HttpCode(200)
  async markTransactionsCleared(@Param('workspaceId') workspaceId: string, @Body() body: Json) {
    const items = (body['items'] as { id: string; version: number }[] | undefined) ?? [];
    const result = await this.service.markCleared(workspaceId, items, body['cleared'] === true);
    return { data: result.data.map((s) => toTransactionDto(s)), bulkOperationId: result.bulkOperationId };
  }

  @Post('workspaces/:workspaceId/transactions/duplicate-check')
  @HttpCode(200)
  async checkTransactionDuplicates(@Param('workspaceId') workspaceId: string, @Body() body: Json) {
    const found = await this.service.checkDuplicates({
      workspaceId,
      accountId: str(body, 'accountId') ?? '',
      amount: body['amount'] as MoneyDto,
      transactionDate: str(body, 'transactionDate') ?? '',
      description: str(body, 'description') ?? null,
      counterpartyId: str(body, 'counterpartyId') ?? null,
      excludeTransactionId: str(body, 'excludeTransactionId') ?? null,
    });
    return {
      candidates: found.map((s) => ({
        transactionId: s.id,
        transactionDate: s.businessDate,
        amount: s.amount.toJSON(),
        description: s.description,
        counterpartyId: s.counterpartyId,
        status: s.status,
      })),
    };
  }

  @Get('workspaces/:workspaceId/transactions/:transactionId')
  async getTransaction(
    @Param('workspaceId') workspaceId: string,
    @Param('transactionId') transactionId: string,
  ) {
    return toTransactionDto(await this.service.getTransaction(workspaceId, transactionId));
  }

  @Patch('workspaces/:workspaceId/transactions/:transactionId')
  async updateTransaction(
    @Req() req: ApiRequest,
    @Param('workspaceId') workspaceId: string,
    @Param('transactionId') transactionId: string,
    @ExpectedVersion() expected: number,
    @Body() body: Json,
  ) {
    const cmd: UpdateTransactionCommand = {
      workspaceId,
      userId: userIdOf(req),
      transactionId,
      expectedVersion: expected,
      ...(str(body, 'transactionDate') ? { transactionDate: str(body, 'transactionDate') as string } : {}),
      ...(str(body, 'accountId') ? { accountId: str(body, 'accountId') as string } : {}),
      ...(body['amount'] ? { amount: body['amount'] as MoneyDto } : {}),
      ...(body['status'] ? { status: body['status'] as 'POSTED' | 'CLEARED' | 'RECONCILED' } : {}),
      ...(str(body, 'reconciliationMode')
        ? { reconciliationMode: str(body, 'reconciliationMode') as string }
        : {}),
      ...(splitsOf(body) ? { splits: splitsOf(body) as SplitDto[] } : {}),
      ...pickNullable(body, ['postingDate', 'description', 'notes', 'counterpartyId', 'paymentMethod']),
    };
    return toTransactionDto(await this.service.updateTransaction(cmd));
  }

  @Get('workspaces/:workspaceId/transactions/:transactionId/history')
  async getTransactionHistory(
    @Req() req: ApiRequest,
    @Param('workspaceId') workspaceId: string,
    @Param('transactionId') transactionId: string,
    @ValidatedQuery() query: Json,
  ) {
    const limit = limitOf(query);
    const scope = { resource: 'transaction-history', workspaceId, filters: { transactionId } };
    const cursor = str(query, 'cursor');
    let after: { occurredAt: string; id: string } | undefined;
    if (cursor !== undefined) {
      const [occurredAt, id] = this.options.cursors.decode(cursor, scope);
      if (typeof occurredAt !== 'string' || typeof id !== 'string') {
        throw new ApiProblem('INVALID_CURSOR', 'cursor is invalid for this resource');
      }
      after = { occurredAt, id };
    }
    const rows = await this.service.transactionHistory({
      userId: userIdOf(req),
      workspaceId,
      transactionId,
      ...(after ? { after } : {}),
      limit: limit + 1,
    });
    const page = buildPage(
      [...rows],
      limit,
      (r) => [r.occurredAt, r.id],
      (position) => this.options.cursors.encode(scope, position),
    );
    return { data: page.data.map(auditEntryDto), page: page.page };
  }

  /**
   * `GET W/transactions/{id}/lifecycle` (`getTransactionLifecycle`, add-lifecycle-timeline § Contratos; VIEWER+, D28):
   * recorrido (máquina, camino, transiciones y anotaciones) + montos de cada revisión. Otro workspace ⇒ 404.
   */
  @Get('workspaces/:workspaceId/transactions/:transactionId/lifecycle')
  async getTransactionLifecycle(
    @Req() req: ApiRequest,
    @Param('workspaceId') workspaceId: string,
    @Param('transactionId') transactionId: string,
  ) {
    const view = await this.service.transactionLifecycle({
      userId: userIdOf(req),
      workspaceId,
      transactionId,
    });
    return {
      ...view.lifecycle,
      // Sesiones referenciadas por las transiciones (fecha y saldo del extracto, TC-AUDIT-LIFECYCLE-026).
      reconciliations: view.reconciliations.map((r) => ({
        reconciliationId: r.reconciliationId,
        accountId: r.accountId,
        statementDate: r.statementDate,
        statementBalance: r.statementBalance.toJSON(),
      })),
      revisions: view.revisions.map((r) => ({
        revision: r.revision,
        amount: r.amount.toJSON(),
        fee: r.fee?.toJSON() ?? null,
        legs: r.legs.map((l) => ({ accountId: l.accountId, role: l.role, amount: l.amount.toJSON() })),
        conversion: r.conversion
          ? {
              sourceAccountId: r.conversion.sourceAccountId,
              targetAccountId: r.conversion.targetAccountId,
              sourceAmount: r.conversion.sourceAmount.toJSON(),
              targetAmount: r.conversion.targetAmount.toJSON(),
              effectiveRate: rateDto(r.conversion.effectiveRate),
              fees: r.conversion.fees.map((f) => ({ type: f.type, amount: f.amount.toJSON() })),
            }
          : null,
      })),
    };
  }

  @Post('workspaces/:workspaceId/transactions/:transactionId/void')
  @HttpCode(200)
  async voidTransaction(
    @Param('workspaceId') workspaceId: string,
    @Param('transactionId') transactionId: string,
    @ExpectedVersion() expected: number,
    @Body() body: Json,
  ) {
    return toTransactionDto(
      await this.service.voidTransaction(workspaceId, transactionId, expected, str(body, 'reason') ?? '', {
        correctInCurrentPeriod: body['correctInCurrentPeriod'] === true,
      }),
    );
  }

  @Post('workspaces/:workspaceId/transactions/:transactionId/unreconcile')
  @HttpCode(200)
  async unreconcileTransaction(
    @Param('workspaceId') workspaceId: string,
    @Param('transactionId') transactionId: string,
    @ExpectedVersion() expected: number,
    @Body() body: Json,
  ) {
    return toTransactionDto(
      await this.service.unreconcileTransaction(
        workspaceId,
        transactionId,
        expected,
        str(body, 'reason') ?? '',
      ),
    );
  }

  @Post('workspaces/:workspaceId/transactions/:transactionId/post')
  @HttpCode(200)
  async postTransaction(
    @Param('workspaceId') workspaceId: string,
    @Param('transactionId') transactionId: string,
    @ExpectedVersion() expected: number,
  ) {
    return toTransactionDto(await this.service.postTransaction(workspaceId, transactionId, expected));
  }
}

/** Merge-patch: copia solo las claves presentes (`null` borra). */
function pickNullable(body: Json, keys: readonly string[]): Json {
  const out: Json = {};
  for (const k of keys) if (k in body) out[k] = body[k];
  return out;
}
