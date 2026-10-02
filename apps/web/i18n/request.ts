import { hasLocale } from 'next-intl';
import { getRequestConfig } from 'next-intl/server';
import { routing } from './routing';

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale;
  return {
    locale,
    messages: {
      ...(await import(`../messages/${locale}.json`)).default,
      // Mensajes por `code` de error de la API (platform/api-conventions): `t('Errors.PERIOD_CLOSED')`.
      Errors: (await import(`../messages/errors.${locale}.json`)).default,
    },
    timeZone: 'America/La_Paz',
  };
});
