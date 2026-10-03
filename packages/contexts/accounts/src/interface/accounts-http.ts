import { Body, Controller, Get, HttpCode, Inject, Param, Patch, Post, Put, Res } from '@nestjs/common';
import { ApiProblem, DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT, buildPage } from '@pf/platform/api';
import {
  API_CONVENTIONS,
  ExpectedVersion,
  ValidatedQuery,
  type ApiConventionsOptions,
  type ApiResponse,
} from '@pf/platform/nest';
import type { AccountsService, AccountSort, AccountView } from '../application/accounts.service.js';
import type { InstitutionsService } from '../application/institutions.service.js';
import type {
  AccountChanges,
  AccountStatus,
  AccountType,
  InstitutionFields,
  InstitutionKind,
  InstitutionState,
  Liquidity,
} from '../domain/index.js';

export const ACCOUNTS_SERVICE = Symbol('ACCOUNTS_SERVICE');
export const INSTITUTIONS_SERVICE = Symbol('INSTITUTIONS_SERVICE');

type Json = Record<string, unknown>;
const str = (b: Json, k: string): string | undefined =>
  typeof b[k] === 'string' ? (b[k] as string) : undefined;
const list = (q: Json, k: string): string[] | undefined => {
  const v = q[k];
  if (v === undefined) return undefined;
  return (Array.isArray(v) ? v : [v]).map(String);
};
const bool = (q: Json, k: string): boolean => q[k] === true || q[k] === 'true';

function limitOf(q: Json): number {
  const raw = Number(q['limit'] ?? DEFAULT_PAGE_LIMIT);
  return Number.isInteger(raw) ? Math.min(Math.max(raw, 1), MAX_PAGE_LIMIT) : DEFAULT_PAGE_LIMIT;
}

/** Copia solo las claves presentes (merge-patch: `null` borra, ausente no cambia). */
function pick<T>(body: Json, keys: readonly string[]): T {
  const out: Json = {};
  for (const k of keys) if (k in body) out[k] = body[k];
  return out as T;
}

/** `Account` del contrato OpenAPI (dinero como string decimal; equivalente en moneda base pendiente de FX). */
export function toAccountDto(v: AccountView) {
  const a = v.account;
  return {
    id: a.id,
    name: a.name,
    type: a.type,
    classification: v.nature,
    status: v.status,
    liquidity: a.liquidity,
    currency: a.currency,
    institutionId: a.institutionId,
    openedOn: a.openedOn,
    closedOn: a.closedOn,
    balance: v.balance,
    baseCurrencyBalance: null,
    includeInNetWorth: a.includeInNetWorth,
    includeInBudget: a.includeInBudget,
    displayOrder: a.displayOrder,
    accountNumberLast4: a.accountNumberLast4,
    color: a.color,
    icon: a.icon,
    tagIds: [...a.tagIds],
    cryptoNetwork: a.cryptoNetwork,
    notes: a.notes,
    archivedAt: a.archivedAt,
    version: a.version,
    createdAt: a.createdAt ?? '1970-01-01T00:00:00.000Z',
    ...(a.updatedAt ? { updatedAt: a.updatedAt } : {}),
  };
}

export function toInstitutionDto(s: InstitutionState) {
  return {
    id: s.id,
    name: s.name,
    kind: s.kind,
    countryCode: s.countryCode,
    website: s.website,
    icon: s.icon,
    color: s.color,
    notes: s.notes,
    archivedAt: s.archivedAt,
    version: s.version,
  };
}

const ACCOUNT_UPDATE_KEYS = [
  'name',
  'currency',
  'institutionId',
  'liquidity',
  'includeInNetWorth',
  'includeInBudget',
  'displayOrder',
  'accountNumberLast4',
  'color',
  'icon',
  'tagIds',
  'cryptoNetwork',
  'notes',
] as const;

/**
 * `/api/v1/workspaces/{workspaceId}/accounts*` (design.md §Contratos). Autenticación y `x-required-role` los aplica el
 * guard global de IDENTITY; validación de contrato, Problem Details, ETag/If-Match e `Idempotency-Key` (con la
 * transacción del comando), las convenciones globales de `@pf/platform/nest`.
 */
@Controller()
export class AccountsController {
  constructor(
    @Inject(ACCOUNTS_SERVICE) private readonly service: AccountsService,
    @Inject(API_CONVENTIONS) private readonly options: ApiConventionsOptions,
  ) {}

  @Get('workspaces/:workspaceId/accounts')
  async listAccounts(@Param('workspaceId') workspaceId: string, @ValidatedQuery() query: Json) {
    const limit = limitOf(query);
    const filters = {
      includeArchived: bool(query, 'includeArchived'),
      type: list(query, 'type') ?? null,
      currency: list(query, 'currency') ?? null,
      institutionId: str(query, 'institutionId') ?? null,
      status: list(query, 'status') ?? null,
      tagId: str(query, 'tagId') ?? null,
      liquidity: list(query, 'liquidity') ?? null,
      sort: str(query, 'sort') ?? 'displayOrder',
      groupBy: str(query, 'groupBy') ?? null,
    };
    const scope = { resource: 'accounts', workspaceId, filters };
    const cursor = str(query, 'cursor');
    let offset = 0;
    if (cursor !== undefined) {
      const [n] = this.options.cursors.decode(cursor, scope);
      if (typeof n !== 'number' || !Number.isInteger(n) || n < 0) {
        throw new ApiProblem('INVALID_CURSOR', 'cursor is invalid for this resource');
      }
      offset = n;
    }
    const result = await this.service.listAccounts({
      workspaceId,
      includeArchived: filters.includeArchived,
      ...(filters.type ? { types: filters.type as AccountType[] } : {}),
      ...(filters.currency ? { currencies: filters.currency } : {}),
      ...(filters.institutionId ? { institutionId: filters.institutionId } : {}),
      ...(filters.status ? { statuses: filters.status as AccountStatus[] } : {}),
      ...(filters.tagId ? { tagId: filters.tagId } : {}),
      ...(filters.liquidity ? { liquidities: filters.liquidity as Liquidity[] } : {}),
      sort: filters.sort as AccountSort,
      ...(filters.groupBy ? { groupBy: filters.groupBy as 'type' | 'institution' } : {}),
    });
    const rows = result.data.slice(offset, offset + limit + 1).map((v, i) => ({ v, at: offset + i + 1 }));
    const page = buildPage(
      rows,
      limit,
      (r) => [r.at],
      (position) => this.options.cursors.encode(scope, position),
    );
    const shown = new Set(page.data.map((r) => r.v.account.id));
    return {
      data: page.data.map((r) => toAccountDto(r.v)),
      page: page.page,
      ...(result.groups
        ? {
            groups: result.groups
              .map((g) => ({ ...g, accountIds: g.accountIds.filter((id) => shown.has(id)) }))
              .filter((g) => g.accountIds.length > 0),
          }
        : {}),
    };
  }

  @Post('workspaces/:workspaceId/accounts')
  @HttpCode(201)
  async createAccount(
    @Param('workspaceId') workspaceId: string,
    @Body() body: Json,
    @Res({ passthrough: true }) res: ApiResponse,
  ) {
    const opening = body['openingBalance'] as
      { amount: { amount: string; currency: string }; date: string } | undefined;
    const view = await this.service.openAccount({
      workspaceId,
      ...pick<Json>(body, [
        'id',
        'institutionId',
        'openedOn',
        'liquidity',
        'includeInNetWorth',
        'includeInBudget',
        'accountNumberLast4',
        'color',
        'icon',
        'tagIds',
        'cryptoNetwork',
        'notes',
      ]),
      name: str(body, 'name') ?? '',
      type: str(body, 'type') ?? '',
      currency: str(body, 'currency') ?? '',
      ...(opening ? { openingBalance: opening } : {}),
    });
    res.setHeader('location', `/api/v1/workspaces/${workspaceId}/accounts/${view.account.id}`);
    return toAccountDto(view);
  }

  @Put('workspaces/:workspaceId/accounts/order')
  @HttpCode(204)
  async reorderAccounts(@Param('workspaceId') workspaceId: string, @Body() body: Json): Promise<void> {
    const ids = Array.isArray(body['accountIds']) ? (body['accountIds'] as string[]) : [];
    await this.service.reorderAccounts(workspaceId, ids);
  }

  @Get('workspaces/:workspaceId/accounts/:accountId')
  async getAccount(@Param('workspaceId') workspaceId: string, @Param('accountId') accountId: string) {
    return toAccountDto(await this.service.getAccount(workspaceId, accountId));
  }

  @Patch('workspaces/:workspaceId/accounts/:accountId')
  async updateAccount(
    @Param('workspaceId') workspaceId: string,
    @Param('accountId') accountId: string,
    @ExpectedVersion() expected: number,
    @Body() body: Json,
  ) {
    const changes = pick<AccountChanges>(body, ACCOUNT_UPDATE_KEYS);
    return toAccountDto(await this.service.updateAccount(workspaceId, accountId, expected, changes));
  }

  @Post('workspaces/:workspaceId/accounts/:accountId/archive')
  @HttpCode(200)
  async archiveAccount(
    @Param('workspaceId') workspaceId: string,
    @Param('accountId') accountId: string,
    @ExpectedVersion() expected: number,
    @Body() body: Json | undefined,
  ) {
    const reason = body ? (str(body, 'reason') ?? null) : null;
    return toAccountDto(await this.service.archiveAccount(workspaceId, accountId, expected, reason));
  }

  @Post('workspaces/:workspaceId/accounts/:accountId/close')
  @HttpCode(200)
  async closeAccount(
    @Param('workspaceId') workspaceId: string,
    @Param('accountId') accountId: string,
    @ExpectedVersion() expected: number,
    @Body() body: Json,
  ) {
    return toAccountDto(
      await this.service.closeAccount(workspaceId, accountId, expected, {
        closedOn: str(body, 'closedOn') ?? '',
        reason: str(body, 'reason') ?? null,
      }),
    );
  }

  @Post('workspaces/:workspaceId/accounts/:accountId/reactivate')
  @HttpCode(200)
  async reactivateAccount(
    @Param('workspaceId') workspaceId: string,
    @Param('accountId') accountId: string,
    @ExpectedVersion() expected: number,
  ) {
    return toAccountDto(await this.service.reactivateAccount(workspaceId, accountId, expected));
  }
}

const INSTITUTION_KEYS = ['name', 'kind', 'countryCode', 'website', 'icon', 'color', 'notes'] as const;

/** `/api/v1/workspaces/{workspaceId}/institutions*` (accounts/institutions). Sin DELETE (405 por ruta inexistente). */
@Controller()
export class InstitutionsController {
  constructor(
    @Inject(INSTITUTIONS_SERVICE) private readonly service: InstitutionsService,
    @Inject(API_CONVENTIONS) private readonly options: ApiConventionsOptions,
  ) {}

  @Get('workspaces/:workspaceId/institutions')
  async listInstitutions(@Param('workspaceId') workspaceId: string, @ValidatedQuery() query: Json) {
    const limit = limitOf(query);
    const filters = {
      includeArchived: bool(query, 'includeArchived'),
      q: str(query, 'q') ?? null,
      kind: list(query, 'kind') ?? null,
    };
    const scope = { resource: 'institutions', workspaceId, filters };
    const cursor = str(query, 'cursor');
    let offset = 0;
    if (cursor !== undefined) {
      const [n] = this.options.cursors.decode(cursor, scope);
      if (typeof n !== 'number' || !Number.isInteger(n) || n < 0) {
        throw new ApiProblem('INVALID_CURSOR', 'cursor is invalid for this resource');
      }
      offset = n;
    }
    const all = await this.service.listInstitutions({
      workspaceId,
      includeArchived: filters.includeArchived,
      ...(filters.kind ? { kinds: filters.kind as InstitutionKind[] } : {}),
      ...(filters.q ? { q: filters.q } : {}),
    });
    const rows = all.slice(offset, offset + limit + 1).map((s, i) => ({ s, at: offset + i + 1 }));
    const page = buildPage(
      rows,
      limit,
      (r) => [r.at],
      (position) => this.options.cursors.encode(scope, position),
    );
    return { data: page.data.map((r) => toInstitutionDto(r.s)), page: page.page };
  }

  @Post('workspaces/:workspaceId/institutions')
  @HttpCode(201)
  async createInstitution(
    @Param('workspaceId') workspaceId: string,
    @Body() body: Json,
    @Res({ passthrough: true }) res: ApiResponse,
  ) {
    const created = await this.service.createInstitution({
      workspaceId,
      ...pick<InstitutionFields>(body, INSTITUTION_KEYS),
      ...(str(body, 'id') ? { id: str(body, 'id') as string } : {}),
      name: str(body, 'name') ?? '',
      kind: str(body, 'kind') ?? '',
    });
    res.setHeader('location', `/api/v1/workspaces/${workspaceId}/institutions/${created.id}`);
    return toInstitutionDto(created);
  }

  @Get('workspaces/:workspaceId/institutions/:institutionId')
  async getInstitution(@Param('workspaceId') workspaceId: string, @Param('institutionId') id: string) {
    return toInstitutionDto(await this.service.getInstitution(workspaceId, id));
  }

  @Patch('workspaces/:workspaceId/institutions/:institutionId')
  async updateInstitution(
    @Param('workspaceId') workspaceId: string,
    @Param('institutionId') id: string,
    @ExpectedVersion() expected: number,
    @Body() body: Json,
  ) {
    return toInstitutionDto(
      await this.service.updateInstitution(
        workspaceId,
        id,
        expected,
        pick<InstitutionFields>(body, INSTITUTION_KEYS),
      ),
    );
  }

  @Post('workspaces/:workspaceId/institutions/:institutionId/archive')
  @HttpCode(200)
  async archiveInstitution(
    @Param('workspaceId') workspaceId: string,
    @Param('institutionId') id: string,
    @ExpectedVersion() expected: number,
  ) {
    return toInstitutionDto(await this.service.archiveInstitution(workspaceId, id, expected));
  }
}
