'use client';

import { useLocale } from 'next-intl';
import { localized } from '../session-context';
import type { FormatContext } from '../dashboard/types';

/**
 * Navegación entre las pantallas de planificación (periodos, presupuestos y templates). `aria-current` marca la pantalla
 * activa; los textos salen del namespace `Budgets` (`nav.*`).
 */
export function PlanningNav({
  f,
  current = 'budgets',
}: {
  f: FormatContext;
  current?: 'periods' | 'budgets' | 'templates';
}) {
  const locale = useLocale();
  const items = [
    { key: 'periods', href: localized(locale, '/planificacion/periodos') },
    { key: 'budgets', href: localized(locale, '/planificacion/presupuestos') },
    { key: 'templates', href: localized(locale, '/planificacion/templates') },
  ] as const;
  return (
    <nav aria-label={f.t('nav.label')} data-testid="planning-nav">
      <ul
        style={{
          listStyle: 'none',
          display: 'flex',
          flexWrap: 'wrap',
          gap: 'var(--pf-space-4)',
          margin: 0,
          padding: 0,
        }}
      >
        {items.map((i) => (
          <li key={i.key}>
            <a href={i.href} aria-current={i.key === current ? 'page' : undefined}>
              {f.t(`nav.${i.key}`)}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
