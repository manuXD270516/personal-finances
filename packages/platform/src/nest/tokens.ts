/** Tokens de inyección agnósticos de Nest (Symbol.for), como en SPIKE-04. */
export const READINESS_PROBE = Symbol.for('pf.platform.ReadinessProbe');
export const LOGGER = Symbol.for('pf.platform.Logger');
export const JOB_QUEUE = Symbol.for('pf.platform.JobQueue');
export const PLATFORM_DIAGNOSTICS = Symbol.for('pf.platform.Diagnostics');
