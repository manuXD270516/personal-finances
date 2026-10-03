import en from '../../messages/errors.en.json';
import es from '../../messages/errors.es.json';
import pt from '../../messages/errors.pt.json';

export type ErrorMessages = Readonly<Record<string, string>>;

/**
 * Catálogos de mensajes de error por `code` (docs/10 §9: la UI traduce por `code`, nunca muestra el `title`
 * técnico ni el código crudo). Español es el canónico; `en`/`pt` mantienen exactamente las mismas claves.
 */
export const ERROR_MESSAGES: Readonly<Record<'es' | 'en' | 'pt', ErrorMessages>> = { es, en, pt };

/**
 * Códigos propios del BFF (no forman parte del contrato de finance-api ni de su `ErrorCatalog`; design § Contratos).
 */
export const BFF_ERROR_MESSAGES: Readonly<Record<'es' | 'en' | 'pt', ErrorMessages>> = {
  es: {
    CSRF_REJECTED:
      'No pudimos verificar que la solicitud venga de esta página. Recarga la página e inténtalo de nuevo.',
  },
  en: { CSRF_REJECTED: "We couldn't verify that the request came from this page. Reload and try again." },
  pt: {
    CSRF_REJECTED:
      'Não conseguimos verificar que a solicitação veio desta página. Recarregue e tente novamente.',
  },
};

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
  const key = (locale in ERROR_MESSAGES ? locale : 'es') as keyof typeof ERROR_MESSAGES;
  const catalog = ERROR_MESSAGES[key];
  const code = typeof problem.code === 'string' ? problem.code : 'INTERNAL_ERROR';
  return (
    catalog[code] ??
    BFF_ERROR_MESSAGES[key][code] ??
    catalog['INTERNAL_ERROR'] ??
    ERROR_MESSAGES.es['INTERNAL_ERROR'] ??
    ''
  );
}
