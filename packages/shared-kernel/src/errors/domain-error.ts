/**
 * Error de dominio con `code` estable (catálogo `ErrorCode` del contrato, docs/10 §9.1).
 *
 * - `code` es contrato para el cliente: la UI traduce por `code`, nunca por el mensaje.
 * - `message` es inglés técnico (logs y desarrolladores); jamás datos de otro workspace ni secretos.
 * - `violations` lleva los errores por campo (JSON Pointer RFC 6901 dentro del cuerpo de la petición). El dominio
 *   no conoce la forma HTTP del request: la capa interface ubica el error con `at(pointer)`.
 *
 * Sin dependencias de framework (shared-kernel, ADR-0003): el mapeo `code → status HTTP` vive en
 * `@pf/platform` (`ErrorCatalog`).
 */
export interface FieldViolation {
  /** JSON Pointer (RFC 6901) al campo del cuerpo de la petición, p. ej. `/splits/0/amount`. */
  readonly pointer: string;
  readonly code: string;
  readonly detail?: string;
}

const CODE = /^[A-Z][A-Z0-9_]*$/;

export class DomainError extends Error {
  override readonly name: string = 'DomainError';
  readonly code: string;
  readonly violations: readonly FieldViolation[];
  /**
   * Datos estructurados del error que el cliente necesita para recuperarse (p. ej. `currentVersion` en
   * `PRECONDITION_FAILED`, docs/10 §6). La plataforma decide cuáles publica como extensión del problem.
   */
  readonly details: Readonly<Record<string, unknown>>;

  constructor(
    code: string,
    message: string,
    options: {
      readonly violations?: readonly FieldViolation[];
      readonly details?: Readonly<Record<string, unknown>>;
      readonly cause?: unknown;
    } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    if (!CODE.test(code)) throw new TypeError(`DomainError: code inválido '${code}' (UPPER_SNAKE_CASE)`);
    this.code = code;
    this.violations = Object.freeze([...(options.violations ?? [])]);
    this.details = Object.freeze({ ...(options.details ?? {}) });
  }

  /**
   * Mismo error ubicado en un campo del cuerpo: agrega una violación `{ pointer, code }`. No muta `this`.
   * `pointer` debe ser un JSON Pointer ("" o que empiece por "/").
   */
  at(pointer: string): DomainError {
    if (pointer !== '' && !pointer.startsWith('/')) {
      throw new TypeError(`DomainError.at: '${pointer}' no es un JSON Pointer`);
    }
    return new DomainError(this.code, this.message, {
      violations: [...this.violations, { pointer, code: this.code, detail: this.message }],
      details: this.details,
      cause: this.cause,
    });
  }
}

export const isDomainError = (value: unknown): value is DomainError => value instanceof DomainError;

/** Escapa un segmento para JSON Pointer (RFC 6901 §4: `~` → `~0`, `/` → `~1`). */
export const pointerSegment = (segment: string | number): string =>
  String(segment).replaceAll('~', '~0').replaceAll('/', '~1');

/** Construye un JSON Pointer a partir de sus segmentos: `jsonPointer('splits', 0, 'amount')` → `/splits/0/amount`. */
export const jsonPointer = (...segments: readonly (string | number)[]): string =>
  segments.map((s) => `/${pointerSegment(s)}`).join('');
