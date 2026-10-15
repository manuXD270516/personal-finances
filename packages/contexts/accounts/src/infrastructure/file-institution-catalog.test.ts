import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { demoTerms, threeEntryCatalog } from '../domain/institution-catalog.test-support.js';
import {
  CatalogFileInvalidError,
  DEMO_PROVIDER_ID,
  FileInstitutionCatalogReader,
} from './file-institution-catalog.js';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'pf-catalog-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const write = (name: string, value: unknown) =>
  writeFile(join(dir, name), typeof value === 'string' ? value : JSON.stringify(value), 'utf8');

describe('FileInstitutionCatalogReader (accounts/institutions: catálogo como archivo de datos)', () => {
  it('[TC-ACCOUNTS-INSTCATALOG-001] lee y valida <PAÍS>.json de la ruta configurada; un país sin archivo es null', async () => {
    await write('BO.json', threeEntryCatalog());
    const reader = new FileInstitutionCatalogReader({ directory: dir, terms: demoTerms });
    const catalog = await reader.get('BO');
    expect(catalog?.entries.map((e) => e.code)).toEqual(['BAD', 'CID', 'BAL']);
    expect(catalog?.source.cutoffDate).toBe('2026-09-30');
    expect(await reader.get('AR')).toBeNull();
    expect(await reader.countries()).toEqual(['BO']);
  });

  it('un país con formato inválido (ruta con separadores o minúsculas) nunca toca el sistema de archivos', async () => {
    const reader = new FileInstitutionCatalogReader({ directory: dir, terms: demoTerms });
    for (const bad of ['../BO', 'bo', 'BOL', '', 'B/', 'B.']) expect(await reader.get(bad)).toBeNull();
  });

  it('guarda el catálogo validado en memoria: una segunda lectura no vuelve a leer el archivo', async () => {
    await write('BO.json', threeEntryCatalog());
    const reader = new FileInstitutionCatalogReader({ directory: dir, terms: demoTerms });
    const first = await reader.get('BO');
    await rm(join(dir, 'BO.json'));
    expect(await reader.get('BO')).toBe(first);
  });

  it('un archivo inválido lanza CatalogFileInvalidError con las fallas y no se cachea', async () => {
    await write('BO.json', threeEntryCatalog({ source: undefined }));
    const reader = new FileInstitutionCatalogReader({ directory: dir, terms: demoTerms });
    await expect(reader.get('BO')).rejects.toBeInstanceOf(CatalogFileInvalidError);
    await expect(reader.get('BO')).rejects.toThrow(/SOURCE_REQUIRED/);
    await write('BO.json', threeEntryCatalog());
    expect((await reader.get('BO'))?.entries).toHaveLength(3);
    await write('AR.json', '{ no es json');
    await expect(reader.get('AR')).rejects.toThrow(/CATALOG_NOT_JSON/);
    // El archivo de un país que declara otro país es inválido.
    await write('PE.json', threeEntryCatalog());
    await expect(reader.get('PE')).rejects.toThrow(/COUNTRY_MISMATCH/);
  });

  it('preload valida todos los archivos y devuelve el error de cada uno sin lanzar', async () => {
    await write('BO.json', threeEntryCatalog());
    await write('AR.json', '{}');
    await write('notas.txt', 'ignorado');
    await mkdir(join(dir, 'demo'));
    await write('demo/PE.json', threeEntryCatalog());
    const result = await new FileInstitutionCatalogReader({ directory: dir, terms: demoTerms }).preload();
    expect([...result.keys()]).toEqual(['AR', 'BO']);
    expect(result.get('BO')).toBeNull();
    expect(result.get('AR')).toBeInstanceOf(CatalogFileInvalidError);
  });

  it('solo un catálogo fictitious puede referenciar al proveedor simulado INSTRATE_DEMO; el real no', async () => {
    const supported = (extra: Record<string, unknown>) => {
      const raw = threeEntryCatalog(extra);
      (raw['entries'] as Record<string, unknown>[])[0] = {
        ...(raw['entries'] as Record<string, unknown>[])[0],
        support: {
          rates: {
            status: 'SUPPORTED',
            evaluatedOn: '2026-10-15',
            providerIds: [DEMO_PROVIDER_ID],
          },
          statementImport: { status: 'GENERIC_ONLY', evaluatedOn: '2026-10-15' },
        },
      };
      return raw;
    };
    const none = () => null;
    await write('BO.json', supported({}));
    expect(
      (await new FileInstitutionCatalogReader({ directory: dir, terms: none }).get('BO'))?.fictitious,
    ).toBe(true);
    await write('BO.json', supported({ fictitious: false }));
    await expect(new FileInstitutionCatalogReader({ directory: dir, terms: none }).get('BO')).rejects.toThrow(
      /PROVIDER_TERMS_NOT_VERIFIED/,
    );
  });

  it('un directorio inexistente no es un error: sin países', async () => {
    const reader = new FileInstitutionCatalogReader({ directory: join(dir, 'no-existe'), terms: demoTerms });
    expect(await reader.countries()).toEqual([]);
    expect(await reader.get('BO')).toBeNull();
    expect((await reader.preload()).size).toBe(0);
  });
});
