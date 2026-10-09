import type { IncomingMessage } from 'node:http';
import { Controller, Get, HttpCode, Inject, Param, Post, Req, Res, StreamableFile } from '@nestjs/common';
import { ApiProblem, ErrorCatalog, rateLimitHeaders, type RateLimitPolicy } from '@pf/platform/api';
import {
  API_CONVENTIONS,
  principalOf,
  type ApiConventionsOptions,
  type ApiRequest,
  type ApiResponse,
} from '@pf/platform/nest';
import Busboy from 'busboy';
import type { ImportView } from '../application/portability/workspace-import.service.js';
import type { WorkspaceImportService } from '../application/portability/workspace-import.service.js';
import type {
  ExportView,
  WorkspaceExportService,
} from '../application/portability/workspace-export.service.js';
import type { OperationView } from '../application/portability/ports.js';

export const WORKSPACE_EXPORT_SERVICE = Symbol('WORKSPACE_EXPORT_SERVICE');
export const WORKSPACE_IMPORT_SERVICE = Symbol('WORKSPACE_IMPORT_SERVICE');
export const PORTABILITY_SETTINGS = Symbol('PORTABILITY_SETTINGS');

/** Ajustes HTTP de la portabilidad; `enabled = false` ⇒ las operaciones responden 503 (sin llavero de claves maestras). */
export interface PortabilityHttpSettings {
  readonly enabled: boolean;
  readonly maxImportBytes: number;
}

/** Exportaciones por usuario y minuto (docs/10 §10). */
export const EXPORT_REQUEST_POLICY: RateLimitPolicy = {
  name: 'workspace-export',
  quota: 10,
  windowSeconds: 60,
};

type ExportService = Pick<
  WorkspaceExportService,
  'requestExport' | 'listExports' | 'getExport' | 'getOperation' | 'download' | 'discard'
>;
type ImportService = Pick<WorkspaceImportService, 'requestImport' | 'getImport'>;

export const exportDto = (v: ExportView) => ({
  id: v.id,
  workspaceId: v.workspaceId,
  operationId: v.operationId,
  status: v.status,
  formatVersion: v.formatVersion,
  sizeBytes: v.sizeBytes,
  sha256: v.sha256,
  counts: v.counts,
  requestedBy: v.requestedBy,
  requestedAt: v.requestedAt,
  completedAt: v.completedAt,
  expiresAt: v.expiresAt,
  discardedAt: v.discardedAt,
  expiredAt: v.expiredAt,
  errorCode: v.errorCode,
});

/** `Operation` del contrato: el fallo se expresa como `Problem` (RFC 9457) con el código estable. */
const operationDto = (o: OperationView, problemTypeBase: string) => {
  const code = typeof o.error?.['code'] === 'string' ? o.error['code'] : null;
  const entry = code === null ? undefined : ErrorCatalog.get(code);
  return {
    id: o.id,
    kind: o.kind,
    status: o.status,
    progressPct: o.progressPct,
    resource: { type: o.resourceType, id: o.resourceId },
    result: o.result,
    error:
      code === null
        ? null
        : {
            type: ErrorCatalog.typeUri(code, problemTypeBase),
            title: entry?.title ?? 'Operation failed',
            status: entry?.status ?? 500,
            code,
            requestId: o.id,
          },
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
  };
};

export const importDto = (v: ImportView) => ({
  id: v.id,
  status: v.status,
  sourceWorkspaceId: v.sourceWorkspaceId,
  sourceExportedAt: v.sourceExportedAt,
  formatVersion: v.formatVersion,
  sizeBytes: v.sizeBytes,
  workspaceId: v.workspaceId,
  counts: v.counts,
  errorCode: v.errorCode,
  createdAt: v.createdAt,
  completedAt: v.completedAt,
});

/** Lee el campo `file` de un `multipart/form-data` con tope de tamaño; exceso ⇒ 413 `UPLOAD_TOO_LARGE`, sin guardar nada. */
export function readUploadedFile(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
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
    const chunks: Buffer[] = [];
    let found = false;
    let tooLarge = false;
    let invalid: string | undefined;
    parser.on('file', (field, stream) => {
      if (field !== 'file' || found) {
        invalid = 'only a single "file" part is accepted';
        stream.resume();
        return;
      }
      found = true;
      stream.on('data', (c: Buffer) => {
        if (!tooLarge) chunks.push(c);
      });
      stream.on('limit', () => {
        tooLarge = true;
        chunks.length = 0;
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
    parser.on('error', () =>
      reject(new ApiProblem('VALIDATION_FAILED', 'the multipart body could not be parsed')),
    );
    parser.on('close', () => {
      if (tooLarge) reject(new ApiProblem('UPLOAD_TOO_LARGE', `the file exceeds ${maxBytes} bytes`));
      else if (invalid) reject(new ApiProblem('VALIDATION_FAILED', invalid));
      else if (!found) reject(new ApiProblem('VALIDATION_FAILED', 'the "file" part is required'));
      else resolve(Buffer.concat(chunks));
    });
    req.pipe(parser);
  });
}

/**
 * Exportación e importación del workspace (`identity/workspace-portability`, openspec add-workspace-export). Autorización
 * por `x-required-role` (guard de identidad) más la comprobación del servicio; la re-autenticación reciente se evalúa con el
 * claim `auth_time` del `Principal`. La descarga entrega el ZIP DESCIFRADO en streaming tras verificar todo el archivo.
 */
@Controller()
export class PortabilityController {
  constructor(
    @Inject(WORKSPACE_EXPORT_SERVICE) private readonly exports: ExportService,
    @Inject(WORKSPACE_IMPORT_SERVICE) private readonly imports: ImportService,
    @Inject(PORTABILITY_SETTINGS) private readonly settings: PortabilityHttpSettings,
    @Inject(API_CONVENTIONS) private readonly options: ApiConventionsOptions,
  ) {}

  private principal(req: ApiRequest) {
    const p = principalOf(req);
    if (!p) throw new ApiProblem('UNAUTHENTICATED', 'an authenticated user is required');
    if (!this.settings.enabled) {
      throw new ApiProblem(
        'SERVICE_UNAVAILABLE',
        'workspace export and import are not configured in this environment',
      );
    }
    return p;
  }

  @Post('workspaces/:workspaceId/exports')
  @HttpCode(202)
  async requestExport(
    @Req() req: ApiRequest,
    @Res({ passthrough: true }) res: ApiResponse,
    @Param('workspaceId') workspaceId: string,
  ) {
    const p = this.principal(req);
    await this.limit(p.userId, workspaceId);
    const view = await this.exports.requestExport({
      userId: p.userId,
      workspaceId,
      authTimeSeconds: p.authTime,
    });
    res.setHeader('location', `/api/v1/workspaces/${workspaceId}/operations/${view.operationId}`);
    return exportDto(view);
  }

  @Get('workspaces/:workspaceId/exports')
  async listExports(@Req() req: ApiRequest, @Param('workspaceId') workspaceId: string) {
    const p = this.principal(req);
    return { data: (await this.exports.listExports(p.userId, workspaceId)).map(exportDto) };
  }

  @Get('workspaces/:workspaceId/exports/:exportId')
  async getExport(
    @Req() req: ApiRequest,
    @Param('workspaceId') workspaceId: string,
    @Param('exportId') exportId: string,
  ) {
    const p = this.principal(req);
    return exportDto(await this.exports.getExport(p.userId, workspaceId, exportId));
  }

  @Get('workspaces/:workspaceId/exports/:exportId/download')
  async downloadExport(
    @Req() req: ApiRequest,
    @Res({ passthrough: true }) res: ApiResponse,
    @Param('workspaceId') workspaceId: string,
    @Param('exportId') exportId: string,
  ): Promise<StreamableFile> {
    const p = this.principal(req);
    const file = await this.exports.download({
      userId: p.userId,
      workspaceId,
      exportId,
      authTimeSeconds: p.authTime,
    });
    res.setHeader('cache-control', 'no-store');
    res.setHeader('x-content-type-options', 'nosniff');
    // RFC 9530: suma SHA-256 del ZIP en claro (representación), en base64 entre ':'.
    res.setHeader('repr-digest', `sha-256=:${Buffer.from(file.sha256, 'hex').toString('base64')}:`);
    return new StreamableFile(file.stream, {
      type: 'application/zip',
      disposition: `attachment; filename="${file.fileName}"`,
      length: file.size,
    });
  }

  @Post('workspaces/:workspaceId/exports/:exportId/discard')
  @HttpCode(200)
  async discardExport(
    @Req() req: ApiRequest,
    @Param('workspaceId') workspaceId: string,
    @Param('exportId') exportId: string,
  ) {
    const p = this.principal(req);
    return exportDto(await this.exports.discard(p.userId, workspaceId, exportId));
  }

  @Get('workspaces/:workspaceId/operations/:operationId')
  async getOperation(
    @Req() req: ApiRequest,
    @Param('workspaceId') workspaceId: string,
    @Param('operationId') operationId: string,
  ) {
    const p = this.principal(req);
    return operationDto(
      await this.exports.getOperation(p.userId, workspaceId, operationId),
      this.options.problemTypeBase,
    );
  }

  @Post('workspace-imports')
  @HttpCode(202)
  async requestImport(@Req() req: ApiRequest, @Res({ passthrough: true }) res: ApiResponse) {
    const p = this.principal(req);
    const declared = Number(req.headers['content-length']);
    // Rechazo temprano por tamaño declarado (con margen para los límites del multipart): no se lee el cuerpo.
    if (Number.isFinite(declared) && declared > this.settings.maxImportBytes + 64 * 1024) {
      req.resume();
      throw new ApiProblem('UPLOAD_TOO_LARGE', `the file exceeds ${this.settings.maxImportBytes} bytes`);
    }
    const file = await readUploadedFile(req, this.settings.maxImportBytes);
    const view = await this.imports.requestImport({ userId: p.userId, file, authTimeSeconds: p.authTime });
    res.setHeader('location', `/api/v1/workspace-imports/${view.id}`);
    return importDto(view);
  }

  @Get('workspace-imports/:importId')
  async getImport(@Req() req: ApiRequest, @Param('importId') importId: string) {
    const p = this.principal(req);
    return importDto(await this.imports.getImport(p.userId, importId));
  }

  /** 10 exportaciones por usuario y minuto sobre el `RateLimiter` de la API (429 `RATE_LIMITED` + `Retry-After`). */
  private async limit(userId: string, workspaceId: string): Promise<void> {
    const limiter = this.options.rateLimit?.limiter;
    if (!limiter) return;
    const decision = await limiter.consume(
      `${userId}:${workspaceId}`,
      EXPORT_REQUEST_POLICY,
      this.options.clock.now().toDate(),
    );
    if (!decision.allowed) {
      throw new ApiProblem('RATE_LIMITED', `quota "${EXPORT_REQUEST_POLICY.name}" exceeded`, {
        headers: {
          ...rateLimitHeaders(EXPORT_REQUEST_POLICY, decision),
          'retry-after': String(decision.retryAfterSeconds),
        },
      });
    }
  }
}
