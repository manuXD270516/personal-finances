import type { Metadata } from 'next';
import { useTranslations } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { use } from 'react';
import { routing } from '../../../i18n/routing';
import { Dashboard } from '../../../src/ui/dashboard/Dashboard';

/**
 * `<title>` y descripción del Home por locale (Metadata API de Next; el layout raíz aplica la plantilla
 * "%s · PFOS"). Es una página autenticada con datos personales: no se indexa ni se siguen sus enlaces.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'Home' });
  return {
    title: t('metaTitle'),
    description: t('metaDescription'),
    robots: { index: false, follow: false },
  };
}

export default function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = use(params);
  setRequestLocale(locale);
  const t = useTranslations('Home');
  return (
    <section aria-labelledby="home-title" style={{ display: 'grid', gap: '1rem', minWidth: 0 }}>
      <div>
        <h1 id="home-title" style={{ margin: 0 }}>
          {t('title')}
        </h1>
        <p style={{ margin: '0.25rem 0 0', color: '#475569' }}>{t('subtitle')}</p>
      </div>
      <Dashboard />
      <nav aria-label={t('language')}>
        {routing.locales.map((l, i) => (
          <span key={l}>
            {i > 0 ? ' · ' : null}
            <a href={l === routing.defaultLocale ? '/' : `/${l}`} hrefLang={l} lang={l}>
              {l.toUpperCase()}
            </a>
          </span>
        ))}
      </nav>
    </section>
  );
}
