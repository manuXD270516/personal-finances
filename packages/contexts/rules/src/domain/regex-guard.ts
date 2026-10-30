import { DomainError, InvalidLinearRegexError, LinearRegex } from '@pf/shared-kernel';

/**
 * `RegexGuard` (openspec add-rule-engine, decisión 9): único punto por el que RULES compila expresiones regulares.
 * Usa el motor de TIEMPO LINEAL de `@pf/shared-kernel` (puerto JS de RE2): sin referencias hacia atrás ni lookaround,
 * patrón de hasta 200 caracteres, texto de hasta 500. La garantía es estructural (no hay temporizadores): ningún
 * patrón aceptado puede bloquear la evaluación. Un patrón rechazado ⇒ `RULE_INVALID_REGEX` (422).
 */
export const RegexGuard = {
  compile(pattern: string, pointer: string): LinearRegex {
    try {
      return LinearRegex.compile(pattern);
    } catch (err) {
      if (err instanceof InvalidLinearRegexError) {
        throw new DomainError('RULE_INVALID_REGEX', `invalid regular expression: ${err.message}`).at(pointer);
      }
      throw err;
    }
  },
};
