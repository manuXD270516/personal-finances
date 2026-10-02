/**
 * @pf/platform — capacidades técnicas transversales (sin lógica de negocio). Entry points:
 *
 * | Subpath                       | Contenido                                                            |
 * |-------------------------------|----------------------------------------------------------------------|
 * | `@pf/platform/config`         | Contrato único de configuración (zod), fail-fast, generador de docs  |
 * | `@pf/platform/logging`        | Logger pino JSON con redacción, correlación (AsyncLocalStorage)      |
 * | `@pf/platform/health`         | Liveness/readiness y chequeos de PostgreSQL, S3 y Valkey             |
 * | `@pf/platform/queue`          | Puerto `JobQueue` + adapter pg-boss con envelope de correlación      |
 * | `@pf/platform/storage`        | Cliente S3 configurado (ADR-0009)                                    |
 * | `@pf/platform/lifecycle`      | Apagado ordenado (SIGTERM)                                           |
 * | `@pf/platform/nest`           | Adaptadores NestJS (health controller, middleware, interceptor OTel) |
 * | `@pf/platform/otel/register`  | Bootstrap OTel para `node --import` (ESM)                            |
 *
 * Este índice solo reexporta lo liviano (config y logging) para no arrastrar Nest/pg/S3 a quien no los use.
 */
export * from './config/index.js';
export * from './logging/index.js';
