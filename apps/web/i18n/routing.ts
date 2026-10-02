import { defineRouting } from 'next-intl/routing';

/** Español por defecto; catálogos preparados para inglés y portugués (openspec config: UI es + i18n en/pt). */
export const routing = defineRouting({
  locales: ['es', 'en', 'pt'],
  defaultLocale: 'es',
  localePrefix: 'as-needed',
});

export type Locale = (typeof routing.locales)[number];
