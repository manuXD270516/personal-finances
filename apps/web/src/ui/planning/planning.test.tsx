import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { esContext, textOf } from '../test-support';
import { PERIODS } from './fixtures';
import { canActivate, formatBusinessDate, periodName } from './logic';
import { PeriodsListView } from './PeriodsListView';

const f = esContext('Planning');
describe('Pantalla de periodos (planning/financial-periods 6.1)', () => {
  it('[TC-PLANNING-QUERY-001] (UI) lista etiqueta, rango dd/MM/yyyy, estado y marcas "pendiente de cierre" y "transición"', () => {
    const html = renderToStaticMarkup(
      <PeriodsListView periods={PERIODS} today="2026-11-02" canEdit f={f} onActivate={() => undefined} />,
    );
    const text = textOf(html);
    expect(text).toContain('octubre de 2026');
    expect(text).toContain('(2026-10)');
    expect(text).toContain('01/10/2026 – 31/10/2026');
    expect(text).toContain('01/12/2026 – 24/01/2027');
    expect(text).toContain('Pendiente de cierre');
    expect(text).toContain('Transición');
    expect(text).toContain('Borrador');
    expect(text).toContain('Activo');
    // Orden: el más reciente primero.
    expect(text.indexOf('diciembre de 2026')).toBeLessThan(text.indexOf('octubre de 2026'));
    // La fila del periodo de hoy se marca (aria-current) y solo "2026-11" (DRAFT iniciado) se puede activar.
    expect(html).toMatch(/data-label="2026-11"[^>]*aria-current="date"/);
    expect(html.match(/<button/g)).toHaveLength(1);
    expect(html).toContain('aria-label="Activar el periodo noviembre de 2026"');
    expect(html).toContain('<caption');
    expect(html).toContain('scope="col"');
  });

  it('[TC-PLANNING-ROLE-001] (UI) un VIEWER no ve la columna de acciones ni el botón de activar', () => {
    const html = renderToStaticMarkup(
      <PeriodsListView
        periods={PERIODS}
        today="2026-11-02"
        canEdit={false}
        f={f}
        onActivate={() => undefined}
      />,
    );
    expect(html).not.toContain('<button');
    expect(textOf(html)).not.toContain('Acciones');
  });

  it('sin periodos muestra el aviso de creación automática', () => {
    expect(
      textOf(renderToStaticMarkup(<PeriodsListView periods={[]} today="2026-11-02" canEdit f={f} />)),
    ).toContain('se crean automáticamente');
  });

  it('formatos y reglas puras: dd/MM/yyyy sin zona, nombre del mes y activación solo de un DRAFT iniciado', () => {
    expect(formatBusinessDate('2026-11-24')).toBe('24/11/2026');
    expect(periodName('2027-02', 'es-BO')).toBe('febrero de 2027');
    expect(periodName('2027-02', 'en-US')).toBe('February 2027');
    expect(canActivate(PERIODS[1]!, '2026-11-01', true)).toBe(true);
    expect(canActivate(PERIODS[1]!, '2026-10-31', true)).toBe(false);
    expect(canActivate(PERIODS[1]!, '2026-11-01', false)).toBe(false);
    expect(canActivate(PERIODS[0]!, '2026-11-01', true)).toBe(false);
  });
});
