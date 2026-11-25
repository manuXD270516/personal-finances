import { getTranslations } from 'next-intl/server';

/**
 * 404 propio, renderizado por petición con la CSP de la web: el de Next se prerenderiza en el build, sin nonce, y trae un
 * `<style>` en línea (add-web-content-security-policy).
 */
export default async function LocaleNotFound() {
  const t = await getTranslations('NotFound');
  return (
    <main className="pf-status">
      <h1>{t('title')}</h1>
      <p>{t('body')}</p>
      {/* Navegación completa al inicio: el proxy resuelve la sesión y el locale. */}
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
      <a href="/">{t('home')}</a>
    </main>
  );
}
