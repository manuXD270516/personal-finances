import { readFileSync } from 'node:fs';
import { createTranslator } from 'next-intl';
import type { FormatContext } from './dashboard/types';

const messages = JSON.parse(
  readFileSync(new URL('../../messages/es.json', import.meta.url), 'utf8'),
) as Record<string, unknown>;

/** Contexto de formato es-BO / America/La_Paz con el catálogo `es` real de un namespace (tests de componentes). */
export function esContext(namespace: string): FormatContext {
  const tr = createTranslator({ locale: 'es', messages, namespace: namespace as never });
  return {
    locale: 'es-BO',
    timeZone: 'America/La_Paz',
    t: (key, values) => tr(key as never, values as never),
    has: (key) => tr.has(key as never),
  };
}

/** Texto visible de un HTML estático (sin etiquetas). */
export const textOf = (html: string): string => html.replace(/<[^>]+>/g, '');
