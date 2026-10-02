/**
 * Puerto de Unit of Work compartido (ADR-0003, ADR-0007). Framework-free.
 * En producción el adapter envolverá una transacción Kysely; aquí hay un fake en memoria.
 */
export interface UnitOfWork {
  /** Ejecuta `work` dentro de una transacción. Las llamadas anidadas reutilizan la transacción activa. */
  run<T>(work: () => Promise<T>): Promise<T>;
}

/** Token de DI agnóstico de framework (un Symbol, no un decorador). */
export const UNIT_OF_WORK = Symbol.for('pf.platform.UnitOfWork');
export const ID_GENERATOR = Symbol.for('pf.platform.IdGenerator');
