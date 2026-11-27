'use client';

import { useTranslations } from 'next-intl';
import { useSyncExternalStore } from 'react';
import { installStore, type InstallState } from './install';
import { cardStyle, mutedStyle } from './ui';

/** En el servidor y en la hidratación no se sabe si el navegador ofrece instalar: no se pinta nada. */
type Snapshot = InstallState | 'unknown';

/**
 * Sección «Aplicación» de Mis preferencias (change add-pwa-install, decisión 4). El botón «Instalar la aplicación» solo
 * existe después de que el navegador avise que se puede instalar (`beforeinstallprompt`, Chromium); nunca se muestra un
 * control que no funcione. Sin aviso y sin estar instalada se deja un texto fijo para iPhone y iPad (pregunta 3 de
 * docs/85, opción B): no detecta el navegador ni es un botón ni un enlace.
 */
export function InstallApp() {
  const t = useTranslations('Preferences.install');
  const state = useSyncExternalStore<Snapshot>(
    installStore.subscribe,
    installStore.getSnapshot,
    () => 'unknown',
  );
  if (state === 'unknown' || state === 'installed') return null;
  return (
    <section
      aria-labelledby="install-title"
      data-testid="install-app"
      style={{ ...cardStyle, display: 'grid', gap: '0.5rem' }}
    >
      <h2 id="install-title" style={{ margin: 0 }}>
        {t('heading')}
      </h2>
      {state === 'available' ? (
        <>
          <p style={{ ...mutedStyle, margin: 0 }}>{t('description')}</p>
          <div>
            <button type="button" data-testid="install-button" onClick={() => void installStore.install()}>
              {t('button')}
            </button>
          </div>
        </>
      ) : (
        <p data-testid="install-ios-hint" style={{ ...mutedStyle, margin: 0 }}>
          {t('iosHint')}
        </p>
      )}
    </section>
  );
}
