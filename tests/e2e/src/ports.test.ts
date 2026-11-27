import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { portsFor, resolvePortPrefix } from './ports.js';

const example = readFileSync(resolve(import.meta.dirname, '../../../.env.example'), 'utf8');

describe('puertos del stack de E2E', () => {
  it('[TC-PLATFORM-STACK-012] con prefijo 3 todos los PF_*_PORT, incluidos los TLS, empiezan por 3', () => {
    const ports = portsFor(example, resolvePortPrefix('3'));
    for (const key of ['PF_WEB_TLS_PORT', 'PF_KEYCLOAK_TLS_PORT', 'PF_OBJECT_STORAGE_TLS_PORT'])
      expect(ports.get(key), key).toMatch(/^3\d{4}$/);
    expect(ports.size).toBeGreaterThan(10);
    for (const [key, value] of ports) expect(value, key).toMatch(/^3\d{4}$/);
    expect(ports.get('PF_WEB_TLS_PORT')).toBe('33443');
  });

  it('[TC-PLATFORM-STACK-012] por omisión el prefijo es 4 y el 4 se acepta', () => {
    expect(resolvePortPrefix(undefined)).toBe('4');
    expect(resolvePortPrefix('4')).toBe('4');
    expect(portsFor(example, '4').get('PF_KEYCLOAK_TLS_PORT')).toBe('48443');
  });

  it('[TC-PLATFORM-STACK-012] con prefijo 5 (u otro valor) falla antes de tocar Docker y nombra la variable y los valores 3 y 4', () => {
    for (const bad of ['5', '2', '44', 'x']) {
      expect(() => resolvePortPrefix(bad), bad).toThrow(/PF_E2E_PORT_PREFIX.*3 o 4/);
    }
  });
});
