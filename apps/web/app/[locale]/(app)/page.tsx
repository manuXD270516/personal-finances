import { useTranslations } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';
import { use } from 'react';
import { routing } from '../../../i18n/routing';

export default function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = use(params);
  setRequestLocale(locale);
  const t = useTranslations('Home');
  return (
    <section>
      <h1>{t('title')}</h1>
      <p>{t('subtitle')}</p>
      <nav aria-label={t('language')}>
        {routing.locales.map((l) => (
          <a key={l} href={l === routing.defaultLocale ? '/' : `/${l}`} hrefLang={l}>
            {l.toUpperCase()}
          </a>
        ))}
      </nav>
    </section>
  );
}
