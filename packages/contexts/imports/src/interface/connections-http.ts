import { createHash } from 'node:crypto';
import {
  Body,
  Controller,
  Delete,
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
import { ApiProblem } from '@pf/platform/api';
import { ExpectedVersion, apiState, principalOf, type ApiRequest, type ApiResponse } from '@pf/platform/nest';
import type { ConnectionsService } from '../application/banking/connections.service.js';
import type { AssetMapping } from '../domain/index.js';

export const CONNECTIONS_SERVICE = Symbol('CONNECTIONS_SERVICE');

type Json = Record<string, unknown>;

function userIdOf(req: ApiRequest): string {
  const principal = principalOf(req);
  if (!principal) throw new ApiProblem('UNAUTHENTICATED', 'an authenticated user is required');
  return principal.userId;
}

const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

function mappingsOf(raw: unknown, pointer: string): AssetMapping[] {
  if (!Array.isArray(raw)) throw new ApiProblem('VALIDATION_FAILED', `${pointer} must be an array`);
  return raw.map((m, i) => {
    if (!isObject(m) || typeof m['asset'] !== 'string' || typeof m['accountId'] !== 'string') {
      throw new ApiProblem('VALIDATION_FAILED', `${pointer}/${i} needs asset and accountId`);
    }
    return { asset: m['asset'], accountId: m['accountId'] };
  });
}

function credentialOf(raw: unknown): { keyId: string; secret: string } {
  if (!isObject(raw) || typeof raw['keyId'] !== 'string' || typeof raw['secret'] !== 'string') {
    throw new ApiProblem('VALIDATION_FAILED', 'credential needs keyId and secret');
  }
  const keyId = raw['keyId'].trim();
  const secret = raw['secret'];
  if (keyId.length < 4 || keyId.length > 256 || secret.length < 1 || secret.length > 1024) {
    throw new ApiProblem('VALIDATION_FAILED', 'credential has an invalid length');
  }
  return { keyId, secret };
}

/**
 * Guard de las operaciones con credencial: la clave de idempotencia se calcula con la HUELLA del identificador de la
 * clave, NUNCA con el secreto (openspec add-banking-providers decisión 3, NFR-SEC-015). Corre tras los guards globales y
 * antes de los interceptores de idempotencia; sin `Idempotency-Key` no hace nada.
 */
@Injectable()
export class ConnectionCredentialGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    if (ctx.getType() !== 'http') return true;
    const req = ctx.switchToHttp().getRequest<ApiRequest>();
    if (!principalOf(req) || !req.headers['idempotency-key']) return true;
    const body = (req as { body?: unknown }).body;
    if (!isObject(body)) return true;
    const credential = isObject(body['credential']) ? body['credential'] : body;
    const keyId = typeof credential['keyId'] === 'string' ? credential['keyId'] : '';
    // Nada del secreto (ni del identificador) entra al hash de la petición: solo la huella del identificador.
    const { credential: _credential, secret: _secret, keyId: _keyId, ...rest } = body;
    apiState(req).idempotencyPayload = {
      ...rest,
      keyFingerprint: keyId === '' ? null : createHash('sha256').update(keyId).digest('hex'),
    };
    return true;
  }
}

/**
 * `/api/v1/workspaces/{workspaceId}/imports/providers` y `…/imports/connections*` (openspec add-banking-providers §
 * Contratos). Roles (`x-required-role`): VIEWER lee; OWNER crea, mapea, reemplaza la credencial y revoca; EDITOR y OWNER
 * sincronizan. Las respuestas NUNCA llevan credenciales (solo la huella enmascarada). Este controlador se registra ANTES
 * que `ImportsController` para que `imports/connections` no se confunda con `imports/{importId}`.
 */
@Controller()
export class ConnectionsController {
  constructor(@Inject(CONNECTIONS_SERVICE) private readonly service: ConnectionsService) {}

  @Get('workspaces/:workspaceId/imports/providers')
  listBankingProviders() {
    return { data: this.service.providers() };
  }

  @Get('workspaces/:workspaceId/imports/connections')
  async listConnections(@Param('workspaceId') workspaceId: string) {
    return { data: await this.service.list(workspaceId) };
  }

  @Post('workspaces/:workspaceId/imports/connections')
  @HttpCode(202)
  @UseGuards(ConnectionCredentialGuard)
  async createConnection(
    @Req() req: ApiRequest,
    @Param('workspaceId') workspaceId: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ApiResponse,
  ) {
    if (!isObject(body) || typeof body['providerId'] !== 'string' || typeof body['name'] !== 'string') {
      throw new ApiProblem('VALIDATION_FAILED', 'providerId and name are required');
    }
    const view = await this.service.create({
      workspaceId,
      userId: userIdOf(req),
      providerId: body['providerId'],
      name: body['name'],
      assetMappings:
        body['assetMappings'] === undefined ? [] : mappingsOf(body['assetMappings'], '/assetMappings'),
      ...(body['credential'] === undefined ? {} : { credential: credentialOf(body['credential']) }),
    });
    // Un proveedor de archivo nace activo (201); con credencial queda pendiente de verificación (202).
    res.statusCode = view.status === 'ACTIVE' ? 201 : 202;
    res.setHeader('location', `/api/v1/workspaces/${workspaceId}/imports/connections/${view.id}`);
    return view;
  }

  @Get('workspaces/:workspaceId/imports/connections/:connectionId')
  getConnection(@Param('workspaceId') workspaceId: string, @Param('connectionId') connectionId: string) {
    return this.service.get(workspaceId, connectionId);
  }

  @Patch('workspaces/:workspaceId/imports/connections/:connectionId')
  async updateConnection(
    @Req() req: ApiRequest,
    @Param('workspaceId') workspaceId: string,
    @Param('connectionId') connectionId: string,
    @ExpectedVersion() expectedVersion: number,
    @Body() body: unknown,
  ) {
    if (!isObject(body)) throw new ApiProblem('VALIDATION_FAILED', 'a JSON object is required');
    if (body['name'] !== undefined && typeof body['name'] !== 'string') {
      throw new ApiProblem('VALIDATION_FAILED', 'name must be a string');
    }
    return this.service.update({
      workspaceId,
      userId: userIdOf(req),
      connectionId,
      expectedVersion,
      ...(typeof body['name'] === 'string' ? { name: body['name'] } : {}),
      ...(body['assetMappings'] === undefined
        ? {}
        : { assetMappings: mappingsOf(body['assetMappings'], '/assetMappings') }),
    });
  }

  @Put('workspaces/:workspaceId/imports/connections/:connectionId/credential')
  @HttpCode(202)
  @UseGuards(ConnectionCredentialGuard)
  replaceConnectionCredential(
    @Req() req: ApiRequest,
    @Param('workspaceId') workspaceId: string,
    @Param('connectionId') connectionId: string,
    @ExpectedVersion() expectedVersion: number,
    @Body() body: unknown,
  ) {
    return this.service.replaceCredential({
      workspaceId,
      userId: userIdOf(req),
      connectionId,
      expectedVersion,
      credential: credentialOf(body),
    });
  }

  @Post('workspaces/:workspaceId/imports/connections/:connectionId/revoke')
  @HttpCode(200)
  revokeConnection(
    @Req() req: ApiRequest,
    @Param('workspaceId') workspaceId: string,
    @Param('connectionId') connectionId: string,
    @ExpectedVersion() expectedVersion: number,
  ) {
    return this.service.revoke({ workspaceId, userId: userIdOf(req), connectionId, expectedVersion });
  }

  @Delete('workspaces/:workspaceId/imports/connections/:connectionId')
  deleteConnection(): never {
    // Las conexiones se revocan, nunca se eliminan (lo importado conserva su origen y la auditoría).
    throw new ApiProblem('METHOD_NOT_ALLOWED', 'connections are revoked, never deleted; use POST …/revoke', {
      headers: { allow: 'GET, PATCH' },
    });
  }

  @Post('workspaces/:workspaceId/imports/connections/:connectionId/sync')
  @HttpCode(202)
  async syncConnection(
    @Req() req: ApiRequest,
    @Param('workspaceId') workspaceId: string,
    @Param('connectionId') connectionId: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ApiResponse,
  ) {
    if (body !== undefined && body !== null && !isObject(body)) {
      throw new ApiProblem('VALIDATION_FAILED', 'a JSON object is required');
    }
    const from = isObject(body) && typeof body['from'] === 'string' ? body['from'] : undefined;
    const started = await this.service.sync({ workspaceId, userId: userIdOf(req), connectionId, from });
    res.setHeader('location', `/api/v1/workspaces/${workspaceId}/imports/${started.importJobId}`);
    return { importJobId: started.importJobId, window: started.window };
  }
}
