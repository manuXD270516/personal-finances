import { RE2JS } from 're2js';

/** Longitud máxima del patrón y del texto evaluado (openspec add-rule-engine, decisión 9). */
export const LINEAR_REGEX_MAX_PATTERN = 200;
export const LINEAR_REGEX_MAX_TEXT = 500;

/** Patrón rechazado: inválido, demasiado largo o con construcciones sin tiempo lineal. */
export class InvalidLinearRegexError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidLinearRegexError';
  }
}

/**
 * Expresión regular con garantía ESTRUCTURAL de tiempo lineal en el largo del texto (puerto JS de RE2: autómata sin
 * retroceso): no hay referencias hacia atrás ni lookaround y ningún patrón aceptado puede bloquear la evaluación, sin
 * depender de relojes (no deterministas en CI). Ignora mayúsculas; el llamador normaliza el texto antes de evaluar.
 */
export class LinearRegex {
  private constructor(private readonly compiled: RE2JS) {}

  /** Compila `pattern`; lanza `InvalidLinearRegexError` si no es válido para el motor lineal. */
  static compile(pattern: string): LinearRegex {
    if (pattern.length === 0) throw new InvalidLinearRegexError('the pattern is empty');
    if (pattern.length > LINEAR_REGEX_MAX_PATTERN) {
      throw new InvalidLinearRegexError(`the pattern has more than ${LINEAR_REGEX_MAX_PATTERN} characters`);
    }
    // Referencias hacia atrás (`\1`…`\9`, `\k<n>`) y lookaround: el motor las rechaza; se verifican antes para dar un
    // mensaje claro y por si una versión futura las admitiera.
    if (/(^|[^\\])(\\\\)*\\([1-9]|k<)/u.test(pattern)) {
      throw new InvalidLinearRegexError('back-references are not allowed');
    }
    if (/\(\?(=|!|<=|<!)/u.test(pattern)) {
      throw new InvalidLinearRegexError('lookaround is not allowed');
    }
    try {
      return new LinearRegex(RE2JS.compile(pattern, RE2JS.CASE_INSENSITIVE));
    } catch (err) {
      throw new InvalidLinearRegexError(err instanceof Error ? err.message : 'invalid pattern');
    }
  }

  /** `true` si el patrón coincide en alguna parte de los primeros 500 caracteres del texto. */
  test(text: string): boolean {
    return this.compiled.matcher(text.slice(0, LINEAR_REGEX_MAX_TEXT)).find();
  }
}
