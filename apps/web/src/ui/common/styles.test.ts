import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Revisión estática de las hojas de estilo (decisión 8 del change, NFR-USAB-107): sin anulación global de duraciones y con cada
 * animación o transición declarada junto a su comportamiento de movimiento reducido. Sin dependencias: un recorrido
 * mínimo de bloques CSS, suficiente para las hojas propias del proyecto (sin anidamiento de reglas).
 */

interface Declaration {
  readonly property: string;
  readonly value: string;
}
interface Rule {
  readonly selector: string;
  readonly declarations: readonly Declaration[];
  /** Preludios de los `@media` que la envuelven, de afuera hacia adentro. */
  readonly media: readonly string[];
  /** Nombre del `@keyframes` si la regla es un paso de una animación. */
  readonly keyframes?: string;
}

function parseCss(source: string): Rule[] {
  const text = source.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules: Rule[] = [];
  const walk = (start: number, media: readonly string[], keyframes?: string): number => {
    let i = start;
    let prelude = '';
    while (i < text.length) {
      const ch = text[i]!;
      if (ch === '}') return i + 1;
      if (ch === ';') {
        i += 1;
        prelude = '';
        continue;
      }
      if (ch !== '{') {
        prelude += ch;
        i += 1;
        continue;
      }
      const head = prelude.trim();
      if (head.startsWith('@media')) {
        i = walk(i + 1, [...media, head], keyframes);
      } else if (head.startsWith('@keyframes')) {
        i = walk(i + 1, media, head.replace('@keyframes', '').trim());
      } else if (head.startsWith('@')) {
        i = walk(i + 1, media, keyframes);
      } else {
        const end = text.indexOf('}', i);
        const body = text.slice(i + 1, end);
        const declarations = body
          .split(';')
          .map((d) => d.trim())
          .filter(Boolean)
          .map((d) => {
            const colon = d.indexOf(':');
            return { property: d.slice(0, colon).trim().toLowerCase(), value: d.slice(colon + 1).trim() };
          });
        rules.push({ selector: head, declarations, media, ...(keyframes ? { keyframes } : {}) });
        i = end + 1;
      }
      prelude = '';
    }
    return i;
  };
  walk(0, []);
  return rules;
}

function cssFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return cssFiles(path);
    return name.endsWith('.css') ? [path] : [];
  });
}

const ROOT = new URL('../../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const FILES = [...cssFiles(join(ROOT, 'app')), ...cssFiles(join(ROOT, 'src'))];
const parsed = FILES.map((file) => ({ file, rules: parseCss(readFileSync(file, 'utf8')) }));

const MOTION = /^(animation|transition)(-(duration|name|property|delay))?$/;
const TRANSFORM = /\b(transform|translate|scale|rotate)\b/;
const inMotionQuery = (media: readonly string[]) => media.some((m) => m.includes('prefers-reduced-motion'));
const inNoPreference = (media: readonly string[]) =>
  media.some((m) => m.includes('prefers-reduced-motion: no-preference'));

describe('hojas de estilo y movimiento reducido', () => {
  it('[TC-PLATFORM-WEBUI-014] encuentra las hojas de la interfaz', () => {
    expect(FILES.some((f) => f.endsWith('globals.css'))).toBe(true);
    expect(FILES.length).toBeGreaterThan(5);
  });

  it('[TC-PLATFORM-WEBUI-014] no hay una regla universal que fuerce duraciones con !important', () => {
    const offenders = parsed.flatMap(({ file, rules }) =>
      rules
        .filter((r) => r.selector.split(',').some((s) => s.trim().startsWith('*')))
        .flatMap((r) =>
          r.declarations
            .filter((d) => /duration|iteration-count/.test(d.property) && /!important/.test(d.value))
            .map((d) => `${file}: ${r.selector} { ${d.property} }`),
        ),
    );
    expect(offenders).toEqual([]);
  });

  it('[TC-PLATFORM-WEBUI-014] toda animación o transición queda dentro de una consulta de movimiento reducido', () => {
    const offenders = parsed.flatMap(({ file, rules }) =>
      rules
        .filter((r) => !r.keyframes && !inMotionQuery(r.media))
        .flatMap((r) =>
          r.declarations
            .filter((d) => MOTION.test(d.property) && !/^(none|0s?)$/.test(d.value))
            .map((d) => `${file}: ${r.selector} { ${d.property}: ${d.value} }`),
        ),
    );
    expect(offenders).toEqual([]);
  });

  it('[TC-PLATFORM-WEBUI-014] una animación que mueve elementos (transform) solo corre con no-preference', () => {
    const moving = new Set(
      parsed.flatMap(({ rules }) =>
        rules
          .filter((r) => r.keyframes && r.declarations.some((d) => TRANSFORM.test(d.property)))
          .map((r) => r.keyframes!),
      ),
    );
    const offenders = parsed.flatMap(({ file, rules }) =>
      rules
        .filter((r) => !r.keyframes && !inNoPreference(r.media))
        .flatMap((r) =>
          r.declarations
            .filter(
              (d) => /^animation(-name)?$/.test(d.property) && [...moving].some((n) => d.value.includes(n)),
            )
            .map((d) => `${file}: ${r.selector} { ${d.property}: ${d.value} }`),
        ),
    );
    expect(offenders).toEqual([]);
  });

  it('[TC-PLATFORM-WEBUI-014] el analizador detecta una regla universal con !important (control negativo)', () => {
    const rules = parseCss(
      '@media (prefers-reduced-motion: reduce) { *, *::before { animation-duration: 0.01ms !important; } }',
    );
    expect(rules[0]?.selector.startsWith('*')).toBe(true);
    expect(rules[0]?.declarations[0]).toEqual({ property: 'animation-duration', value: '0.01ms !important' });
  });
});
