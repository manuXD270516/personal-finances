import type { Metadata, Viewport } from 'next';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { hasLocale, NextIntlClientProvider } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { connection } from 'next/server';
import type { ReactNode } from 'react';
import { routing } from '../../i18n/routing';
import { THEME_COLOR, THEME_COOKIE, themeSchemeFromCookie } from '../../src/ui/common/theme';
// Tokens y estilos base globales (docs/28 §5): hoja estática propia, compatible con `style-src 'self'`.
import '../globals.css';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'Metadata' });
  // Las páginas hijas declaran su propio título ("Inicio · PFOS"); sin él se usa el del producto.
  return { title: { default: t('title'), template: '%s · PFOS' }, description: t('description') };
}

/**
 * Tema del documento sin scripts en línea (add-dark-theme, decisiones 6 y 7): la cookie espejo `pfos_theme` fija
 * `color-scheme` y `theme-color` en el HTML del servidor. Sin cookie (o con un valor ajeno) manda el sistema: los dos
 * esquemas y un `theme-color` por `prefers-color-scheme`.
 */
export async function generateViewport(): Promise<Viewport> {
  const scheme = themeSchemeFromCookie((await cookies()).get(THEME_COOKIE)?.value);
  if (scheme) return { colorScheme: scheme, themeColor: THEME_COLOR[scheme] };
  return {
    colorScheme: 'light dark',
    themeColor: [
      { media: '(prefers-color-scheme: light)', color: THEME_COLOR.light },
      { media: '(prefers-color-scheme: dark)', color: THEME_COLOR.dark },
    ],
  };
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  // CSP con nonce por petición (add-web-content-security-policy, NFR-SEC-008): una página prerenderizada en el build no
  // tiene nonce y sus scripts quedarían bloqueados. `connection()` fuerza el renderizado por petición en todo el árbol,
  // por eso el layout ya no declara `generateStaticParams`.
  await connection();
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const theme = themeSchemeFromCookie((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <html lang={locale} data-theme={theme}>
      <body>
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
