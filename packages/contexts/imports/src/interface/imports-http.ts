import { createHash } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Injectable,
  Param,
  Patch,
  Post,
  Put,
  Req,
  Res,
  UseGuards,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { ApiProblem, DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT, buildPage } from '@pf/platform/api';
import {
  API_CONVENTIONS,
  ExpectedVersion,
  ValidatedQuery,
  apiState,
  principalOf,
  type ApiConventionsOptions,
  type ApiRequest,
  type ApiResponse,
} from '@pf/platform/nest';
import { isDomainError } from '@pf/shared-kernel';
import Busboy from 'busboy';
import type { ImportsQueries } from '../application/imports.queries.js';
import type { ImportsService } from '../application/imports.service.js';
import { CLASSIFICATIONS, DECISIONS, IMPORT_STATUSES } from '../domain/index.js';
import type { Classification, Decision, ImportStatus } from '../domain/index.js';

export const IMPORTS_SERVICE = Symbol('IMPORTS_SERVICE');
export const IMPORTS_QUERIES = Symbol('IMPORTS_QUERIES');
export const IMPORTS_HTTP_SETTINGS = Symbol('IMPORTS_HTTP_SETTINGS');

/** Ajustes HTTP de IMPORTS: tope del archivo (`IMPORT_CSV_MAX_BYTES`). */
export interface ImportsHttpSettings {
  readonly maxBytes: number;
}

type Json = Record<string, unknown>;
const str = (b: Json, k: string): string | undefined =>
  typeof b[k] === 'string' ? (b[k] as string) : undefined;

/** Margen del multipart (cabeceras de las partes) sobre el tope del archivo. */
const MULTIPART_OVERHEAD = 64 * 1024;
const PREVIEW_PAGE_SIZE = 50;

function limitOf(q: Json): number {
  const raw = Number(q['limit'] ?? DEFAULT_PAGE_LIMIT);
  return Number.isInteger(raw) ? Math.min(Math.max(raw, 1), MAX_PAGE_LIMIT) : DEFAULT_PAGE_LIMIT;
}

function userIdOf(req: ApiRequest): string {
  const principal = principalOf(req);
  if (!principal) throw new ApiProblem('UNAUTHENTICATED', 'an authenticated user is required');
  return principal.userId;
}

export interface UploadedForm {
  readonly file: Buffer;
  readonly fileName: string | null;
  readonly fields: Readonly<Record<string, string>>;
}

/**
 * Lee `multipart/form-data` con el campo `file` (un solo archivo, tope de `maxBytes`: al excederlo deja de leer y
 * responde 413 `UPLOAD_TOO_LARGE`, sin bufferizar el resto) y el campo de texto `accountId`. Nada se guarda en disco.
 */
export function readCsvUpload(req: IncomingMessage, maxBytes: number): Promise<UploadedForm> {
  return new Promise((resolve, reject) => {
    let parser: ReturnType<typeof Busboy>;
    try {
      parser = Busboy({
        headers: req.headers,
        limits: { files: 1, fields: 2, parts: 4, fileSize: maxBytes, headerPairs: 32, fieldSize: 256 },
      });
    } catch {
      reject(new ApiProblem('VALIDATION_FAILED', 'the request must be multipart/form-data'));
      return;
    }
    const chunks: Buffer[] = [];
    const fields: Record<string, string> = {};
    let found = false;
    let fileName: string | null = null;
    let tooLarge = false;
    let invalid: string | undefined;
    parser.on('file', (field, stream, info) => {
      if (field !== 'file' || found) {
        invalid = 'only a single "file" part is accepted';
        stream.resume();
        return;
      }
      found = true;
      fileName = info.filename || null;
      stream.on('data', (c: Buffer) => {
        if (!tooLarge) chunks.push(c);
      });
      stream.on('limit', () => {
        tooLarge = true;
        chunks.length = 0;
      });
    });
    parser.on('field', (name, value) => {
      if (name !== 'accountId') invalid = 'unexpected form field';
      else fields[name] = value;
    });
    parser.on('filesLimit', () => {
      invalid = 'only a single file is accepted';
    });
    parser.on('partsLimit', () => {
      invalid = 'unexpected form parts';
    });
    parser.on('error', () =>
      reject(new ApiProblem('VALIDATION_FAILED', 'the multipart body could not be parsed')),
    );
    parser.on('close', () => {
      if (tooLarge) reject(new ApiProblem('UPLOAD_TOO_LARGE', `the file exceeds ${maxBytes} bytes`));
      else if (invalid) reject(new ApiProblem('VALIDATION_FAILED', invalid));
      else if (!found) reject(new ApiProblem('VALIDATION_FAILED', 'the "file" part is required'));
      else if (!fields['accountId'])
        reject(new ApiProblem('VALIDATION_FAILED', 'the "accountId" field is required'));
      else resolve({ file: Buffer.concat(chunks), fileName, fields });
    });
    req.pipe(parser);
  });
}

/**
 * Guard de `createImport` (D113): lee el archivo ANTES de la idempotencia para que `request_hash` incluya
 * `{ fileSha256, accountId }` (misma clave con otro archivo o cuenta ⇒ 422 `IDEMPOTENCY_KEY_REUSED`). Corre tras los
 * guards globales (límite de tasa, identidad ⇒ un VIEWER recibe `INSUFFICIENT_ROLE` sin leer el cuerpo) y antes de los
 * interceptores. Deja el archivo en el estado de la petición. Sin `Idempotency-Key` o sin multipart no lee nada.
 */
@Injectable()
export class CsvUploadGuard implements CanActivate {
  constructor(@Inject(IMPORTS_HTTP_SETTINGS) private readonly settings: ImportsHttpSettings) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (ctx.getType() !== 'http') return true;
    const req = ctx.switchToHttp().getRequest<ApiRequest>();
    if (!principalOf(req) || !req.headers['idempotency-key']) return true;
    if (!/^multipart\/form-data/i.test(String(req.headers['content-type'] ?? ''))) return true;
    const declared = Number(req.headers['content-length']);
    // Rechazo temprano por tamaño declarado: no se lee el cuerpo.
    if (Number.isFinite(declared) && declared > this.settings.maxBytes + MULTIPART_OVERHEAD) {
      req.resume();
      throw new ApiProblem('UPLOAD_TOO_LARGE', `the file exceeds ${this.settings.maxBytes} bytes`);
    }
    const form = await readCsvUpload(req, this.settings.maxBytes);
    const state = apiState(req);
    state.upload = form.file;
    state.uploadMeta = { fileName: form.fileName, fields: form.fields };
    state.idempotencyPayload = {
      fileSha256: createHash('sha256').update(form.file).digest('hex'),
      accountId: form.fields['accountId'],
    };
    return true;
  }
}

/**
 * `/api/v1/workspaces/{workspaceId}/imports*` (openspec add-basic-csv-import § Contratos). Autenticación y
 * `x-required-role` (VIEWER lee; EDITOR escribe) los aplica el guard global de IDENTITY; validación de contrato,
 * Problem Details, ETag/If-Match, `Idempotency-Key` y cuota `costly`, las convenciones globales de `@pf/platform/nest`.
 */
@Controller()
export class ImportsController {
  constructor(
    @Inject(IMPORTS_SERVICE) private readonly service: ImportsService,
    @Inject(IMPORTS_QUERIES) private readonly queries: ImportsQueries,
    @Inject(API_CONVENTIONS) private readonly options: ApiConventionsOptions,
  ) {}

  @Post('workspaces/:workspaceId/imports')
  @HttpCode(201)
  @UseGuards(CsvUploadGuard)
  async createImport(
    @Req() req: ApiRequest,
    @Param('workspaceId') workspaceId: string,
    @Res({ passthrough: true }) res: ApiResponse,
  ) {
    const state = apiState(req);
    const meta = state.uploadMeta;
    if (!state.upload || !meta) {
      throw new ApiProblem(
        'VALIDATION_FAILED',
        'the request must be multipart/form-data with "file" and "accountId"',
      );
    }
    const created = await this.service.createImport({
      workspaceId,
      userId: userIdOf(req),
      accountId: meta.fields['accountId'] as string,
      fileName: meta.fileName,
      bytes: state.upload,
    });
    res.setHeader('location', `/api/v1/workspaces/${workspaceId}/imports/${created.id}`);
    return created;
  }

  @Get('workspaces/:workspaceId/imports')
  async listImports(@Param('workspaceId') workspaceId: string, @ValidatedQuery() query: Json) {
    const accountId = str(query, 'accountId');
    const status = str(query, 'status') as ImportStatus | undefined;
    if (status !== undefined && !(IMPORT_STATUSES as readonly string[]).includes(status)) {
      throw new ApiProblem('VALIDATION_FAILED', 'unknown status');
    }
    const limit = limitOf(query);
    const scope = {
      resource: 'imports',
      workspaceId,
      filters: { accountId: accountId ?? null, status: status ?? null },
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
    const found = await this.queries.list(workspaceId, { accountId, status, limit: limit + 1, after });
    const page = buildPage(
      found,
      limit,
      (j) => [j.createdAt, j.id],
      (position) => this.options.cursors.encode(scope, position),
    );
    return { data: page.data, page: page.page };
  }

  @Get('workspaces/:workspaceId/imports/:importId')
  getImport(@Param('workspaceId') workspaceId: string, @Param('importId') importId: string) {
    return this.queries.get(workspaceId, importId);
  }

  @Put('workspaces/:workspaceId/imports/:importId/mapping')
  setImportMapping(
    @Req() req: ApiRequest,
    @Param('workspaceId') workspaceId: string,
    @Param('importId') importId: string,
    @ExpectedVersion() expectedVersion: number,
    @Body() body: unknown,
  ) {
    return this.service.setMapping({
      workspaceId,
      userId: userIdOf(req),
      importId,
      expectedVersion,
      mapping: body,
    });
  }

  @Get('workspaces/:workspaceId/imports/:importId/preview')
  async getImportPreview(
    @Param('workspaceId') workspaceId: string,
    @Param('importId') importId: string,
    @ValidatedQuery() query: Json,
  ) {
    const classification = str(query, 'classification') as Classification | undefined;
    if (classification !== undefined && !(CLASSIFICATIONS as readonly string[]).includes(classification)) {
      throw new ApiProblem('VALIDATION_FAILED', 'unknown classification');
    }
    const scope = {
      resource: 'import-preview',
      workspaceId,
      filters: { importId, classification: classification ?? null },
    };
    const cursor = str(query, 'cursor');
    let afterRowNumber: number | undefined;
    if (cursor !== undefined) {
      const [n] = this.options.cursors.decode(cursor, scope);
      if (typeof n !== 'number' || !Number.isInteger(n) || n < 0) {
        throw new ApiProblem('INVALID_CURSOR', 'cursor is invalid for this resource');
      }
      afterRowNumber = n;
    }
    const preview = await this.queries.preview(workspaceId, importId, {
      classification,
      afterRowNumber,
      limit: query['limit'] === undefined ? PREVIEW_PAGE_SIZE : limitOf(query),
    });
    return {
      summary: preview.summary,
      rows: preview.rows,
      nextCursor:
        preview.nextCursor === null ? null : this.options.cursors.encode(scope, [preview.nextCursor]),
    };
  }

  @Patch('workspaces/:workspaceId/imports/:importId/rows/:rowId')
  async decideImportRow(
    @Req() req: ApiRequest,
    @Param('workspaceId') workspaceId: string,
    @Param('importId') importId: string,
    @Param('rowId') rowId: string,
    @ExpectedVersion() expectedVersion: number,
    @Body() body: Json,
  ) {
    const decision = str(body, 'decision') as Decision | undefined;
    if (!decision || !(DECISIONS as readonly string[]).includes(decision)) {
      throw new ApiProblem('VALIDATION_FAILED', 'decision must be CREATE, SKIP or EXCLUDE');
    }
    const decided = await this.service.decideRow({
      workspaceId,
      userId: userIdOf(req),
      importId,
      rowId,
      expectedVersion,
      decision,
    });
    // El ETag de la respuesta es la versión resultante del job (los conteos de la revisión cambian con la decisión).
    return { ...decided.row, version: decided.version, counters: decided.counters };
  }

  @Post('workspaces/:workspaceId/imports/:importId/approve')
  @HttpCode(202)
  approveImport(
    @Req() req: ApiRequest,
    @Param('workspaceId') workspaceId: string,
    @Param('importId') importId: string,
    @ExpectedVersion() expectedVersion: number,
  ) {
    return this.approveOrExplain({ workspaceId, userId: userIdOf(req), importId, expectedVersion });
  }

  /** `pendingDecisions` de `IMPORT_REVIEW_INCOMPLETE` viaja como extensión del problem (RFC 9457). */
  private async approveOrExplain(input: Parameters<ImportsService['approve']>[0]) {
    try {
      return await this.service.approve(input);
    } catch (err) {
      if (isDomainError(err) && err.code === 'IMPORT_REVIEW_INCOMPLETE') {
        throw new ApiProblem('IMPORT_REVIEW_INCOMPLETE', err.message, {
          extensions: { pendingDecisions: err.details['pendingDecisions'] },
          cause: err,
        });
      }
      throw err;
    }
  }

  @Post('workspaces/:workspaceId/imports/:importId/cancel')
  @HttpCode(200)
  cancelImport(
    @Req() req: ApiRequest,
    @Param('workspaceId') workspaceId: string,
    @Param('importId') importId: string,
  ) {
    return this.service.cancel({ workspaceId, userId: userIdOf(req), importId });
  }

  @Post('workspaces/:workspaceId/imports/:importId/retry')
  @HttpCode(202)
  retryImport(
    @Req() req: ApiRequest,
    @Param('workspaceId') workspaceId: string,
    @Param('importId') importId: string,
  ) {
    return this.service.retry({ workspaceId, userId: userIdOf(req), importId });
  }

  @Post('workspaces/:workspaceId/imports/:importId/accept-errors')
  @HttpCode(200)
  acceptImportErrors(
    @Req() req: ApiRequest,
    @Param('workspaceId') workspaceId: string,
    @Param('importId') importId: string,
  ) {
    return this.service.acceptErrors({ workspaceId, userId: userIdOf(req), importId });
  }
}
