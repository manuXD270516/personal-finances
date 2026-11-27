import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Revisión estática del CSS del change refine-perceived-performance (decisiones 1, 5, 6, 7 y 8; NFR-USAB-107,
 * NFR-USAB-005/006). Recorrido mínimo de bloques CSS (las hojas propias no anidan reglas), con la pila de preludios
 * `@media`/`@supports` que envuelve cada regla.
 */
interface Block {
  readonly selector: string;
  readonly body: string;
  readonly context: readonly string[];
}

const APP = join(import.meta.dirname, '..', '..', '..', 'app');
const UI = join(import.meta.dirname, '..');

function parse(source: string): Block[] {
  const text = source.replace(/\/\*[\s\S]*?\*\//g, '');
  const blocks: Block[] = [];
  const walk = (start: number, context: readonly string[]): number => {
    let i = start;
    let prelude = '';
    while (i < text.length) {
      const ch = text[i]!;
      if (ch === '}') return i + 1;
      if (ch === ';') {
        prelude = '';
        i += 1;
        continue;
      }
      if (ch !== '{') {
        prelude += ch;
        i += 1;
        continue;
      }
      const head = prelude.trim().replace(/\s+/g, ' ');
      if (head.startsWith('@media') || head.startsWith('@supports')) {
        i = walk(i + 1, [...context, head]);
      } else if (head.startsWith('@')) {
        i = walk(i + 1, [...context, head]);
      } else {
        const end = text.indexOf('}', i);
        blocks.push({
          selector: head,
          body: text
            .slice(i + 1, end)
            .replace(/\s+/g, ' ')
            .trim(),
          context,
        });
        i = end + 1;
      }
      prelude = '';
    }
    return i;
  };
  walk(0, []);
  return blocks;
}

const cssFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return name === 'node_modules' ? [] : cssFiles(full);
    return name.endsWith('.css') ? [full] : [];
  });

const globals = parse(readFileSync(join(APP, 'globals.css'), 'utf8'));
const allCss = [...cssFiles(APP), ...cssFiles(UI)];
const has = (b: Block, decl: string) => b.body.split(';').some((d) => d.trim() === decl);
const selectors = (b: Block) => b.selector.split(',').map((s) => s.trim());

describe('legibilidad (M-23)', () => {
  it('[TC-PLATFORM-PERCEIVED-016] los títulos h1-h3 declaran text-wrap: balance', () => {
    const rule = globals.find((b) => selectors(b).includes('h1') && has(b, 'text-wrap: balance'));
    expect(rule).toBeDefined();
    expect(selectors(rule!)).toEqual(expect.arrayContaining(['h1', 'h2', 'h3']));
  });

  it('[TC-PLATFORM-PERCEIVED-016] párrafos y elementos de lista declaran text-wrap: pretty', () => {
    const rule = globals.find((b) => selectors(b).includes('p') && has(b, 'text-wrap: pretty'));
    expect(rule).toBeDefined();
    expect(selectors(rule!)).toContain('li');
  });

  it('[TC-PLATFORM-PERCEIVED-017] los textos de ayuda no pasan de 70ch', () => {
    const rule = globals.find((b) => selectors(b).includes('.pf-help'));
    expect(rule).toBeDefined();
    expect(has(rule!, 'max-inline-size: 70ch')).toBe(true);
  });
});

describe('tamaño de texto del sistema (M-24)', () => {
  it('[TC-PLATFORM-PERCEIVED-018] ninguna media query de ancho usa px', () => {
    const offenders = allCss.flatMap((file) =>
      [
        ...readFileSync(file, 'utf8')
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .matchAll(/@media[^{]*\{/g),
      ]
        .map((m) => m[0])
        .filter((q) => /\d(?:\.\d+)?px/.test(q))
        .map((q) => `${relative(join(APP, '..'), file)}: ${q}`),
    );
    expect(offenders).toEqual([]);
  });

  it('[TC-PLATFORM-PERCEIVED-019] white-space: nowrap solo en montos, fechas, códigos y textos solo para lectores', () => {
    const allowed = [
      '.pf-sr-only',
      '.pf-ws-label',
      '.pf-quick-add-label',
      ".pf-table--idcol > tbody > tr > th[scope='row']",
      '.pf-tab',
      '.pf-quick-add',
      '.pf-brand', // marca corta de la barra superior
    ];
    const offenders = globals
      .filter((b) => has(b, 'white-space: nowrap'))
      .filter((b) => !selectors(b).every((s) => allowed.includes(s)))
      .map((b) => b.selector);
    expect(offenders).toEqual([]);
  });
});

describe('campos que crecen (M-05)', () => {
  it('[TC-PLATFORM-PERCEIVED-021] field-sizing solo dentro de @supports (field-sizing: content)', () => {
    const using = globals.filter((b) => /field-sizing/.test(b.body));
    expect(using.length).toBeGreaterThan(0);
    for (const b of using) expect(b.context).toContain('@supports (field-sizing: content)');
    const grows = using.find((b) => selectors(b).includes('textarea'));
    expect(grows).toBeDefined();
    expect(has(grows!, 'min-block-size: 3lh')).toBe(true);
    expect(has(grows!, 'max-block-size: 12lh')).toBe(true);
  });

  it('[TC-PLATFORM-PERCEIVED-021] la regla base de textarea conserva el alto actual y el desplazamiento', () => {
    const base = globals.find((b) => b.selector === ':where(textarea)' && b.context.length === 0);
    expect(base?.body).toBe('min-height: 5rem;');
    for (const b of globals.filter((x) => selectors(x).includes('textarea') && x.context.length === 0)) {
      expect(b.body).not.toMatch(/field-sizing|(?<![-a-z])height:\s*auto/);
    }
  });
});

describe('transiciones (M-28) y explicaciones (M-09)', () => {
  it('[TC-PLATFORM-PERCEIVED-001] la animación de la transición vive solo con prefers-reduced-motion: no-preference', () => {
    const using = globals.filter((b) => /view-transition/.test(b.selector) || /view-transition/.test(b.body));
    expect(using.length).toBeGreaterThan(0);
    for (const b of using) expect(b.context).toContain('@media (prefers-reduced-motion: no-preference)');
    const group = using.find((b) => b.selector === '::view-transition-group(*)');
    expect(group && has(group, 'animation-duration: 200ms')).toBe(true);
  });

  it('[TC-PLATFORM-PERCEIVED-013] ninguna regla oculta .pf-infotip-body fuera de :popover-open', () => {
    const rules = globals.filter((b) => selectors(b).some((s) => s.includes('.pf-infotip-body')));
    expect(rules.length).toBeGreaterThan(0);
    for (const b of rules) {
      expect(b.body).not.toMatch(/display:\s*none|visibility:\s*hidden|opacity:\s*0\b/);
      if (/border|background|padding|box-shadow/.test(b.body)) {
        expect(selectors(b).every((s) => s.includes(':popover-open'))).toBe(true);
      }
    }
  });

  it('[TC-PLATFORM-PERCEIVED-011] el botón de información tiene un objetivo táctil de al menos 24 x 24 px (1.5rem)', () => {
    const rule = globals.find((b) => selectors(b).includes('.pf-infotip-button'));
    expect(rule).toBeDefined();
    expect(has(rule!, 'min-inline-size: 1.5rem')).toBe(true);
    expect(has(rule!, 'min-block-size: 1.5rem')).toBe(true);
  });
});
