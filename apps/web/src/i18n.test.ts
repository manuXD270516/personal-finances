import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { routing } from '../i18n/routing';

type Tree = { [key: string]: string | Tree };
const load = (locale: string): Tree =>
  JSON.parse(readFileSync(new URL(`../messages/${locale}.json`, import.meta.url), 'utf8')) as Tree;
const keys = (tree: Tree, prefix = ''): string[] =>
  Object.entries(tree).flatMap(([k, v]) =>
    typeof v === 'string' ? [`${prefix}${k}`] : keys(v, `${prefix}${k}.`),
  );

describe('i18n del web shell', () => {
  it('español es el locale por defecto y hay catálogos para en y pt', () => {
    expect(routing.defaultLocale).toBe('es');
    expect([...routing.locales]).toEqual(['es', 'en', 'pt']);
  });

  it('todos los catálogos tienen exactamente las mismas claves que es, sin textos vacíos', () => {
    const reference = keys(load('es')).sort();
    for (const locale of routing.locales) {
      const catalog = load(locale);
      expect(keys(catalog).sort()).toEqual(reference);
      for (const k of keys(catalog)) {
        const value = k.split('.').reduce<Tree | string>((node, part) => (node as Tree)[part]!, catalog);
        expect(String(value).trim()).not.toBe('');
      }
    }
  });
});
