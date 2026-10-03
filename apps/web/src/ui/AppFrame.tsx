'use client';

import { useLocale, useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { ProblemMessage } from '../errors/ProblemMessage';
import { localized, useSession } from './session-context';

/** Marco de las páginas autenticadas: saludo, selector de workspace activo, navegación y logout. */
export function AppFrame({ children }: { children: ReactNode }) {
  const t = useTranslations('App');
  const tHome = useTranslations('Home');
  const tAuth = useTranslations('Auth');
  const locale = useLocale();
  const { state, selectWorkspace, logout } = useSession();

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
        <label>
          {t('activeWorkspace')}{' '}
          <select
            data-testid="workspace-selector"
            value={active?.workspaceId ?? ''}
            onChange={(e) => void selectWorkspace(e.target.value)}
          >
            {me.memberships.map((m) => (
              <option key={m.workspaceId} value={m.workspaceId}>
                {m.workspaceName}
              </option>
            ))}
          </select>
        </label>
        {active ? (
          <span data-testid="active-role"> {t('role', { role: t(`roles.${active.role}`) })}</span>
        ) : null}
        <nav aria-label={t('nav')}>
          <a href={localized(locale, '/')}>{t('home')}</a> ·{' '}
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
      <main>{children}</main>
    </>
  );
}
