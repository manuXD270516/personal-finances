import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { InfoTip } from './InfoTip';

/** Marcado de `InfoTip` (change refine-perceived-performance, M-09, decisión 5): el popover nativo hace el resto. */
const html = renderToStaticMarkup(
  <InfoTip label="Más información sobre «Conciliada sin extracto»">Queda pendiente de revisión.</InfoTip>,
);

describe('InfoTip', () => {
  it('[TC-PLATFORM-PERCEIVED-011] es un botón con nombre accesible que apunta a una capa popover', () => {
    const button = /<button\b[^>]*>/.exec(html)?.[0] ?? '';
    expect(button).toContain('type="button"');
    expect(button).toContain('aria-label="Más información sobre «Conciliada sin extracto»"');
    const target = /popovertarget="([^"]+)"/i.exec(button)?.[1];
    expect(target).toBeTruthy();
    expect(html).toMatch(
      new RegExp(`<span[^>]*\\bid="${target?.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*\\bpopover="auto"`),
    );
  });

  it('[TC-PLATFORM-PERCEIVED-012] el botón es operable con un toque: sin dependencia del puntero (sin onMouseOver ni title)', () => {
    expect(html).not.toMatch(/onmouse|onpointer|\btitle=/i);
  });

  it('[TC-PLATFORM-PERCEIVED-013] el texto de la explicación está en el marcado, junto al botón (visible si no hay popover)', () => {
    expect(html).toContain('Queda pendiente de revisión.');
    const idxButton = html.indexOf('</button>');
    const idxText = html.indexOf('Queda pendiente');
    expect(idxText).toBeGreaterThan(idxButton);
    expect(html).not.toMatch(/\shidden[=\s>]|display:\s*none/);
  });
});
