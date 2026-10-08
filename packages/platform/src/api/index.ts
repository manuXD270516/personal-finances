/**
 * `@pf/platform/api` — convenciones transversales de la API (openspec `platform/api-conventions`), sin NestJS:
 * catálogo de errores y Problem Details, contrato OpenAPI (Ajv), política/almacenes de idempotencia, cursores
 * firmados, límite de tasa y transacción por comando. Los adaptadores Nest viven en `@pf/platform/nest`.
 */
export {
  ERROR_CATALOG,
  ErrorCatalog,
  DEFAULT_PROBLEM_TYPE_BASE,
  isErrorCode,
  kebabCode,
  type ErrorCatalogEntry,
  type ErrorCode,
} from './errors/error-catalog.js';
export {
  ApiProblem,
  DependencyUnavailableError,
  PROBLEM_CONTENT_TYPE,
  concurrencyConflict,
  isDependencyUnavailable,
  preconditionFailed,
  renderProblem,
  type HttpResponseSnapshot,
  type ProblemBody,
  type ProblemField,
  type RenderContext,
  type RenderedProblem,
} from './errors/problem.js';
export {
  ApiContract,
  ajvErrorsToFields,
  type ApiContractOptions,
  type ContractOperation,
  type ContractParameter,
  type DeprecationInfo,
  type RequestInput,
  type RequestValidation,
  type ValidatedRequest,
} from './contract/api-contract.js';
export {
  DEFAULT_LOCK_TTL_MS,
  IdempotencyPolicy,
  MAX_RETENTION_MS,
  MIN_RETENTION_MS,
  isStorableStatus,
  type CommandContext,
  type IdempotencyPolicyOptions,
  type IdempotentOutcome,
  type IdempotentRequest,
} from './idempotency/policy.js';
export { canonicalJson, idempotencyRequestHash } from './idempotency/request-hash.js';
export {
  ReservationLostError,
  scopeIdOf,
  type IdempotencyScope,
  type IdempotencyStore,
  type ReservationRef,
  type ReserveRequest,
  type ReserveResult,
  type SqlExecutor,
} from './idempotency/store.js';
export { InMemoryIdempotencyStore } from './idempotency/memory-store.js';
export { PgIdempotencyStore, purgeExpiredIdempotencyKeys } from './idempotency/pg-store.js';
export {
  PgCommandTransaction,
  PgUnitOfWork,
  requireSqlExecutor,
  setRlsContext,
  type AuthContext,
  applyRlsContext,
  currentSqlExecutor,
  type CommandTransaction,
  type TransactionOptions,
  isRetryableConflict,
} from './db/command-transaction.js';
export { unitOfWorkKysely } from './db/uow-kysely.js';
export {
  CursorCodec,
  DEFAULT_PAGE_LIMIT,
  MAX_PAGE_LIMIT,
  buildPage,
  ephemeralCursorKey,
  parseCursorKeys,
  type CursorKey,
  type CursorPosition,
  type CursorScope,
  type Page,
  type PageInfo,
} from './pagination/cursor-codec.js';
export {
  InMemoryRateLimiter,
  rateLimitHeaders,
  type RateLimitDecision,
  type RateLimitPolicy,
  type RateLimiter,
} from './rate-limit/rate-limiter.js';
export {
  DEFAULT_JWT_ALGORITHMS,
  JwtVerifier,
  type JwtVerifierOptions,
  type OidcProfile,
  type VerifiedAccessToken,
} from './auth/jwt-verifier.js';
export { JWKS_METRICS, JwksCache, type JwksCacheOptions, type JwksObserver } from './auth/jwks-cache.js';
export {
  currentRequestContext,
  runWithRequestContext,
  updateRequestContext,
  uuidFromOpaqueId,
  type RequestActor,
  type RequestContext,
  type RequestOrigin,
} from './context/request-context.js';
