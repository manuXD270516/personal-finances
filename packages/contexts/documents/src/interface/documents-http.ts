import type { Readable } from 'node:stream';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Injectable,
  Param,
  Post,
  Req,
  Res,
  StreamableFile,
  UseGuards,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { ApiProblem } from '@pf/platform/api';
import Busboy from 'busboy';
import {
  ExpectedVersion,
  ValidatedQuery,
  apiState,
  principalOf,
  type ApiRequest,
  type ApiResponse,
} from '@pf/platform/nest';
import { isDomainError } from '@pf/shared-kernel';
import type { AttachmentsService } from '../application/attachments.service.js';
import type { DocumentsQueries } from '../application/documents.queries.js';
import type { DocumentsService } from '../application/documents.service.js';
import type { DownloadService } from '../application/download.service.js';
import type { ContentsService, StagedRestoreUpload } from '../application/contents.service.js';
import type { UploadsService } from '../application/uploads.service.js';

export const DOCUMENTS_CONTENTS = Symbol('DOCUMENTS_CONTENTS');
export const DOCUMENTS_REAUTH = Symbol('DOCUMENTS_REAUTH');

/** Exige una autenticación reciente (`auth_time` del token; lanza `REAUTHENTICATION_REQUIRED`). */
export type ReauthCheck = (authTimeSeconds: number | undefined) => void;

export const DOCUMENTS_UPLOADS = Symbol('DOCUMENTS_UPLOADS');
export const DOCUMENTS_SERVICE = Symbol('DOCUMENTS_SERVICE');
export const DOCUMENTS_ATTACHMENTS = Symbol('DOCUMENTS_ATTACHMENTS');
export const DOCUMENTS_DOWNLOAD = Symbol('DOCUMENTS_DOWNLOAD');
export const DOCUMENTS_QUERIES = Symbol('DOCUMENTS_QUERIES');

type Json = Record<string, unknown>;
const str = (b: Json, k: string): string | undefined =>
  typeof b[k] === 'string' ? (b[k] as string) : undefined;
const body = (b: unknown): Json => (b && typeof b === 'object' ? (b as Json) : {});

function userIdOf(req: ApiRequest): string {
  const principal = principalOf(req);
  if (!principal) throw new ApiProblem('UNAUTHENTICATED', 'an authenticated user is required');
  return principal.userId;
}

/**
 * Los `details` de un error de dominio de documentos (cuota, límites) viajan como extensión del problem (RFC 9457), y
 * un 503 lleva `Retry-After` cuando el semáforo de verificación está lleno o el escáner/almacenamiento no responde.
 */
async function withDetails<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (isDomainError(err)) {
      const retry =
        err.code === 'SERVICE_UNAVAILABLE' ? Number(err.details['retryAfterSeconds']) : Number.NaN;
      if (Number.isFinite(retry)) {
        throw new ApiProblem('SERVICE_UNAVAILABLE', err.message, {
          headers: { 'retry-after': String(retry) },
          cause: err,
        });
      }
      if (err.details && Object.keys(err.details).length > 0 && err.code !== 'PRECONDITION_FAILED') {
        throw new ApiProblem(err.code as never, err.message, {
          extensions: { details: err.details },
          cause: err,
        });
      }
    }
    throw err;
  }
}

const documentPath = (workspaceId: string, id: string): string =>
  `/api/v1/workspaces/${workspaceId}/documents/${id}`;

/** `/api/v1/workspaces/{workspaceId}/documents*` (openspec add-document-attachments § Contratos). */
@Controller()
export class DocumentsController {
  constructor(
    @Inject(DOCUMENTS_UPLOADS) private readonly uploads: UploadsService,
    @Inject(DOCUMENTS_SERVICE) private readonly documents: DocumentsService,
    @Inject(DOCUMENTS_ATTACHMENTS) private readonly attachments: AttachmentsService,
    @Inject(DOCUMENTS_DOWNLOAD) private readonly download: DownloadService,
    @Inject(DOCUMENTS_QUERIES) private readonly queries: DocumentsQueries,
  ) {}

  // Rutas literales antes de `:documentId`.

  @Post('workspaces/:workspaceId/documents/uploads')
  async requestUpload(
    @Req() req: ApiRequest,
    @Param('workspaceId') workspaceId: string,
    @Body() raw: unknown,
    @Res({ passthrough: true }) res: ApiResponse,
  ) {
    const b = body(raw);
    const result = await withDetails(() =>
      this.uploads.requestUpload({
        workspaceId,
        userId: userIdOf(req),
        fileName: b['fileName'],
        contentType: b['contentType'],
        sizeBytes: b['sizeBytes'],
        sha256: b['sha256'],
        purpose: b['purpose'],
      }),
    );
    if (result.deduplicated) {
      res.statusCode = 200;
      return { document: result.document, upload: null, deduplicated: true };
    }
    res.statusCode = 201;
    res.setHeader('location', documentPath(workspaceId, result.document.id));
    return { document: result.document, upload: result.upload, deduplicated: false };
  }

  @Get('workspaces/:workspaceId/documents/usage')
  async usage(@Param('workspaceId') workspaceId: string) {
    return this.queries.usage(workspaceId);
  }

  @Get('workspaces/:workspaceId/documents')
  async list(@Param('workspaceId') workspaceId: string, @ValidatedQuery() query: Json) {
    const limit = query['limit'] === undefined ? undefined : Number(query['limit']);
    const page = await this.queries.list(workspaceId, {
      purpose: str(query, 'purpose'),
      status: str(query, 'status'),
      archived: str(query, 'archived'),
      targetType: str(query, 'targetType'),
      targetId: str(query, 'targetId'),
      cursor: str(query, 'cursor'),
      limit,
    });
    return {
      data: page.items,
      page: { limit: page.limit, hasMore: page.nextCursor !== null, nextCursor: page.nextCursor },
    };
  }

  @Get('workspaces/:workspaceId/documents/:documentId')
  async get(@Param('workspaceId') workspaceId: string, @Param('documentId') documentId: string) {
    return this.queries.get(workspaceId, documentId);
  }

  @Post('workspaces/:workspaceId/documents/:documentId/complete')
  @HttpCode(200)
  async complete(@Param('workspaceId') workspaceId: string, @Param('documentId') documentId: string) {
    return withDetails(() => this.uploads.completeUpload({ workspaceId, documentId }));
  }

  @Get('workspaces/:workspaceId/documents/:documentId/download')
  async downloadDocument(
    @Req() req: ApiRequest,
    @Res({ passthrough: true }) res: ApiResponse,
    @Param('workspaceId') workspaceId: string,
    @Param('documentId') documentId: string,
  ): Promise<StreamableFile> {
    const file = await withDetails(() =>
      this.download.download({ workspaceId, userId: userIdOf(req), documentId }),
    );
    for (const [name, value] of Object.entries(file.headers)) res.setHeader(name, value);
    return new StreamableFile(file.stream, {
      type: file.contentType,
      length: file.contentLength,
      // `Content-Disposition` ya viene codificado de forma segura en `file.headers`.
      disposition: file.headers['content-disposition'] ?? 'attachment',
    });
  }

  @Post('workspaces/:workspaceId/documents/:documentId/links')
  async link(
    @Req() req: ApiRequest,
    @Param('workspaceId') workspaceId: string,
    @Param('documentId') documentId: string,
    @Body() raw: unknown,
    @Res({ passthrough: true }) res: ApiResponse,
  ) {
    const b = body(raw);
    const out = await withDetails(() =>
      this.attachments.link({
        workspaceId,
        userId: userIdOf(req),
        documentId,
        targetType: b['targetType'],
        targetId: b['targetId'],
      }),
    );
    res.statusCode = out.created ? 201 : 200;
    return out.link;
  }

  @Delete('workspaces/:workspaceId/documents/:documentId/links/:linkId')
  @HttpCode(204)
  async unlink(
    @Req() req: ApiRequest,
    @Param('workspaceId') workspaceId: string,
    @Param('documentId') documentId: string,
    @Param('linkId') linkId: string,
  ): Promise<void> {
    await this.attachments.unlink({ workspaceId, userId: userIdOf(req), documentId, linkId });
  }

  @Post('workspaces/:workspaceId/documents/:documentId/archive')
  @HttpCode(200)
  async archive(
    @Req() req: ApiRequest,
    @Param('workspaceId') workspaceId: string,
    @Param('documentId') documentId: string,
    @ExpectedVersion() expectedVersion: number | undefined,
  ) {
    return this.documents.archive({ workspaceId, userId: userIdOf(req), documentId, expectedVersion });
  }

  @Post('workspaces/:workspaceId/documents/:documentId/unarchive')
  @HttpCode(200)
  async unarchive(
    @Req() req: ApiRequest,
    @Param('workspaceId') workspaceId: string,
    @Param('documentId') documentId: string,
    @ExpectedVersion() expectedVersion: number | undefined,
  ) {
    return this.documents.unarchive({ workspaceId, userId: userIdOf(req), documentId, expectedVersion });
  }

  @Delete('workspaces/:workspaceId/documents/:documentId')
  @HttpCode(204)
  async remove(
    @Req() req: ApiRequest,
    @Param('workspaceId') workspaceId: string,
    @Param('documentId') documentId: string,
    @ExpectedVersion() expectedVersion: number | undefined,
  ): Promise<void> {
    await this.documents.delete({ workspaceId, userId: userIdOf(req), documentId, expectedVersion });
  }

  @Get('workspaces/:workspaceId/documents/:documentId/lifecycle')
  async lifecycle(
    @Req() req: ApiRequest,
    @Param('workspaceId') workspaceId: string,
    @Param('documentId') documentId: string,
  ) {
    return this.queries.lifecycle({ userId: userIdOf(req), workspaceId, documentId });
  }
}

// ─────────────────────────────────────────────────────────────── restauración del archivo de contenidos (8.3)

/**
 * Lee el campo `file` de un `multipart/form-data` EN STREAMING: `consume` recibe el flujo del archivo (sin cargarlo en
 * memoria) mientras se parsea. `tooLarge` indica que superó `maxBytes` (busboy trunca el flujo); el llamador descarta lo
 * que `consume` haya dejado.
 */
export function streamMultipartFile<T>(
  req: ApiRequest,
  maxBytes: number,
  consume: (file: Readable) => Promise<T>,
): Promise<{ readonly result: T; readonly tooLarge: boolean }> {
  return new Promise((resolve, reject) => {
    let parser: ReturnType<typeof Busboy>;
    try {
      parser = Busboy({
        headers: req.headers,
        limits: { files: 1, fields: 0, parts: 2, fileSize: maxBytes, headerPairs: 16 },
      });
    } catch {
      reject(new ApiProblem('VALIDATION_FAILED', 'the request must be multipart/form-data'));
      return;
    }
    let consumed: Promise<T> | undefined;
    let tooLarge = false;
    let invalid: string | undefined;
    parser.on('file', (field, stream) => {
      if (field !== 'file' || consumed) {
        invalid = 'only a single "file" part is accepted';
        stream.resume();
        return;
      }
      stream.on('limit', () => {
        tooLarge = true;
      });
      consumed = consume(stream);
      // Si el consumidor falla (p. ej. no es un ZIP), no se espera al cierre del parser: se corta el cuerpo y se responde.
      consumed.catch((err: unknown) => {
        req.unpipe(parser);
        req.resume();
        reject(err instanceof Error ? err : new Error(String(err)));
      });
    });
    parser.on('field', () => {
      invalid = 'unexpected form field';
    });
    parser.on('filesLimit', () => {
      invalid = 'only a single file is accepted';
    });
    parser.on('partsLimit', () => {
      invalid = 'unexpected form parts';
    });
    parser.on('error', () => {
      req.unpipe(parser);
      req.resume();
      reject(new ApiProblem('VALIDATION_FAILED', 'the multipart body could not be parsed'));
    });
    parser.on('close', () => {
      if (!consumed) {
        reject(new ApiProblem('VALIDATION_FAILED', invalid ?? 'the "file" part is required'));
        return;
      }
      consumed.then(
        (result) => {
          if (invalid) reject(new ApiProblem('VALIDATION_FAILED', invalid));
          else resolve({ result, tooLarge });
        },
        (err: unknown) => reject(err instanceof Error ? err : new Error(String(err))),
      );
    });
    req.pipe(parser);
  });
}

/**
 * Guard de `restoreDocumentContents`: exige la re-autenticación reciente ANTES de leer nada y deja el ZIP en la
 * cuarentena en streaming (sin cargarlo en memoria); su SHA-256 entra en la huella de idempotencia (misma clave con otro
 * archivo ⇒ 422 `IDEMPOTENCY_KEY_REUSED`). Sin `Idempotency-Key` o sin multipart no lee nada (lo valida el contrato).
 */
@Injectable()
export class ContentRestoreUploadGuard implements CanActivate {
  constructor(
    @Inject(DOCUMENTS_CONTENTS) private readonly contents: ContentsService,
    @Inject(DOCUMENTS_REAUTH) private readonly reauth: ReauthCheck,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (ctx.getType() !== 'http') return true;
    const req = ctx.switchToHttp().getRequest<ApiRequest>();
    const principal = principalOf(req);
    if (!principal || !req.headers['idempotency-key']) return true;
    if (!/^multipart\/form-data/iu.test(String(req.headers['content-type'] ?? ''))) return true;
    const workspaceId = req.params?.['workspaceId'];
    if (!workspaceId) return true;
    this.reauth(principal.authTime);
    const max = this.contents.restoreMaxBytes;
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > max + 64 * 1024) {
      req.resume();
      throw new ApiProblem('UPLOAD_TOO_LARGE', `the file exceeds ${max} bytes`);
    }
    const { result, tooLarge } = await withDetails(() =>
      streamMultipartFile(req, max, (file) => this.contents.stageUpload(workspaceId, file)),
    );
    if (tooLarge) {
      await this.contents.dropStaged(result.objectKey);
      throw new ApiProblem('UPLOAD_TOO_LARGE', `the file exceeds ${max} bytes`);
    }
    const state = apiState(req);
    state.stagedUpload = result;
    state.idempotencyPayload = { fileSha256: result.sha256 };
    return true;
  }
}

/** `POST W/documents/content-restores`: restaura los contenidos del archivo de contenidos de un export (OWNER). */
@Controller()
export class ContentRestoresController {
  constructor(@Inject(DOCUMENTS_CONTENTS) private readonly contents: ContentsService) {}

  @Post('workspaces/:workspaceId/documents/content-restores')
  @UseGuards(ContentRestoreUploadGuard)
  @HttpCode(202)
  async restore(
    @Req() req: ApiRequest,
    @Res({ passthrough: true }) res: ApiResponse,
    @Param('workspaceId') workspaceId: string,
  ) {
    const userId = userIdOf(req);
    const staged = apiState(req).stagedUpload as StagedRestoreUpload | undefined;
    if (!staged) throw new ApiProblem('VALIDATION_FAILED', 'the "file" part is required');
    let op: { operationId: string; createdAt: string };
    try {
      op = await this.contents.requestRestore({ workspaceId, userId, staged });
    } catch (err) {
      await this.contents.dropStaged(staged.objectKey);
      throw err;
    }
    res.setHeader('location', `/api/v1/workspaces/${workspaceId}/operations/${op.operationId}`);
    return {
      id: op.operationId,
      kind: 'DOCUMENT_CONTENTS_RESTORE',
      status: 'PENDING',
      progressPct: 0,
      resource: { type: 'DocumentContentRestore', id: op.operationId },
      result: null,
      error: null,
      createdAt: op.createdAt,
      updatedAt: op.createdAt,
    };
  }
}
