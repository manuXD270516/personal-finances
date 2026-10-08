import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { todayIn } from '../common/dates';
import { esContext, textOf } from '../test-support';
import { PERIODS, id } from './fixtures';
import { defaultPeriodId } from './logic';
import { PeriodSelector } from './PeriodSelector';

const f = esContext('Planning');
const ORIGINAL_TZ = process.env['TZ'];

describe('PeriodSelector (planning/financial-periods 6.2) con TZ del proceso forzada', () => {
  afterEach(() => {
    if (ORIGINAL_TZ === undefined) delete process.env['TZ'];
    else process.env['TZ'] = ORIGINAL_TZ;
  });

  it.each(['UTC', 'America/La_Paz'])(
    '[TC-PLANNING-TZ-001] (UI, TZ %s) a las 23:30 del 31/10 en La Paz el selector elige "2026-10"; en un workspace UTC, "2026-11"',
    (tz) => {
      process.env['TZ'] = tz;
      const instant = new Date(Date.UTC(2026, 10, 1, 3, 30));
      const laPaz = todayIn('America/La_Paz', instant);
      const utc = todayIn('UTC', instant);
      expect([laPaz, utc]).toEqual(['2026-10-31', '2026-11-01']);
      expect(defaultPeriodId(PERIODS, laPaz)).toBe(id(10));
      expect(defaultPeriodId(PERIODS, utc)).toBe(id(11));
      const html = renderToStaticMarkup(
        createElement(PeriodSelector, { periods: PERIODS, today: laPaz, onChange: () => undefined, f }),
      );
      expect(html).toMatch(new RegExp(`<option value="${id(10)}" selected="">`));
      expect(textOf(html)).toContain('octubre de 2026 · 01/10/2026 – 31/10/2026 · Activo (actual)');
      expect(html).toMatch(/<label for="[^"]+">Periodo<\/label>/);
    },
  );

  it('respeta el valor elegido y, sin periodo que contenga hoy, elige el último ya iniciado', () => {
    const html = renderToStaticMarkup(
      createElement(PeriodSelector, {
        periods: PERIODS,
        today: '2026-11-02',
        value: id(12),
        onChange: () => undefined,
        f,
      }),
    );
    expect(html).toMatch(new RegExp(`<option value="${id(12)}" selected="">`));
    expect(defaultPeriodId(PERIODS, '2027-05-01')).toBe(id(12));
    expect(defaultPeriodId(PERIODS, '2026-01-01')).toBe(id(10));
  });
});
