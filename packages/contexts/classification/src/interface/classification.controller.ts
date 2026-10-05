import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Req,
  Res,
} from '@nestjs/common';
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
import type { ClassificationQueries } from '../application/classification.queries.js';
import type { ClassificationService } from '../application/classification.service.js';
import type { LocaleResolver } from '../application/ports/index.js';
import type { Category, CategoryGroup } from '../domain/category.js';
import { isCounterpartyKind, type Counterparty } from '../domain/counterparty.js';
import { NameTakenError } from '../domain/errors.js';
import { isCategoryKind, systemCategoryName } from '../domain/system-categories.js';
import type { Tag } from '../domain/tag.js';

export const CLASSIFICATION_SERVICE = Symbol('CLASSIFICATION_SERVICE');
export const CLASSIFICATION_QUERIES = Symbol('CLASSIFICATION_QUERIES');
export const CLASSIFICATION_LOCALES = Symbol('CLASSIFICATION_LOCALES');

type Json = Record<string, unknown>;
const WS = 'workspaces/:workspaceId';

const userId = (req: ApiRequest): string => {
  const p = principalOf(req);
  if (!p) throw new ApiProblem('UNAUTHENTICATED', 'an authenticated user is required');
  return p.userId;
};

/** `NAME_TAKEN` lleva `existingId` en el problem+json (creación inline, design §8). */
async function mapped<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof NameTakenError) {
      throw new ApiProblem('NAME_TAKEN', err.message, { extensions: { existingId: err.existingId } });
    }
    throw err;
  }
}

/** Sin `DELETE` sobre catálogos referenciables (INV-019, docs/10 §3, docs/31 D7): 405 sin efectos. */
function methodNotAllowed(allow: string): never {
  throw new ApiProblem(
    'METHOD_NOT_ALLOWED',
    'catalog entries are archived, never deleted; use POST …/archive',
    {
      headers: { allow },
    },
  );
}

const pick = <K extends string>(body: Json, keys: readonly K[]): Partial<Record<K, never>> => {
  const out: Json = {};
  for (const k of keys) if (k in body) out[k] = body[k];
  return out as Partial<Record<K, never>>;
};

export function groupDto(g: CategoryGroup) {
  return {
    id: g.id,
    name: g.name,
    kind: g.kind,
    sortOrder: g.sortOrder,
    archivedAt: g.archivedAt,
    version: g.version,
  };
}

/** Las categorías de sistema se nombran en el locale del usuario (design §6, TC-CLASSIFICATION-SYSTEM-003). */
export function categoryDto(c: Category, locale: string) {
  return {
    id: c.id,
    groupId: c.groupId,
    parentId: c.parentId,
    name: c.systemCode ? systemCategoryName(c.systemCode, locale) : c.name,
    kind: c.kind,
    systemCode: c.systemCode,
    isSystem: c.isSystem,
    color: c.color,
    icon: c.icon,
    sortOrder: c.sortOrder,
    archivedAt: c.archivedAt,
    version: c.version,
  };
}

export function tagDto(t: Tag) {
  return { id: t.id, name: t.name, color: t.color, archivedAt: t.archivedAt, version: t.version };
}

export function counterpartyDto(c: Counterparty) {
  return {
    id: c.id,
    name: c.name,
    kind: c.kind,
    defaultCategoryId: c.defaultCategoryId,
    aliases: [...c.aliases],
    icon: c.icon,
    website: c.website,
    notes: c.notes,
    archivedAt: c.archivedAt,
    version: c.version,
  };
}

/**
 * API REST de CLASSIFICATION (`/api/v1/workspaces/{workspaceId}/{category-groups,categories,tags,counterparties}`).
 * Autenticación y rol (`x-required-role`) los aplica el guard global de IDENTITY; validación de contrato, ETag,
 * `If-Match` e idempotencia, las convenciones de `@pf/platform/nest`. Paginación por cursor firmado sobre el orden
 * del listado (catálogos pequeños: se ordenan en memoria y el cursor guarda el último id).
 */
@Controller()
export class ClassificationController {
  constructor(
    @Inject(CLASSIFICATION_SERVICE) private readonly service: ClassificationService,
    @Inject(CLASSIFICATION_QUERIES) private readonly queries: ClassificationQueries,
    @Inject(CLASSIFICATION_LOCALES) private readonly locales: LocaleResolver,
    @Inject(API_CONVENTIONS) private readonly options: ApiConventionsOptions,
  ) {}

  private page<T extends { id: string }, D>(
    resource: string,
    workspaceId: string,
    query: Json,
    rows: readonly T[],
    dto: (t: T) => D,
  ) {
    const rawLimit = Number(query['limit'] ?? DEFAULT_PAGE_LIMIT);
    const limit = Number.isInteger(rawLimit)
      ? Math.min(Math.max(rawLimit, 1), MAX_PAGE_LIMIT)
      : DEFAULT_PAGE_LIMIT;
    const filters: Record<string, string> = {};
    for (const [k, v] of Object.entries(query)) {
      if (k !== 'limit' && k !== 'cursor' && v !== undefined) filters[k] = String(v);
    }
    const scope = { resource, workspaceId, filters };
    const cursor = typeof query['cursor'] === 'string' ? query['cursor'] : undefined;
    let start = 0;
    if (cursor !== undefined) {
      const afterId = String(this.options.cursors.decode(cursor, scope)[0]);
      start = rows.findIndex((r) => r.id === afterId) + 1;
    }
    const page = buildPage(
      rows.slice(start, start + limit + 1),
      limit,
      (r) => [r.id],
      (position) => this.options.cursors.encode(scope, position),
    );
    return { data: page.data.map(dto), page: page.page };
  }

  private filters(query: Json) {
    return {
      includeArchived: query['includeArchived'] === true || query['includeArchived'] === 'true',
      ...(typeof query['q'] === 'string' ? { q: query['q'] } : {}),
    };
  }

  // ------------------------------------------------------------------ grupos

  @Get(`${WS}/category-groups`)
  async listCategoryGroups(
    @Req() req: ApiRequest,
    @Param('workspaceId') ws: string,
    @ValidatedQuery() query: Json,
  ) {
    const kind = isCategoryKind(query['kind']) ? query['kind'] : undefined;
    const rows = await this.queries.listCategoryGroups(userId(req), ws, {
      ...this.filters(query),
      ...(kind ? { kind } : {}),
    });
    return this.page('category-groups', ws, query, rows, groupDto);
  }

  @Post(`${WS}/category-groups`)
  @HttpCode(201)
  async createCategoryGroup(
    @Req() req: ApiRequest,
    @Param('workspaceId') ws: string,
    @Body() body: Json,
    @Res({ passthrough: true }) res: ApiResponse,
  ) {
    const g = await mapped(() =>
      this.service.createCategoryGroup(userId(req), ws, {
        ...pick(body, ['id', 'sortOrder']),
        name: String(body['name']),
        kind: isCategoryKind(body['kind']) ? body['kind'] : 'EXPENSE',
      }),
    );
    res.setHeader('location', `/api/v1/workspaces/${ws}/category-groups/${g.id}`);
    return groupDto(g);
  }

  @Get(`${WS}/category-groups/:categoryGroupId`)
  async getCategoryGroup(
    @Req() req: ApiRequest,
    @Param('workspaceId') ws: string,
    @Param('categoryGroupId') id: string,
  ) {
    return groupDto(await this.queries.getCategoryGroup(userId(req), ws, id));
  }

  @Patch(`${WS}/category-groups/:categoryGroupId`)
  async updateCategoryGroup(
    @Req() req: ApiRequest,
    @Param('workspaceId') ws: string,
    @Param('categoryGroupId') id: string,
    @ExpectedVersion() v: number,
    @Body() body: Json,
  ) {
    return groupDto(
      await mapped(() =>
        this.service.updateCategoryGroup(userId(req), ws, id, v, pick(body, ['name', 'sortOrder'])),
      ),
    );
  }

  @Post(`${WS}/category-groups/:categoryGroupId/archive`)
  @HttpCode(200)
  async archiveCategoryGroup(
    @Req() req: ApiRequest,
    @Param('workspaceId') ws: string,
    @Param('categoryGroupId') id: string,
    @ExpectedVersion() v: number,
  ) {
    return groupDto(await this.service.archiveCategoryGroup(userId(req), ws, id, v));
  }

  @Post(`${WS}/category-groups/:categoryGroupId/unarchive`)
  @HttpCode(200)
  async unarchiveCategoryGroup(
    @Req() req: ApiRequest,
    @Param('workspaceId') ws: string,
    @Param('categoryGroupId') id: string,
    @ExpectedVersion() v: number,
  ) {
    return groupDto(await mapped(() => this.service.unarchiveCategoryGroup(userId(req), ws, id, v)));
  }

  @Delete(`${WS}/category-groups/:categoryGroupId`)
  deleteCategoryGroup(): never {
    return methodNotAllowed('GET, PATCH');
  }

  // ------------------------------------------------------------------ categorías

  @Get(`${WS}/categories`)
  async listCategories(
    @Req() req: ApiRequest,
    @Param('workspaceId') ws: string,
    @ValidatedQuery() query: Json,
  ) {
    const user = userId(req);
    const kind = isCategoryKind(query['kind']) ? query['kind'] : undefined;
    const rows = await this.queries.listCategories(user, ws, {
      ...this.filters(query),
      ...(kind ? { kind } : {}),
      ...(typeof query['groupId'] === 'string' ? { groupId: query['groupId'] } : {}),
    });
    const locale = await this.locales.localeOf(user);
    return this.page('categories', ws, query, rows, (c) => categoryDto(c, locale));
  }

  @Post(`${WS}/categories`)
  @HttpCode(201)
  async createCategory(
    @Req() req: ApiRequest,
    @Param('workspaceId') ws: string,
    @Body() body: Json,
    @Res({ passthrough: true }) res: ApiResponse,
  ) {
    const user = userId(req);
    // El locale se lee ANTES del comando: su unidad de trabajo (sin workspace) dentro de la transacción de
    // idempotencia dejaba esa transacción sin contexto RLS y `complete` fallaba con 500.
    const locale = await this.locales.localeOf(user);
    const c = await mapped(() =>
      this.service.createCategory(user, ws, {
        ...pick(body, ['id', 'parentId', 'icon', 'color', 'sortOrder']),
        groupId: String(body['groupId']),
        name: String(body['name']),
      }),
    );
    res.setHeader('location', `/api/v1/workspaces/${ws}/categories/${c.id}`);
    return categoryDto(c, locale);
  }

  @Post(`${WS}/categories/reorder`)
  @HttpCode(200)
  async reorderCategories(@Req() req: ApiRequest, @Param('workspaceId') ws: string, @Body() body: Json) {
    const user = userId(req);
    const rows = await this.service.reorderCategories(user, ws, {
      groupId: String(body['groupId']),
      parentId: typeof body['parentId'] === 'string' ? body['parentId'] : null,
      orderedIds: Array.isArray(body['orderedIds']) ? body['orderedIds'].map(String) : [],
    });
    const locale = await this.locales.localeOf(user);
    return {
      data: rows.map((c) => categoryDto(c, locale)),
      page: { limit: Math.max(rows.length, 1), hasMore: false, nextCursor: null },
    };
  }

  @Post(`${WS}/categories/apply-default-catalog`)
  @HttpCode(200)
  async applyDefaultCatalog(@Req() req: ApiRequest, @Param('workspaceId') ws: string, @Body() body: Json) {
    const version = typeof body?.['catalogVersion'] === 'string' ? body['catalogVersion'] : undefined;
    return this.service.applyDefaultCatalog(userId(req), ws, version);
  }

  @Get(`${WS}/categories/:categoryId`)
  async getCategory(
    @Req() req: ApiRequest,
    @Param('workspaceId') ws: string,
    @Param('categoryId') id: string,
  ) {
    const user = userId(req);
    return categoryDto(await this.queries.getCategory(user, ws, id), await this.locales.localeOf(user));
  }

  /**
   * `GET W/categories/{id}/lifecycle` (`getCategoryLifecycle`, docs/31 D52; VIEWER+): recorrido de la categoría
   * (creación, archivado, desarchivado y anotaciones). Otro workspace ⇒ 404 idéntico a inexistente.
   */
  @Get(`${WS}/categories/:categoryId/lifecycle`)
  getCategoryLifecycle(
    @Req() req: ApiRequest,
    @Param('workspaceId') ws: string,
    @Param('categoryId') id: string,
  ) {
    return this.queries.lifecycleOf(userId(req), ws, 'Category', id);
  }

  @Patch(`${WS}/categories/:categoryId`)
  async updateCategory(
    @Req() req: ApiRequest,
    @Param('workspaceId') ws: string,
    @Param('categoryId') id: string,
    @ExpectedVersion() v: number,
    @Body() body: Json,
  ) {
    const user = userId(req);
    const c = await mapped(() =>
      this.service.updateCategory(
        user,
        ws,
        id,
        v,
        pick(body, ['groupId', 'parentId', 'name', 'icon', 'color', 'sortOrder']),
      ),
    );
    return categoryDto(c, await this.locales.localeOf(user));
  }

  @Post(`${WS}/categories/:categoryId/archive`)
  @HttpCode(200)
  async archiveCategory(
    @Req() req: ApiRequest,
    @Param('workspaceId') ws: string,
    @Param('categoryId') id: string,
    @ExpectedVersion() v: number,
  ) {
    const user = userId(req);
    return categoryDto(
      await this.service.archiveCategory(user, ws, id, v),
      await this.locales.localeOf(user),
    );
  }

  @Post(`${WS}/categories/:categoryId/unarchive`)
  @HttpCode(200)
  async unarchiveCategory(
    @Req() req: ApiRequest,
    @Param('workspaceId') ws: string,
    @Param('categoryId') id: string,
    @ExpectedVersion() v: number,
  ) {
    const user = userId(req);
    const c = await mapped(() => this.service.unarchiveCategory(user, ws, id, v));
    return categoryDto(c, await this.locales.localeOf(user));
  }

  @Delete(`${WS}/categories/:categoryId`)
  deleteCategory(): never {
    return methodNotAllowed('GET, PATCH');
  }

  // ------------------------------------------------------------------ tags

  @Get(`${WS}/tags`)
  async listTags(@Req() req: ApiRequest, @Param('workspaceId') ws: string, @ValidatedQuery() query: Json) {
    const rows = await this.queries.listTags(userId(req), ws, this.filters(query));
    return this.page('tags', ws, query, rows, tagDto);
  }

  @Post(`${WS}/tags`)
  @HttpCode(201)
  async createTag(
    @Req() req: ApiRequest,
    @Param('workspaceId') ws: string,
    @Body() body: Json,
    @Res({ passthrough: true }) res: ApiResponse,
  ) {
    const t = await mapped(() =>
      this.service.createTag(userId(req), ws, { ...pick(body, ['id', 'color']), name: String(body['name']) }),
    );
    res.setHeader('location', `/api/v1/workspaces/${ws}/tags/${t.id}`);
    return tagDto(t);
  }

  @Get(`${WS}/tags/:tagId`)
  async getTag(@Req() req: ApiRequest, @Param('workspaceId') ws: string, @Param('tagId') id: string) {
    return tagDto(await this.queries.getTag(userId(req), ws, id));
  }

  @Patch(`${WS}/tags/:tagId`)
  async updateTag(
    @Req() req: ApiRequest,
    @Param('workspaceId') ws: string,
    @Param('tagId') id: string,
    @ExpectedVersion() v: number,
    @Body() body: Json,
  ) {
    return tagDto(
      await mapped(() => this.service.updateTag(userId(req), ws, id, v, pick(body, ['name', 'color']))),
    );
  }

  @Post(`${WS}/tags/:tagId/archive`)
  @HttpCode(200)
  async archiveTag(
    @Req() req: ApiRequest,
    @Param('workspaceId') ws: string,
    @Param('tagId') id: string,
    @ExpectedVersion() v: number,
  ) {
    return tagDto(await this.service.archiveTag(userId(req), ws, id, v));
  }

  @Post(`${WS}/tags/:tagId/unarchive`)
  @HttpCode(200)
  async unarchiveTag(
    @Req() req: ApiRequest,
    @Param('workspaceId') ws: string,
    @Param('tagId') id: string,
    @ExpectedVersion() v: number,
  ) {
    return tagDto(await mapped(() => this.service.unarchiveTag(userId(req), ws, id, v)));
  }

  @Delete(`${WS}/tags/:tagId`)
  deleteTag(): never {
    return methodNotAllowed('GET, PATCH');
  }

  // ------------------------------------------------------------------ counterparties

  @Get(`${WS}/counterparties`)
  async listCounterparties(
    @Req() req: ApiRequest,
    @Param('workspaceId') ws: string,
    @ValidatedQuery() query: Json,
  ) {
    const kind = isCounterpartyKind(query['kind']) ? query['kind'] : undefined;
    let rows = await this.queries.listCounterparties(userId(req), ws, {
      ...this.filters(query),
      ...(kind ? { kind } : {}),
    });
    if (query['sort'] === '-name') rows = rows.reverse();
    return this.page('counterparties', ws, query, rows, counterpartyDto);
  }

  @Post(`${WS}/counterparties`)
  @HttpCode(201)
  async createCounterparty(
    @Req() req: ApiRequest,
    @Param('workspaceId') ws: string,
    @Body() body: Json,
    @Res({ passthrough: true }) res: ApiResponse,
  ) {
    const c = await mapped(() =>
      this.service.createCounterparty(userId(req), ws, {
        ...pick(body, ['id', 'defaultCategoryId', 'aliases', 'icon', 'website', 'notes']),
        name: String(body['name']),
        ...(isCounterpartyKind(body['kind']) ? { kind: body['kind'] } : {}),
      }),
    );
    res.setHeader('location', `/api/v1/workspaces/${ws}/counterparties/${c.id}`);
    return counterpartyDto(c);
  }

  @Get(`${WS}/counterparties/resolve`)
  async resolveCounterparty(
    @Req() req: ApiRequest,
    @Param('workspaceId') ws: string,
    @ValidatedQuery() query: Json,
  ) {
    const r = await this.queries.resolveCounterparty(userId(req), ws, String(query['description'] ?? ''));
    return {
      counterparty: r.counterparty ? counterpartyDto(r.counterparty) : null,
      matchedOn: r.matchedOn,
      matchedText: r.matchedText,
    };
  }

  @Get(`${WS}/counterparties/:counterpartyId`)
  async getCounterparty(
    @Req() req: ApiRequest,
    @Param('workspaceId') ws: string,
    @Param('counterpartyId') id: string,
  ) {
    return counterpartyDto(await this.queries.getCounterparty(userId(req), ws, id));
  }

  /**
   * `GET W/counterparties/{id}/lifecycle` (`getCounterpartyLifecycle`, docs/31 D52; VIEWER+): recorrido de la
   * contraparte. Otro workspace ⇒ 404 idéntico a inexistente.
   */
  @Get(`${WS}/counterparties/:counterpartyId/lifecycle`)
  getCounterpartyLifecycle(
    @Req() req: ApiRequest,
    @Param('workspaceId') ws: string,
    @Param('counterpartyId') id: string,
  ) {
    return this.queries.lifecycleOf(userId(req), ws, 'Counterparty', id);
  }

  @Patch(`${WS}/counterparties/:counterpartyId`)
  async updateCounterparty(
    @Req() req: ApiRequest,
    @Param('workspaceId') ws: string,
    @Param('counterpartyId') id: string,
    @ExpectedVersion() v: number,
    @Body() body: Json,
  ) {
    return counterpartyDto(
      await mapped(() =>
        this.service.updateCounterparty(
          userId(req),
          ws,
          id,
          v,
          pick(body, ['name', 'kind', 'defaultCategoryId', 'aliases', 'icon', 'website', 'notes']),
        ),
      ),
    );
  }

  @Post(`${WS}/counterparties/:counterpartyId/archive`)
  @HttpCode(200)
  async archiveCounterparty(
    @Req() req: ApiRequest,
    @Param('workspaceId') ws: string,
    @Param('counterpartyId') id: string,
    @ExpectedVersion() v: number,
  ) {
    return counterpartyDto(await this.service.archiveCounterparty(userId(req), ws, id, v));
  }

  @Post(`${WS}/counterparties/:counterpartyId/unarchive`)
  @HttpCode(200)
  async unarchiveCounterparty(
    @Req() req: ApiRequest,
    @Param('workspaceId') ws: string,
    @Param('counterpartyId') id: string,
    @ExpectedVersion() v: number,
  ) {
    return counterpartyDto(await mapped(() => this.service.unarchiveCounterparty(userId(req), ws, id, v)));
  }

  @Get(`${WS}/counterparties/:counterpartyId/category-suggestion`)
  async getCategorySuggestion(
    @Req() req: ApiRequest,
    @Param('workspaceId') ws: string,
    @Param('counterpartyId') id: string,
    @ValidatedQuery() query: Json,
  ) {
    const kind = isCategoryKind(query['kind']) ? query['kind'] : 'EXPENSE';
    return this.queries.getCategorySuggestion(userId(req), ws, id, kind);
  }

  @Delete(`${WS}/counterparties/:counterpartyId`)
  deleteCounterparty(): never {
    return methodNotAllowed('GET, PATCH');
  }
}
