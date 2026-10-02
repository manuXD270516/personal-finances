export {
  LIVENESS_REPORT,
  ReadinessProbe,
  TimeoutError,
  type CheckFailureListener,
  type DependencyCheck,
  type DependencyStatus,
  type LivenessReport,
  type ReadinessReport,
} from './readiness.js';
export { postgresCheck } from './checks/postgres.js';
export { objectStorageCheck } from './checks/object-storage.js';
export { valkeyCheck } from './checks/valkey.js';
export { startHealthServer, type HealthServer, type HealthServerOptions } from './http-server.js';

/** Valkey solo es dependencia crítica si algún toggle lo exige (docs/19 §0.3 punto 6, ADR-0008). */
export function isValkeyEnabled(config: {
  readonly JOB_QUEUE_DRIVER: 'pgboss' | 'bullmq';
  readonly SESSION_STORE: 'postgres' | 'valkey';
}): boolean {
  return config.JOB_QUEUE_DRIVER === 'bullmq' || config.SESSION_STORE === 'valkey';
}
