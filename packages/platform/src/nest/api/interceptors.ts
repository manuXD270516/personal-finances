import {
  Inject,
  Injectable,
  type CallHandler,
  type CanActivate,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { from, lastValueFrom, map, mergeMap, of, throwError, type Observable } from 'rxjs';
import {
  ApiProblem,
  rateLimitHeaders,
  type CommandContext,
  type HttpResponseSnapshot,
  type RateLimitDecision,
} from '../../api/index.js';
import { API_CONVENTIONS, renderException, snapshotResponse, type ApiConventionsOptions } from './options.js';
import {
  NotModifiedResponse,
  ReplayedResponse,
  apiState,
  headerValue,
  principalOf,
  type ApiRequest,
  type ApiResponse,
} from './request-context.js';

const http = (ctx: ExecutionContext) => ({
  req: ctx.switchToHttp().getRequest<ApiRequest>(),
  res: ctx.switchToHttp().getResponse<ApiResponse>(),
});

const routeOf = (req: ApiRequest): string | undefined =>
  typeof req.route?.path === 'string' ? req.route.path : undefined;

const hasBody = (req: ApiRequest): boolean =>
  req.headers['transfer-encoding'] !== undefined || Number(req.headers['content-length'] ?? 0) > 0;

/**
 * Límite de tasa por usuario y por workspace (token bucket, design §8): lecturas y escrituras con cuotas propias,
 * cabeceras `RateLimit`/`RateLimit-Policy` en cada respuesta de la API y 429 `RATE_LIMITED` + `Retry-After` sin
 * ejecutar la operación. Guard ⇒ corre antes de validación, idempotencia y el handler.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(@Inject(API_CONVENTIONS) private readonly options: ApiConventionsOptions) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const rate = this.options.rateLimit;
    if (!rate || ctx.getType() !== 'http') return true;
    const { req, res } = http(ctx);
    const route = routeOf(req);
    const op = route ? this.options.contract.find(req.method ?? 'GET', route) : undefined;
    if (!op) return true;
    const policy = op.method === 'GET' ? rate.reads : rate.writes;
    const now = this.options.clock.now().toDate();
    const userKey = principalOf(req)?.userId ?? `ip:${req.ip ?? req.socket.remoteAddress ?? 'unknown'}`;
    const keys = [`user:${userKey}`];
    const workspaceId = op.hasWorkspaceScope ? req.params?.['workspaceId'] : undefined;
    if (workspaceId) keys.push(`workspace:${workspaceId}`);

    let tightest: RateLimitDecision | undefined;
    for (const key of keys) {
      const decision = await rate.limiter.consume(key, policy, now);
      if (!decision.allowed) {
        throw new ApiProblem('RATE_LIMITED', `quota "${policy.name}" exceeded`, {
          headers: {
            ...rateLimitHeaders(policy, decision),
            'retry-after': String(decision.retryAfterSeconds),
          },
        });
      }
      if (!tightest || decision.remaining < tightest.remaining) tightest = decision;
    }
    if (tightest)
      for (const [k, v] of Object.entries(rateLimitHeaders(policy, tightest))) res.setHeader(k, v);
    return true;
  }
}

/**
 * Validación de toda petición contra el schema de su operación (Ajv 2020-12 compilado desde el contrato) ANTES de
 * llegar al caso de uso. Falta `Idempotency-Key` obligatoria ⇒ 428 `IDEMPOTENCY_KEY_REQUIRED`; falta `If-Match`
 * ⇒ 428 `PRECONDITION_REQUIRED`; cualquier otra desviación ⇒ 400 `VALIDATION_FAILED` con `errors[]`.
 * (Interceptor y no pipe: un pipe no ve la ruta ni las cabeceras de la operación.)
 */
@Injectable()
export class ContractValidationInterceptor implements NestInterceptor {
  constructor(@Inject(API_CONVENTIONS) private readonly options: ApiConventionsOptions) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (ctx.getType() !== 'http') return next.handle();
    const { req } = http(ctx);
    const route = routeOf(req);
    const op = route ? this.options.contract.find(req.method ?? 'GET', route) : undefined;
    if (!op) return next.handle();
    const state = apiState(req);
    state.operation = op;

    if (op.idempotency === 'required' && !headerValue(req, 'idempotency-key')) {
      throw new ApiProblem('IDEMPOTENCY_KEY_REQUIRED', 'this operation requires the Idempotency-Key header');
    }
    if (op.requiresIfMatch && !headerValue(req, 'if-match')) {
      throw new ApiProblem('PRECONDITION_REQUIRED', 'this operation requires the If-Match header');
    }
    const result = op.validateRequest({
      params: req.params ?? {},
      query: req.query ?? {},
      headers: req.headers,
      body: req.body,
      contentType: headerValue(req, 'content-type'),
      hasBody: hasBody(req),
    });
    if (!result.ok)
      throw new ApiProblem('VALIDATION_FAILED', 'the request does not match the contract', {
        fields: result.fields,
      });
    state.validated = result.value;
    return next.handle();
  }
}

const toImfDate = (isoDate: string) => new Date(`${isoDate}T00:00:00Z`).toUTCString();

/** Operaciones `deprecated: true` responden `Deprecation` (RFC 9745), `Sunset` (RFC 8594) y `Link` (design §7). */
@Injectable()
export class DeprecationInterceptor implements NestInterceptor {
  constructor(@Inject(API_CONVENTIONS) private readonly options: ApiConventionsOptions) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (ctx.getType() !== 'http') return next.handle();
    const { req, res } = http(ctx);
    const op = apiState(req).operation;
    const info = op?.deprecation;
    if (op && info) {
      if (info.deprecatedAt) {
        res.setHeader('deprecation', `@${Math.floor(Date.parse(`${info.deprecatedAt}T00:00:00Z`) / 1000)}`);
      } else {
        res.setHeader('deprecation', '?1');
      }
      if (info.sunset) res.setHeader('sunset', toImfDate(info.sunset));
      const link =
        info.link ?? new URL(`/deprecations/${op.operationId}`, this.options.problemTypeBase).toString();
      res.setHeader('link', `<${link}>; rel="deprecation"`);
    }
    return next.handle();
  }
}

/**
 * Idempotencia dirigida por el contrato (operaciones con `IdempotencyKey`/`IdempotencyKeyOptional`, design §3).
 * Con `transaction` configurada, el handler corre dentro de la transacción del comando y la respuesta se confirma
 * en esa misma transacción (exactly-once). Las reproducciones salen con `Idempotent-Replayed: true`.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(@Inject(API_CONVENTIONS) private readonly options: ApiConventionsOptions) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (ctx.getType() !== 'http') return next.handle();
    const { req, res } = http(ctx);
    const state = apiState(req);
    const op = state.operation;
    const key = headerValue(req, 'idempotency-key');
    if (!op || op.idempotency === 'none' || !key) return next.handle();
    const principal = principalOf(req);
    if (!principal) throw new ApiProblem('UNAUTHENTICATED', 'an authenticated user is required');
    const workspaceId = op.hasWorkspaceScope ? req.params?.['workspaceId'] : undefined;
    const scope = { userId: principal.userId, ...(workspaceId ? { workspaceId } : {}) };
    const { policy, transaction } = this.options.idempotency;

    let handlerBody: unknown;
    const run = async (command: CommandContext): Promise<HttpResponseSnapshot> => {
      if (transaction) {
        return transaction.run(scope, async (tx) => {
          handlerBody = await lastValueFrom(next.handle(), { defaultValue: undefined });
          const snapshot = snapshotResponse(res, handlerBody);
          await command.complete(snapshot, tx);
          return snapshot;
        });
      }
      handlerBody = await lastValueFrom(next.handle(), { defaultValue: undefined });
      return snapshotResponse(res, handlerBody);
    };

    return from(
      policy.execute(
        { scope, key, method: op.method, route: op.path, body: state.validated?.body ?? req.body },
        run,
        (err) => renderException(err, req, res, this.options).response,
      ),
    ).pipe(
      mergeMap((outcome) =>
        outcome.replayed ? throwError(() => new ReplayedResponse(outcome.response)) : of(handlerBody),
      ),
    );
  }
}

const ETAG_ITEM = /^(W\/)?"([^"]*)"$/;

/** Lista de entity-tags de `If-None-Match`; comparación débil (RFC 9110 §13.1.2). */
function noneMatch(header: string, etag: string): boolean {
  if (header.trim() === '*') return true;
  const target = ETAG_ITEM.exec(etag)?.[2];
  return header.split(',').some((item) => ETAG_ITEM.exec(item.trim())?.[2] === target);
}

/**
 * Concurrencia optimista (design §4): `If-Match: "<version>"` se valida y expone al handler como
 * `@ExpectedVersion()`; las respuestas de agregados con `version` llevan `ETag` fuerte; un GET con `If-None-Match`
 * vigente responde 304 sin cuerpo.
 */
@Injectable()
export class ConditionalRequestInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (ctx.getType() !== 'http') return next.handle();
    const { req, res } = http(ctx);
    const state = apiState(req);
    const op = state.operation;
    if (!op) return next.handle();
    if (op.requiresIfMatch) {
      const raw = headerValue(req, 'if-match') ?? '';
      const m = /^"([1-9]\d{0,9})"$/.exec(raw.trim());
      if (!m) {
        throw new ApiProblem('VALIDATION_FAILED', 'If-Match must be a strong entity tag such as "7"', {
          fields: [
            {
              pointer: '/If-Match',
              code: 'VALIDATION_FAILED',
              detail: 'must be a strong ETag "<version>"',
              in: 'header',
            },
          ],
        });
      }
      state.expectedVersion = Number(m[1]);
    }
    return next.handle().pipe(
      map((body: unknown) => {
        const version = (body as { version?: unknown } | null | undefined)?.version;
        if (Number.isInteger(version) && res.getHeader('etag') === undefined)
          res.setHeader('etag', `"${String(version)}"`);
        const etag = res.getHeader('etag');
        const ifNoneMatch = headerValue(req, 'if-none-match');
        if (
          op.method === 'GET' &&
          op.supportsIfNoneMatch &&
          ifNoneMatch &&
          typeof etag === 'string' &&
          noneMatch(ifNoneMatch, etag)
        ) {
          throw new NotModifiedResponse(etag);
        }
        return body;
      }),
    );
  }
}
