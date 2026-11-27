import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * No quedan colores literales fuera de la hoja de tokens (add-dark-theme, decisión 8): un literal en TS/TSX/CSS no
 * cambia con el tema. Solo `app/globals.css` los define. Excepciones: pruebas, comentarios y las líneas marcadas con
 * `color-data:` (un valor por omisión que es un dato del usuario, como el color de una categoría, no del tema).
 */
const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../..');
const globalsCss = resolve(srcDir, '../app/globals.css');
const LITERAL = /#[0-9a-fA-F]{8}\b|#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3,4}\b|\b(?:rgba?|hsla?)\(/g;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return walk(p);
    return /\.(ts|tsx|css)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) ? [p] : [];
  });
}

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .split('\n')
    .map((line) => (/^\s*\/\//.test(line) ? '' : line))
    .join('\n');
}

const COLOR_TOKEN =
  /--pf-(?:bg|surface[a-z-]*|fg[a-z-]*|border[a-z-]*|control-border|primary[a-z-]*|focus|destructive|error|fin-[a-z-]+|warning-[a-z]+|track|card-border|chart-[a-z-]+)\s*:/;
const ROOT_SELECTOR = /^:root(\[data-theme=['"](?:dark|light)['"]\]|:not\(\[data-theme=['"]light['"]\]\))?$/;

describe('[TC-PLATFORM-THEME-018] colores literales fuera de la hoja de tokens', () => {
  it('ningún archivo de src/ define hexadecimales, rgb() ni hsl() literales', () => {
    const found: string[] = [];
    for (const file of walk(srcDir)) {
      stripComments(readFileSync(file, 'utf8'))
        .split('\n')
        .forEach((line, i) => {
          if (line.includes('color-data:')) return;
          for (const m of line.matchAll(LITERAL)) found.push(`${relative(srcDir, file)}:${i + 1} ${m[0]}`);
        });
    }
    expect(found).toEqual([]);
  });

  it('el bloque de tokens de .pf-home ya no existe: solo :root redeclara tokens --pf-* de color', () => {
    const offenders: string[] = [];
    const sheets = [...walk(srcDir).filter((f) => f.endsWith('.css')), globalsCss];
    for (const file of sheets) {
      const css = stripComments(readFileSync(file, 'utf8'));
      for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const selector = rule[1]!.trim().replace(/^@media[^{]*\{\s*/, '');
        if (selector.split(',').every((part) => ROOT_SELECTOR.test(part.trim()))) continue;
        if (COLOR_TOKEN.test(rule[2]!)) offenders.push(`${relative(srcDir, file)}: ${selector}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
