'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';
import { ProblemMessage } from '../errors/ProblemMessage';
import { WorkspaceSelector } from './identity/IdentityViews';
import { localized, useSession } from './session-context';

/** Marco de las páginas autenticadas: saludo, selector de workspace activo, navegación y logout. */
export function AppFrame({ children }: { children: ReactNode }) {
  const t = useTranslations('App');
  const tHome = useTranslations('Home');
  const tAuth = useTranslations('Auth');
  const locale = useLocale();
  const { state, selectWorkspace, logout } = useSession();
  const [switching, setSwitching] = useState(false);

  if (state.status === 'loading') return <p data-testid="loading">{t('loading')}</p>;
  if (state.status === 'expired') {
    return (
      <main>
        <h1>{tAuth('expiredTitle')}</h1>
        <p role="alert">{tAuth('reasons.expired')}</p>
        {/* Route handler del BFF (redirección al IdP): requiere navegación completa, no <Link>. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a href="/api/bff/auth/login">{tAuth('login')}</a>
      </main>
    );
  }
  if (state.status === 'error') return <ProblemMessage problem={state.problem} locale={locale} />;

  const { me, active } = state;
  return (
    <>
      <header>
        <p data-testid="welcome">{tHome('greeting', { name: me.displayName })}</p>
        <WorkspaceSelector
          t={(key, values) => t(key as never, values as never)}
          memberships={me.memberships}
          activeId={active?.workspaceId}
          busy={switching}
          onSelect={(id) => {
            setSwitching(true);
            void selectWorkspace(id).finally(() => setSwitching(false));
          }}
        />
        <nav aria-label={t('nav')}>
          <a href={localized(locale, '/')}>{t('home')}</a> ·{' '}
          <a href={localized(locale, '/transacciones')}>{t('transactions')}</a> ·{' '}
          <a href={localized(locale, '/cuentas')}>{t('accounts')}</a> ·{' '}
          <a href={localized(locale, '/fx')}>{t('fx')}</a> ·{' '}
          <a href={localized(locale, '/clasificacion')}>{t('classification')}</a> ·{' '}
          <a href={localized(locale, '/configuracion')}>{t('settings')}</a> ·{' '}
          <a href={localized(locale, '/preferencias')}>{t('preferences')}</a> ·{' '}
          <a href={localized(locale, '/workspaces/nuevo')}>{t('newWorkspace')}</a>
        </nav>
        <button type="button" data-testid="logout" onClick={() => void logout()}>
          {t('logout')}
        </button>
        <span data-testid="ready" hidden>
          {t('ready')}
        </span>
      </header>
      {active?.isDemo ? (
        // Indicador persistente y no descartable (add-demo-data, FR-IDENTITY-014): toda pantalla del workspace demo.
        <p
          data-testid="demo-indicator"
          role="note"
          style={{
            margin: '0.5rem 0',
            padding: '0.5rem 0.75rem',
            border: '2px solid #9a6700',
            borderRadius: '0.375rem',
            background: '#fff8c5',
            color: '#3b2300',
            fontWeight: 600,
          }}
        >
          {t('demoIndicator')}
        </p>
      ) : null}
      <main>{children}</main>
    </>
  );
}
