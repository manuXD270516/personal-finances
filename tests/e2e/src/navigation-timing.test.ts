import { describe, expect, it } from 'vitest';
import { FAST_4G, NAV_TARGET_MS, navigationReport, navStatus, type NavSample } from './navigation-timing.js';

const sample = (
  destination: string,
  profile: 'desktop' | 'phone',
  contentMs: number | null,
  lcpMs: number | null,
): NavSample => ({ destination, profile, contentMs, lcpMs, ttfbMs: 100 });

describe('informe de la navegación entre secciones (informativo)', () => {
  it('[TC-PLATFORM-CLIENTNAV-001] resume cada destino y perfil con la mediana de tres corridas y su estado frente a 2.5 s', () => {
    const report = navigationReport([
      sample('Transacciones', 'desktop', 300, 400),
      sample('Transacciones', 'desktop', 500, 600),
      sample('Transacciones', 'desktop', 400, 500),
      sample('Transacciones', 'phone', 2400, 2000),
      sample('Transacciones', 'phone', 3000, 2600),
      sample('Transacciones', 'phone', 2800, 2700),
      sample('Reportes', 'desktop', 200, 250),
    ]);
    expect(NAV_TARGET_MS).toBe(2500);
    expect(report.rows).toHaveLength(3);
    expect(report.rows[0]).toMatchObject({
      profile: 'desktop',
      runs: 3,
      contentMs: 400,
      lcpMs: 500,
      contentStatus: 'ok',
    });
    const phone = report.rows[1]!;
    expect(phone).toMatchObject({ profile: 'phone', contentMs: 2800, lcpMs: 2600 });
    expect(phone.contentStatus).toBe('above-target');
    expect(phone.lcpStatus).toBe('above-target');
    expect(report.exceeded).toEqual(['Transacciones']);
    expect(report.text).toContain('2800 ms');
    expect(report.text).toContain('por encima de 2.5 s');
  });

  it('[TC-PLATFORM-CLIENTNAV-001] valores ausentes o raros no lanzan y se informan como «n/d»', () => {
    expect(() =>
      navigationReport([
        sample('Reportes', 'phone', null, Number.NaN),
        sample('Reportes', 'phone', -5, Infinity),
      ]),
    ).not.toThrow();
    const report = navigationReport([sample('Reportes', 'phone', null, null)]);
    expect(report.rows[0]).toMatchObject({ contentMs: null, lcpMs: null, contentStatus: 'n/a' });
    expect(report.text).toContain('n/d');
    expect(report.exceeded).toEqual([]);
    expect(navigationReport([]).rows).toEqual([]);
  });

  it('[TC-PLATFORM-CLIENTNAV-002] el perfil de teléfono usa «Fast 4G» (150 ms, ≈ 1.6 Mbps) y se separa del de escritorio', () => {
    expect(FAST_4G.latency).toBe(150);
    expect(FAST_4G.downloadThroughput).toBe(200_000);
    expect(FAST_4G.uploadThroughput).toBe(93_750);
    const report = navigationReport([
      sample('Inicio', 'desktop', 100, 100),
      sample('Inicio', 'phone', 900, 800),
    ]);
    expect(report.rows.map((r) => r.profile)).toEqual(['desktop', 'phone']);
    expect(report.exceeded).toEqual([]);
    expect(navStatus(2500)).toBe('ok');
    expect(navStatus(2501)).toBe('above-target');
  });
});
