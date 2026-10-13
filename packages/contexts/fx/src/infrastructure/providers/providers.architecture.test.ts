import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  FX_CRYPTO_PROVIDER_IDS,
  FX_RATE_PROVIDERS,
  providerDescriptor,
  registeredCryptoDescriptors,
} from '../../domain/index.js';
import { CRYPTO_ADAPTER_FACTORIES } from '../../interface/fx.module.js';
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

  it('[TC-FX-PROVIDER-036] todo adapter registrado tiene un descriptor VERIFIED con su fecha y el ADR que lo registra', () => {
    // Providers de Bolivia (ADR-0025) y providers cripto con adapter real (vacío hasta ADR-0029).
    for (const id of [...FX_RATE_PROVIDERS, ...FX_CRYPTO_PROVIDER_IDS]) {
      const terms = providerDescriptor(id)?.terms;
      expect(terms?.status, id).toBe('VERIFIED');
      expect(terms?.verifiedOn, id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(terms?.adr, id).toMatch(/^ADR-\d{4}$/);
    }
    // Un adapter que un archivo de esta carpeta declara solo puede usar un descriptor verificado.
    for (const { file, text } of sources.filter((s) => s.file.endsWith('.provider.ts'))) {
      const used = [...text.matchAll(/PROVIDER_DESCRIPTORS\.([A-Z_]+)/g)].map((m) => m[1] as string);
      expect(used.length, file).toBeGreaterThan(0);
      for (const id of used) expect(providerDescriptor(id)?.terms.status, `${file}:${id}`).toBe('VERIFIED');
    }
    // El composition root solo construye adapters cripto de ids verificados y no hay ningún descriptor cripto registrado
    // en producción (los registros de los tests se dan de baja).
    for (const id of Object.keys(CRYPTO_ADAPTER_FACTORIES)) {
      expect(FX_CRYPTO_PROVIDER_IDS as readonly string[]).toContain(id);
    }
    expect(registeredCryptoDescriptors()).toEqual([]);
  });

  it('[TC-FX-PROVIDER-034] ningún adapter ni el cliente HTTP recibe pares ni fechas de un workspace', () => {
    for (const { file, text } of sources) {
      expect(text, file).not.toMatch(/RatePairList|rate_pair|firstBalance|FirstBalance|effectiveRatePairs/);
    }
  });
});
