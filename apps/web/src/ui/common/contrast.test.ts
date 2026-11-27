import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { THEME_COLOR } from './theme';

/**
 * Contraste de los tokens de color en los dos esquemas (add-dark-theme, decisión 9; WCAG 2.2). Lee `app/globals.css`,
 * extrae los tres bloques de tokens y mide cada par de la tabla contra su umbral.
 */
const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(resolve(here, '../../../app/globals.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** Cuerpo `{…}` que sigue al selector (con llaves anidadas balanceadas). */
function blockAfter(selector: string, from = 0): string {
  const at = css.indexOf(selector, from);
  if (at < 0) throw new Error(`no se encontró el bloque ${selector}`);
  const open = css.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === '{') depth += 1;
    else if (css[i] === '}' && --depth === 0) return css.slice(open + 1, i);
  }
  throw new Error(`bloque ${selector} sin cerrar`);
}

type Tokens = Record<string, string>;

function colorTokens(block: string): Tokens {
  const out: Tokens = {};
  for (const m of block.matchAll(/(--pf-[a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{6})\s*;/g))
    out[m[1]!] = m[2]!.toLowerCase();
  return out;
}

const light = colorTokens(blockAfter(':root {'));
const darkMedia = colorTokens(
  blockAfter(":root:not([data-theme='light'])", css.indexOf('@media (prefers-color-scheme: dark)')),
);
const darkAttr = colorTokens(blockAfter(":root[data-theme='dark']"));
const dark: Tokens = { ...light, ...darkMedia };

function luminance(hex: string): number {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

type Pair = { fg: string; bg: string; min: number };
const FIN = ['income', 'expense', 'transfer', 'conversion', 'neutral', 'warning', 'over-budget', 'ok'].map(
  (n) => `--pf-fin-${n}`,
);
const pairs: Pair[] = [
  ...['--pf-bg', '--pf-surface', '--pf-surface-raised', '--pf-surface-sunken'].map((bg) => ({
    fg: '--pf-fg',
    bg,
    min: 4.5,
  })),
  ...['--pf-surface', '--pf-surface-raised', '--pf-surface-sunken'].map((bg) => ({
    fg: '--pf-fg-muted',
    bg,
    min: 4.5,
  })),
  { fg: '--pf-primary-fg', bg: '--pf-primary', min: 4.5 },
  { fg: '--pf-primary-fg', bg: '--pf-primary-hover', min: 4.5 },
  { fg: '--pf-primary', bg: '--pf-primary-soft', min: 4.5 },
  { fg: '--pf-primary', bg: '--pf-bg', min: 4.5 },
  { fg: '--pf-primary', bg: '--pf-surface', min: 4.5 },
  ...[...FIN, '--pf-error', '--pf-destructive', '--pf-fin-expense-soft'].map((fg) => ({
    fg,
    bg: '--pf-surface',
    min: 4.5,
  })),
  { fg: '--pf-warning-fg', bg: '--pf-warning-bg', min: 4.5 },
  { fg: '--pf-control-border', bg: '--pf-surface-raised', min: 3 },
  { fg: '--pf-control-border', bg: '--pf-bg', min: 3 },
  { fg: '--pf-focus', bg: '--pf-surface', min: 3 },
  { fg: '--pf-focus', bg: '--pf-bg', min: 3 },
  { fg: '--pf-chart-on', bg: '--pf-surface', min: 3 },
  { fg: '--pf-chart-on-fg', bg: '--pf-chart-on', min: 4.5 },
  { fg: '--pf-chart-on-strong', bg: '--pf-chart-visited', min: 4.5 },
  { fg: '--pf-chart-on', bg: '--pf-chart-visited', min: 3 },
];

describe.each([
  ['claro', light],
  ['oscuro', dark],
] as const)('[TC-PLATFORM-THEME-014] contraste de los tokens en %s', (_name, tokens) => {
  it.each(pairs)('$fg sobre $bg ≥ $min:1', ({ fg, bg, min }) => {
    const f = tokens[fg];
    const b = tokens[bg];
    expect(f, `falta ${fg}`).toBeDefined();
    expect(b, `falta ${bg}`).toBeDefined();
    expect(contrast(f!, b!)).toBeGreaterThanOrEqual(min);
  });
});

describe('[TC-PLATFORM-THEME-014] coherencia entre bloques', () => {
  it('los dos bloques oscuros (media y data-theme) declaran los mismos valores', () => {
    expect(Object.keys(darkMedia).length).toBeGreaterThan(20);
    expect(darkAttr).toEqual(darkMedia);
  });

  it('todo token claro de color tiene su valor oscuro', () => {
    const missing = Object.keys(light).filter((k) => !(k in darkMedia));
    expect(missing).toEqual([]);
  });

  it('THEME_COLOR (theme-color del navegador) coincide con --pf-bg de cada esquema', () => {
    expect(THEME_COLOR.light).toBe(light['--pf-bg']);
    expect(THEME_COLOR.dark).toBe(darkMedia['--pf-bg']);
  });
});
