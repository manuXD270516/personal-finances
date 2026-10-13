import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RateSourceBadge } from '../dashboard/RateSourceBadge';
import type { RateAttribution, ResolvedRate } from '../dashboard/types';
import { esContext, textOf } from '../test-support';
import type { FxProviderStatus } from './providers-logic';
import {
  addPair,
  allowedQuotes,
  listChanged,
  removePair,
  requestBody,
  statusByPair,
  type FxRatePairList,
  type FxRatePairStatus,
} from './rate-pairs-logic';
import { RatePairsView } from './RatePairsPanel';

// Configuración → Tasas automáticas y atribución de las tasas cruzadas (add-crypto-rate-providers 6.1 y 6.2).
const f = esContext('RatePairs');
const dash = esContext('Dashboard');
const fx = esContext('Fx');

const PARALELO: RateAttribution = {
  provider: 'PARALELO_BO',
  text: 'Fuente: paralelo.bo',
  url: 'https://paralelo.bo',
  license: 'CC BY 4.0',
  licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
};
const CRYPTO: RateAttribution = {
  provider: 'CRYPTO_EXAMPLE',
  text: 'Fuente: crypto_example (ejemplo)',
  url: 'https://example.invalid/crypto',
  license: null,
  licenseUrl: null,
};

const LIST: FxRatePairList = {
  mode: 'DEFAULT',
  version: 1,
  pairs: [
    {
      base: 'USDT',
      quote: 'BOB',
      assetClass: 'STABLE',
      defaultRateType: 'PARALLEL',
      coverage: 'AUTOMATIC',
      providers: ['PARALELO_BO'],
    },
    {
      base: 'BTC',
      quote: 'USDT',
      assetClass: 'VOLATILE_CRYPTO',
      defaultRateType: 'MARKET',
      coverage: 'AUTOMATIC',
      providers: ['CRYPTO_EXAMPLE'],
    },
    {
      base: 'EUR',
      quote: 'BOB',
      assetClass: 'FIAT',
      defaultRateType: 'PARALLEL',
      coverage: 'MANUAL_ONLY',
      providers: [],
    },
  ],
};
const STATUSES: FxRatePairStatus[] = [
  {
    base: 'USDT',
    quote: 'BOB',
    coverage: 'AUTOMATIC',
    providers: ['PARALELO_BO'],
    lastAutomaticRateAt: '2026-10-13T14:00:00.000Z',
    ageSeconds: 300,
    stale: false,
  },
  {
    base: 'BTC',
    quote: 'USDT',
    coverage: 'AUTOMATIC',
    providers: ['CRYPTO_EXAMPLE'],
    lastAutomaticRateAt: '2026-10-13T12:00:00.000Z',
    ageSeconds: 7200,
    stale: true,
  },
  {
    base: 'EUR',
    quote: 'BOB',
    coverage: 'MANUAL_ONLY',
    providers: [],
    lastAutomaticRateAt: null,
    ageSeconds: null,
    stale: true,
  },
];
const PROVIDERS = [
  { provider: 'PARALELO_BO', attribution: PARALELO },
  { provider: 'CRYPTO_EXAMPLE', attribution: CRYPTO },
] as unknown as FxProviderStatus[];

/** Etiqueta de apertura que lleva un `data-testid` (el orden de los atributos no importa). */
const tagOf = (html: string, testId: string): string =>
  new RegExp(`<[^>]*data-testid="${testId}"[^>]*>`).exec(html)?.[0] ?? '';

const view = (over: { canEdit?: boolean; list?: FxRatePairList; conflict?: boolean } = {}) =>
  renderToStaticMarkup(
    <RatePairsView
      list={over.list ?? LIST}
      statuses={STATUSES}
      providers={PROVIDERS}
      f={f}
      dash={dash}
      fx={fx}
      baseCurrency="BOB"
      enabledCurrencies={['BOB', 'USD', 'USDT', 'BTC', 'ETH']}
      canEdit={over.canEdit ?? true}
      conflict={over.conflict ?? false}
    />,
  );

describe('Configuración → Tasas automáticas: episodio de obsolescencia (add-rate-feed-alerts 6.1)', () => {
  const withEpisode = (episode: FxRatePairStatus['openEpisode'], pair = 'USDT'): FxRatePairStatus[] =>
    STATUSES.map((s) => (s.base === pair ? { ...s, stale: true, openEpisode: episode } : s));
  const render = (statuses: FxRatePairStatus[]) =>
    renderToStaticMarkup(
      <RatePairsView
        list={LIST}
        statuses={statuses}
        providers={PROVIDERS}
        f={f}
        dash={dash}
        fx={fx}
        baseCurrency="BOB"
        enabledCurrencies={['BOB', 'USD', 'USDT', 'BTC', 'ETH']}
        canEdit
      />,
    );

  it('[TC-NOTIFICATIONS-FX-001] el par con episodio abierto lo muestra desde la vigencia de su última tasa; el resto, no', () => {
    const html = render(
      withEpisode({ openedAt: '2026-10-13T14:15:00.000Z', lastRateAsOf: '2026-10-13T08:00:00.000Z' }),
    );
    const usdt = /data-pair="USDT\/BOB"[\s\S]*?<\/tr>/.exec(html)?.[0] ?? '';
    expect(tagOf(usdt, 'rate-pair-episode')).toContain('data-opened-at="2026-10-13T14:15:00.000Z"');
    expect(textOf(usdt)).toContain('Aviso de obsolescencia');
    expect(textOf(usdt)).toMatch(/Sin tasa automática desde el .*\b0?4:00/);
    const btc = /data-pair="BTC\/USDT"[\s\S]*?<\/tr>/.exec(html)?.[0] ?? '';
    expect(btc).not.toContain('rate-pair-episode');
    // El formulario es el destino del enlace "estado de las tasas automáticas" de la notificación.
    expect(html).toContain('id="tasas-automaticas"');
  });

  it('[TC-NOTIFICATIONS-FX-001] un par que nunca tuvo tasa automática lo dice con la fecha de apertura', () => {
    const html = render(withEpisode({ openedAt: '2026-10-13T14:15:00.000Z', lastRateAsOf: null }));
    expect(textOf(html)).toMatch(/Sin ninguna tasa automática aceptada \(abierto el .*\b10:15/);
  });

  it('un estado sin openEpisode (clientes de versiones anteriores o par sin episodio) no muestra aviso', () => {
    expect(render(STATUSES)).not.toContain('rate-pair-episode');
    expect(render(withEpisode(null))).not.toContain('rate-pair-episode');
  });
});

describe('Configuración → Tasas automáticas (add-crypto-rate-providers 6.1)', () => {
  it('[TC-FX-PROVIDER-025] cada par muestra su cobertura, sus fuentes con atribución y la antigüedad de su última tasa', () => {
    const html = view();
    const text = textOf(html);
    expect(text).toContain('Tasas automáticas');
    expect(text).toContain('USDT/BOB');
    expect(text).toContain('Cripto volátil');
    expect(text).toContain('Mercado');
    expect(text).toContain('hace 5 min');
    expect(text).toContain('hace 2 h');
    expect(text).toContain('obsoleta');
    expect(html).toContain('href="https://paralelo.bo"');
    expect(html).toContain('href="https://example.invalid/crypto"');
    // EUR/BOB sin provider: solo tasas manuales, con su explicación y sin fuentes.
    const eur = /data-pair="EUR\/BOB"[\s\S]*?<\/tr>/.exec(html)?.[0] ?? '';
    expect(eur).toContain('data-coverage="MANUAL_ONLY"');
    expect(textOf(eur)).toContain('Solo tasas manuales');
    expect(textOf(eur)).toContain('sin tasa automática');
  });

  it('el contenedor con desplazamiento horizontal es una región enfocable con nombre traducido (axe)', () => {
    const html = view();
    expect(html).toMatch(/role="region"[^>]*aria-label="Pares de tasa automáticos/);
    expect(html).toContain('tabindex="0"');
  });

  it('[TC-FX-PROVIDER-022] un VIEWER ve la lista en solo lectura, sin guardar ni cambiar el modo', () => {
    const html = view({ canEdit: false });
    expect(html).toContain('data-testid="rate-pairs-readonly"');
    expect(html).not.toContain('data-testid="rate-pairs-save"');
    expect(html).not.toContain('data-testid="rate-pair-add"');
    expect(tagOf(html, 'rate-pairs-mode-DEFAULT')).toContain('disabled');
  });

  it('[TC-FX-PROVIDER-021] en modo personalizada el editor ve quitar por par y agregar un par; guardar queda deshabilitado sin cambios', () => {
    const html = view({ list: { ...LIST, mode: 'CUSTOM', version: 2 } });
    expect(html).toContain('data-testid="rate-pair-add"');
    expect((html.match(/data-testid="rate-pair-remove"/g) ?? []).length).toBe(3);
    expect(html).toContain('aria-label="Quitar BTC/USDT"');
    expect(tagOf(html, 'rate-pairs-save')).toContain('disabled');
  });

  it('muestra la acción de recargar solo ante un conflicto de versión', () => {
    expect(view({ conflict: true })).not.toContain('rate-pairs-reload');
  });
});

describe('Lógica de la lista de pares', () => {
  it('[TC-FX-PROVIDER-022] solo se cotiza contra la moneda base o USDT, sin repetir ni pasar de 50', () => {
    expect(allowedQuotes('BOB')).toEqual(['BOB', 'USDT']);
    expect(allowedQuotes('USDT')).toEqual(['USDT']);
    expect(addPair([], 'BTC', 'USD', 'BOB')).toEqual({ error: 'INVALID' });
    expect(addPair([], 'BTC', 'BTC', 'BOB')).toEqual({ error: 'INVALID' });
    expect(addPair([], '', 'USDT', 'BOB')).toEqual({ error: 'INVALID' });
    const one = addPair([], 'BTC', 'USDT', 'BOB');
    expect(one).toEqual({ pairs: [{ base: 'BTC', quote: 'USDT' }], error: null });
    expect(addPair([{ base: 'BTC', quote: 'USDT' }], 'BTC', 'USDT', 'BOB')).toEqual({ error: 'DUPLICATE' });
    const full = Array.from({ length: 50 }, (_, i) => ({ base: `C${i}`, quote: 'BOB' }));
    expect(addPair(full, 'USD', 'BOB', 'BOB')).toEqual({ error: 'TOO_MANY' });
  });

  it('[TC-FX-PROVIDER-021] quitar un par, detectar cambios y armar el cuerpo del PUT', () => {
    const draft = [
      { base: 'USD', quote: 'BOB' },
      { base: 'BTC', quote: 'USDT' },
    ];
    expect(removePair(draft, 'USD/BOB')).toEqual([{ base: 'BTC', quote: 'USDT' }]);
    expect(listChanged({ mode: 'CUSTOM', pairs: draft }, 'CUSTOM', draft)).toBe(false);
    expect(listChanged({ mode: 'CUSTOM', pairs: draft }, 'CUSTOM', draft.slice(1))).toBe(true);
    expect(listChanged({ mode: 'CUSTOM', pairs: draft }, 'DEFAULT', draft)).toBe(true);
    expect(listChanged({ mode: 'DEFAULT', pairs: draft }, 'DEFAULT', [])).toBe(false);
    expect(requestBody('DEFAULT', draft)).toEqual({ mode: 'DEFAULT' });
    expect(requestBody('CUSTOM', draft)).toEqual({ mode: 'CUSTOM', pairs: draft });
    expect(statusByPair(STATUSES).get('BTC/USDT')?.ageSeconds).toBe(7200);
  });
});

describe('Atribución de las tasas cruzadas (add-crypto-rate-providers 6.2)', () => {
  const cross: ResolvedRate = {
    rate: { base: 'BTC', quote: 'BOB', value: '781300' },
    fxRateId: null,
    derivation: 'CROSS',
    rateType: 'MARKET',
    source: 'PROVIDER',
    asOf: '2026-10-13T14:00:00.000Z',
    ageDays: 0,
    approx: true,
    ageSeconds: 300,
    provider: 'CRYPTO_EXAMPLE',
    selection: 'PRIMARY',
    stale: false,
    attribution: CRYPTO,
    components: [
      { base: 'BTC', quote: 'USDT', attribution: CRYPTO },
      { base: 'USDT', quote: 'BOB', attribution: PARALELO },
    ],
  };

  it('[TC-FX-PROVIDER-035] una tasa cruzada muestra la atribución de cada componente de provider, con la licencia de paralelo.bo', () => {
    const html = renderToStaticMarkup(<RateSourceBadge rate={cross} ctx={dash} />);
    expect((html.match(/data-testid="rate-component-attribution"/g) ?? []).length).toBe(2);
    expect(html).toContain('href="https://paralelo.bo"');
    expect(html).toContain('href="https://example.invalid/crypto"');
    expect(textOf(html)).toContain('Componentes:');
    expect(textOf(html)).toContain('(CC BY 4.0)');
  });

  it('[TC-FX-PROVIDER-035] una tasa directa no agrega bloque de componentes', () => {
    const html = renderToStaticMarkup(
      <RateSourceBadge rate={{ ...cross, derivation: 'DIRECT', approx: false, components: [] }} ctx={dash} />,
    );
    expect(html).not.toContain('rate-components');
  });
});
