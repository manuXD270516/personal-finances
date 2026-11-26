import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { hasLocale, NextIntlClientProvider } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { connection } from 'next/server';
import type { ReactNode } from 'react';
import { routing } from '../../i18n/routing';
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
  return (
    <html lang={locale}>
      <body>
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
