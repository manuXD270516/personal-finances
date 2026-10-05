import { getTranslations, setRequestLocale } from 'next-intl/server';

const REASONS = ['state', 'idp', 'callback', 'provision', 'expired'] as const;
type Reason = (typeof REASONS)[number] | 'unknown';

export const dynamic = 'force-dynamic';

/** Página pública de error de login / sesión expirada (textos del catálogo i18n; español por defecto). */
export default async function AuthErrorPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ reason?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { reason: raw } = await searchParams;
  const reason: Reason = (REASONS as readonly string[]).includes(raw ?? '') ? (raw as Reason) : 'unknown';
  const t = await getTranslations({ locale, namespace: 'Auth' });
  return (
    <main className="pf-status">
      <h1>{reason === 'expired' ? t('expiredTitle') : t('errorTitle')}</h1>
      <p role="alert" data-reason={reason}>
        {t(`reasons.${reason}`)}
      </p>
      {/* Route handler del BFF (redirección al IdP): requiere navegación completa, no <Link>. */}
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
      <a href="/api/bff/auth/login">{t('login')}</a>
    </main>
  );
}
