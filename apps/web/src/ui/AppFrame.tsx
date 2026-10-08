'use client';

import { useLocale, useTranslations } from 'next-intl';
import { usePathname } from 'next/navigation';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { routing } from '../../i18n/routing';
import { ProblemMessage } from '../errors/ProblemMessage';
import { WorkspaceSelector } from './identity/IdentityViews';
import { switchLocalePath, type UiLocale } from './identity/logic';
import { localized, useSession } from './session-context';
import { activeNav, initialOf, NAV_ITEMS, type NavKey } from './shell/nav';

/** Nombre de cada idioma de la UI en el catálogo `Locales`. */
const LOCALE_NAME: Record<UiLocale, 'es-BO' | 'en-US' | 'pt-BR'> = { es: 'es-BO', en: 'en-US', pt: 'pt-BR' };

/**
 * Marco de las páginas autenticadas (docs/28 §2.1, §10): enlace "saltar al contenido", barra superior (`banner`) con
 * producto, selector de workspace y menú de usuario (preferencias, nuevo workspace, idioma, cerrar sesión),
 * navegación principal (sidebar desde 768 px, panel plegable en móvil) con `aria-current` y el contenido en `main`.
 */
export function AppFrame({ children }: { children: ReactNode }) {
  const t = useTranslations('App');
  const tHome = useTranslations('Home');
  const tAuth = useTranslations('Auth');
  const locale = useLocale();
  const pathname = usePathname() ?? '/';
  const { state, selectWorkspace, logout } = useSession();
  const [switching, setSwitching] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const navId = useId();

  // En móvil, el panel de navegación se cierra al cambiar de ruta.
  useEffect(() => setNavOpen(false), [pathname]);

  const frame = (body: ReactNode, bar?: ReactNode, nav?: ReactNode) => (
    <>
      <a className="pf-skip" href="#contenido">
        {t('skipToContent')}
      </a>
      <div className="pf-shell">
        <header className="pf-topbar">
          {nav ? (
            <button
              type="button"
              className="pf-icon-button pf-nav-toggle"
              aria-expanded={navOpen}
              aria-controls={navId}
              onClick={() => setNavOpen((open) => !open)}
            >
              <MenuIcon />
              <span className="pf-sr-only">{t('menu')}</span>
            </button>
          ) : null}
          <a className="pf-brand" href={localized(locale, '/')}>
            <span className="pf-brand-mark" aria-hidden="true">
              PF
            </span>
            <span>PFOS</span>
            <span className="pf-sr-only"> — {t('home')}</span>
          </a>
          <span className="pf-topbar-spacer" />
          {bar}
        </header>
        {nav ? (
          <nav id={navId} className="pf-sidenav" aria-label={t('nav')} data-open={navOpen}>
            {nav}
          </nav>
        ) : null}
        <main id="contenido" tabIndex={-1} className="pf-main">
          <div className="pf-main-inner">{body}</div>
        </main>
      </div>
    </>
  );

  if (state.status === 'loading') return frame(<p data-testid="loading">{t('loading')}</p>);
  if (state.status === 'expired') {
    return frame(
      <div className="pf-status">
        <h1>{tAuth('expiredTitle')}</h1>
        <p role="alert">{tAuth('reasons.expired')}</p>
        {/* Route handler del BFF (redirección al IdP): requiere navegación completa, no <Link>. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a href="/api/bff/auth/login">{tAuth('login')}</a>
      </div>,
    );
  }
  if (state.status === 'error') return frame(<ProblemMessage problem={state.problem} locale={locale} />);

  const { me, active } = state;
  const current = activeNav(pathname);
  return frame(
    <>
      {active?.isDemo ? (
        // Indicador persistente y no descartable (add-demo-data, FR-IDENTITY-014): toda pantalla del workspace demo.
        <p data-testid="demo-indicator" role="note" className="pf-demo">
          {t('demoIndicator')}
        </p>
      ) : null}
      {children}
    </>,
    <>
      <div className="pf-ws">
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
      </div>
      <UserMenu
        greeting={tHome('greeting', { name: me.displayName })}
        initial={initialOf(me.displayName)}
        pathname={pathname}
        onLogout={() => void logout()}
      />
      <span data-testid="ready" hidden>
        {t('ready')}
      </span>
    </>,
    <ul className="pf-nav-list">
      {NAV_ITEMS.map((item) => (
        <li key={item.key}>
          <a
            className="pf-nav-link"
            href={localized(locale, item.path)}
            aria-current={current === item.key ? 'page' : undefined}
          >
            <NavIcon name={item.key} />
            <span>{t(item.key)}</span>
          </a>
        </li>
      ))}
    </ul>,
  );
}

/** Menú de usuario como disclosure: Escape y clic fuera lo cierran; Escape devuelve el foco al botón. */
function UserMenu({
  greeting,
  initial,
  pathname,
  onLogout,
}: {
  greeting: string;
  initial: string;
  pathname: string;
  onLogout: () => void;
}) {
  const t = useTranslations('App');
  const tLocales = useTranslations('Locales');
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
  }, [open]);

  return (
    <div
      ref={rootRef}
      className="pf-user"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) {
          setOpen(false);
          toggleRef.current?.focus();
        }
      }}
    >
      <button
        ref={toggleRef}
        type="button"
        className="pf-user-toggle"
        data-testid="user-menu"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="pf-avatar" aria-hidden="true">
          {initial}
        </span>
        <span data-testid="welcome" className="pf-hide-sm">
          {greeting}
        </span>
        <span className="pf-sr-only">{t('userMenu')}</span>
        <ChevronIcon />
      </button>
      <div id={panelId} className="pf-user-panel" hidden={!open}>
        <ul>
          <li>
            <a className="pf-menu-item" href={localized(locale, '/preferencias')}>
              {t('preferences')}
            </a>
          </li>
          <li>
            <a className="pf-menu-item" href={localized(locale, '/workspaces/nuevo')}>
              {t('newWorkspace')}
            </a>
          </li>
        </ul>
        <div className="pf-menu-sep" />
        <nav aria-label={t('language')}>
          <p className="pf-menu-heading" aria-hidden="true">
            {t('language')}
          </p>
          <div className="pf-langs">
            {routing.locales.map((l) => (
              <a
                key={l}
                href={switchLocalePath(pathname, l)}
                hrefLang={l}
                lang={l}
                aria-current={l === locale ? 'true' : undefined}
                onClick={() => {
                  // Como en Preferencias: la cookie de next-intl evita volver al idioma anterior en rutas sin prefijo.
                  document.cookie = `NEXT_LOCALE=${l}; path=/; SameSite=Lax`;
                }}
              >
                {tLocales(LOCALE_NAME[l])}
              </a>
            ))}
          </div>
        </nav>
        <div className="pf-menu-sep" />
        <button type="button" className="pf-menu-item" data-testid="logout" onClick={onLogout}>
          {t('logout')}
        </button>
      </div>
    </div>
  );
}

const svgProps = {
  className: 'pf-icon',
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
  focusable: false,
} as const;

function MenuIcon() {
  return (
    <svg {...svgProps}>
      <path d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg {...svgProps} style={{ width: '1rem', height: '1rem' }}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

/** Iconos de trazo dibujados en línea (sin dependencia ni recursos externos); solo decorativos. */
const NAV_PATHS: Record<NavKey, string> = {
  home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z',
  transactions: 'M7 7h13m0 0-3-3m3 3-3 3M17 17H4m0 0 3-3m-3 3 3 3',
  accounts: 'M3 7h18v12H3zM3 11h18M7 15h3',
  fx: 'M4 12a8 8 0 0 1 14-5.3L20 9M20 4v5h-5M20 12a8 8 0 0 1-14 5.3L4 15m0 5v-5h5',
  classification: 'M3 4h7l10 10-6 6L4 10zM7.5 7.5h.01',
  planning: 'M4 6h16v14H4zM4 10h16M8 3v5M16 3v5M8 14h3',
  settings:
    'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM4 12h2M18 12h2M12 4v2M12 18v2M6.3 6.3l1.4 1.4M16.3 16.3l1.4 1.4M6.3 17.7l1.4-1.4M16.3 7.7l1.4-1.4',
};

function NavIcon({ name }: { name: NavKey }) {
  return (
    <svg {...svgProps}>
      <path d={NAV_PATHS[name]} />
    </svg>
  );
}
