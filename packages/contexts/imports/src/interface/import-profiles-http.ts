import { Body, Controller, Get, HttpCode, Inject, Param, Post, Req, Res } from '@nestjs/common';
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
import type { ProfilesService } from '../application/profiles.service.js';
import { STATEMENT_FORMATS, type StatementFormat } from '../domain/index.js';

export const IMPORT_PROFILES_SERVICE = Symbol('IMPORT_PROFILES_SERVICE');

type Json = Record<string, unknown>;
const str = (b: Json, k: string): string | undefined =>
  typeof b[k] === 'string' ? (b[k] as string) : undefined;

function userIdOf(req: ApiRequest): string {
  const principal = principalOf(req);
  if (!principal) throw new ApiProblem('UNAUTHENTICATED', 'an authenticated user is required');
  return principal.userId;
}

function formatOf(value: string | undefined): StatementFormat | undefined {
  if (value === undefined) return undefined;
  if (!(STATEMENT_FORMATS as readonly string[]).includes(value)) {
    throw new ApiProblem('VALIDATION_FAILED', 'unknown format');
  }
  return value as StatementFormat;
}

/**
 * `/api/v1/workspaces/{workspaceId}/import-profiles*` (openspec add-import-pipeline § Contratos): perfiles de mapeo
 * por institución, versionados e inmutables por versión. VIEWER consulta; EDITOR crea, versiona y archiva (guard
 * global de IDENTITY). El ETag de un perfil es su última versión.
 */
@Controller()
export class ImportProfilesController {
  constructor(
    @Inject(IMPORT_PROFILES_SERVICE) private readonly profiles: ProfilesService,
    @Inject(API_CONVENTIONS) private readonly options: ApiConventionsOptions,
  ) {}

  @Get('workspaces/:workspaceId/import-profiles')
  async listImportProfiles(@Param('workspaceId') workspaceId: string, @ValidatedQuery() query: Json) {
    const raw = Number(query['limit'] ?? DEFAULT_PAGE_LIMIT);
    const limit = Number.isInteger(raw) ? Math.min(Math.max(raw, 1), MAX_PAGE_LIMIT) : DEFAULT_PAGE_LIMIT;
    const institutionId = str(query, 'institutionId');
    const accountId = str(query, 'accountId');
    const format = formatOf(str(query, 'format'));
    const includeArchived = String(query['includeArchived'] ?? 'false') === 'true';
    const scope = {
      resource: 'import-profiles',
      workspaceId,
      filters: {
        institutionId: institutionId ?? null,
        accountId: accountId ?? null,
        format: format ?? null,
        includeArchived,
      },
    };
    const cursor = str(query, 'cursor');
    let after: readonly [string, string] | undefined;
    if (cursor !== undefined) {
      const position = this.options.cursors.decode(cursor, scope);
      if (typeof position[0] !== 'string' || typeof position[1] !== 'string') {
        throw new ApiProblem('INVALID_CURSOR', 'cursor is invalid for this resource');
      }
      after = [position[0], position[1]];
    }
    const found = await this.profiles.list(workspaceId, {
      institutionId,
      accountId,
      format,
      includeArchived,
      limit: limit + 1,
      after,
    });
    const page = buildPage(
      found,
      limit,
      (p) => [p.updatedAt, p.id],
      (position) => this.options.cursors.encode(scope, position),
    );
    return { data: page.data, page: page.page };
  }

  /** Versión 1 desde opciones (`{ name, format, institutionId, accountId?, options }`) o desde una importación. */
  @Post('workspaces/:workspaceId/import-profiles')
  @HttpCode(201)
  async createImportProfile(
    @Req() req: ApiRequest,
    @Param('workspaceId') workspaceId: string,
    @Body() body: Json,
    @Res({ passthrough: true }) res: ApiResponse,
  ) {
    const name = str(body, 'name');
    if (!name) throw new ApiProblem('VALIDATION_FAILED', 'name is required');
    const created = await this.profiles.create({
      workspaceId,
      userId: userIdOf(req),
      name,
      format: formatOf(str(body, 'format')),
      institutionId: str(body, 'institutionId') ?? null,
      accountId: str(body, 'accountId') ?? null,
      options: body['options'],
      fromImportId: str(body, 'fromImportId'),
    });
    res.setHeader('location', `/api/v1/workspaces/${workspaceId}/import-profiles/${created.id}`);
    return created;
  }

  @Get('workspaces/:workspaceId/import-profiles/:profileId')
  getImportProfile(
    @Param('workspaceId') workspaceId: string,
    @Param('profileId') profileId: string,
    @ValidatedQuery() query: Json,
  ) {
    const version = query['version'] === undefined ? undefined : Number(query['version']);
    return this.profiles.get(workspaceId, profileId, version);
  }

  @Post('workspaces/:workspaceId/import-profiles/:profileId/versions')
  @HttpCode(201)
  createImportProfileVersion(
    @Req() req: ApiRequest,
    @Param('workspaceId') workspaceId: string,
    @Param('profileId') profileId: string,
    @ExpectedVersion() expectedVersion: number,
    @Body() body: Json,
  ) {
    return this.profiles.createVersion({
      workspaceId,
      userId: userIdOf(req),
      profileId,
      expectedVersion,
      name: str(body, 'name'),
      options: body['options'],
    });
  }

  @Post('workspaces/:workspaceId/import-profiles/:profileId/archive')
  @HttpCode(200)
  archiveImportProfile(
    @Req() req: ApiRequest,
    @Param('workspaceId') workspaceId: string,
    @Param('profileId') profileId: string,
    @ExpectedVersion() expectedVersion: number,
  ) {
    return this.profiles.archive({ workspaceId, userId: userIdOf(req), profileId, expectedVersion });
  }
}
