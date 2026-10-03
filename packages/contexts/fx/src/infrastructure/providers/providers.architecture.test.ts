import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ProviderHttpClient } from './provider-http-client.js';

// Test de arquitectura (tarea 4.5; design.md decisiones 2 y 10): el código de los adapters y del cliente HTTP no
// tiene acceso a ningún contexto de workspace ni de usuario y no usa JSON.parse/response.json().
const DIR = fileURLToPath(new URL('./', import.meta.url));
const sources = readdirSync(DIR)
  .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && !f.endsWith('.test-support.ts'))
  .map((f) => ({ file: f, text: readFileSync(`${DIR}${f}`, 'utf8') }))
  // Sin comentarios: la documentación puede nombrar lo que el código no usa.
  .map((s) => ({ ...s, text: s.text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '') }));

describe('Arquitectura de infrastructure/providers (fx/market-rate-providers)', () => {
  it('[TC-FX-PROVIDER-013] el cliente HTTP y los adapters no importan contexto de request, de workspace ni la capa de aplicación', () => {
    expect(sources.map((s) => s.file).sort()).toEqual([
      'dolarapi-bo.provider.ts',
      'lossless-json-reader.ts',
      'paralelo-bo.provider.ts',
      'provider-http-client.ts',
    ]);
    for (const { file, text } of sources) {
      expect(text, file).not.toMatch(/from '@pf\/platform\/(api|nest|events)'/);
      expect(text, file).not.toMatch(/from '\.\.\/\.\.\/application\//);
      expect(text, file).not.toMatch(/currentRequestContext|workspaceId|userId|app\.workspace_id/);
    }
  });

  it('[TC-FX-PROVIDER-013] getText solo recibe provider, URL y límite (ningún parámetro de workspace o usuario)', () => {
    expect(ProviderHttpClient.prototype.getText.length).toBe(3);
    const signature = /async getText\(([^)]*)\)/.exec(
      sources.find((s) => s.file === 'provider-http-client.ts')?.text ?? '',
    )?.[1];
    expect(signature?.replace(/\s+/g, ' ').trim()).toBe(
      'provider: FxRateProvider, rawUrl: string, limitPerMinute: number',
    );
  });

  it('[TC-FX-PROVIDER-003] ningún adapter usa JSON.parse ni response.json() (lectura lossless obligatoria)', () => {
    for (const { file, text } of sources) {
      expect(text, file).not.toMatch(/JSON\.parse\s*\(|\.json\s*\(\s*\)/);
    }
  });
});
