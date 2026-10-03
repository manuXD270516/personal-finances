import en from '../../messages/errors.en.json';
import es from '../../messages/errors.es.json';
import pt from '../../messages/errors.pt.json';

export type ErrorMessages = Readonly<Record<string, string>>;

/**
 * Catálogos de mensajes de error por `code` (docs/10 §9: la UI traduce por `code`, nunca muestra el `title`
 * técnico ni el código crudo). Español es el canónico; `en`/`pt` mantienen exactamente las mismas claves.
 */
export const ERROR_MESSAGES: Readonly<Record<'es' | 'en' | 'pt', ErrorMessages>> = { es, en, pt };

/** Forma mínima de un Problem Details (RFC 9457) que la UI necesita. */
export interface ProblemLike {
  readonly code?: unknown;
  readonly requestId?: unknown;
}

/** Códigos del catálogo sin mensaje en un locale (vacío ⇒ completo). Lo usa el test de catálogo (TC-PLATFORM-API-005). */
export const missingMessages = (codes: readonly string[], messages: ErrorMessages): string[] =>
  codes.filter((code) => typeof messages[code] !== 'string' || messages[code].trim() === '');

/**
 * Mensaje accionable para un problem: el del `code`; un `code` desconocido (el enum es abierto) cae en el mensaje
 * genérico de `INTERNAL_ERROR`. Nunca devuelve `title` ni `detail` (inglés técnico).
 */
export function problemMessage(problem: ProblemLike, locale: string): string {
  const catalog = ERROR_MESSAGES[locale as keyof typeof ERROR_MESSAGES] ?? ERROR_MESSAGES.es;
  const code = typeof problem.code === 'string' ? problem.code : 'INTERNAL_ERROR';
  return catalog[code] ?? catalog['INTERNAL_ERROR'] ?? ERROR_MESSAGES.es['INTERNAL_ERROR'] ?? '';
}
