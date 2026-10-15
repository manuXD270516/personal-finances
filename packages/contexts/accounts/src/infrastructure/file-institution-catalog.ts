import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { InstitutionCatalogReader } from '../application/ports/index.js';
import {
  validateCatalog,
  type CatalogIssue,
  type InstitutionCatalog,
  type ProviderTermsLookup,
} from '../domain/index.js';

/** Proveedor SIMULADO que solo un catálogo declarado `fictitious` puede referenciar (nunca existe como adapter real). */
export const DEMO_PROVIDER_ID = 'INSTRATE_DEMO';

const COUNTRY = /^[A-Z]{2}$/;
const FILE = /^([A-Z]{2})\.json$/;

/** El archivo existe pero no pasa `CatalogValidator`: es un error de la instalación, no un dato del usuario. */
export class CatalogFileInvalidError extends Error {
  constructor(
    readonly country: string,
    readonly issues: readonly CatalogIssue[],
  ) {
    super(
      `institution catalog ${country} is invalid: ${issues
        .slice(0, 5)
        .map((i) => `${i.code}${i.path ? ` at ${i.path}` : ''}`)
        .join(', ')}${issues.length > 5 ? `, … (${issues.length} issues)` : ''}`,
    );
    this.name = 'CatalogFileInvalidError';
  }
}

export interface FileInstitutionCatalogOptions {
  /**
   * Directorio con un archivo `<PAÍS>.json` por país (ruta configurable: `ACCOUNTS_INSTITUTION_CATALOG_DIR`). No se
   * recorren subdirectorios: el catálogo ficticio de pruebas vive en `demo/` y no se confunde con el real.
   */
  readonly directory: string;
  /** Verificación de términos de los proveedores de tasas (FX, vía el composition root). */
  readonly terms: ProviderTermsLookup;
}

/**
 * `InstitutionCatalogReader` sobre archivo (design.md decisión 1): lee `<directorio>/<PAÍS>.json`, lo valida con
 * `CatalogValidator` y guarda el resultado en memoria (el catálogo cambia por PR y despliegue, nunca en caliente). Un
 * país sin archivo es `null`; un archivo inválido lanza `CatalogFileInvalidError` (no se cachea, se reintenta en la
 * siguiente consulta). Solo un catálogo con `"fictitious": true` puede referenciar al proveedor simulado
 * `INSTRATE_DEMO`: el catálogo real nunca depende de él.
 */
export class FileInstitutionCatalogReader implements InstitutionCatalogReader {
  private readonly cache = new Map<string, InstitutionCatalog>();

  constructor(private readonly options: FileInstitutionCatalogOptions) {}

  async get(country: string): Promise<InstitutionCatalog | null> {
    if (!COUNTRY.test(country)) return null;
    const cached = this.cache.get(country);
    if (cached) return cached;
    let text: string;
    try {
      text = await readFile(join(this.options.directory, `${country}.json`), 'utf8');
    } catch (err) {
      if ((err as { code?: string }).code === 'ENOENT') return null;
      throw err;
    }
    const catalog = this.parse(country, text);
    this.cache.set(country, catalog);
    return catalog;
  }

  /** Países con archivo en el directorio (`BO.json` ⇒ `BO`); vacío si el directorio no existe. */
  async countries(): Promise<string[]> {
    try {
      return (await readdir(this.options.directory))
        .map((f) => FILE.exec(f)?.[1])
        .filter((c): c is string => c !== undefined)
        .sort();
    } catch (err) {
      if ((err as { code?: string }).code === 'ENOENT') return [];
      throw err;
    }
  }

  /** Valida todos los archivos al arrancar (falla temprano y a la vista); devuelve país → error o `null`. */
  async preload(): Promise<ReadonlyMap<string, CatalogFileInvalidError | null>> {
    const out = new Map<string, CatalogFileInvalidError | null>();
    for (const country of await this.countries()) {
      try {
        await this.get(country);
        out.set(country, null);
      } catch (err) {
        if (!(err instanceof CatalogFileInvalidError)) throw err;
        out.set(country, err);
      }
    }
    return out;
  }

  private parse(country: string, text: string): InstitutionCatalog {
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      throw new CatalogFileInvalidError(country, [
        { code: 'CATALOG_NOT_JSON', path: '', message: 'the catalog file is not valid JSON' },
      ]);
    }
    const fictitious =
      typeof raw === 'object' && raw !== null && (raw as { fictitious?: unknown }).fictitious === true;
    const terms: ProviderTermsLookup = (id) =>
      fictitious && id === DEMO_PROVIDER_ID ? 'VERIFIED' : this.options.terms(id);
    const result = validateCatalog(raw, { terms });
    if (!result.ok) throw new CatalogFileInvalidError(country, result.issues);
    if (result.catalog.country !== country) {
      throw new CatalogFileInvalidError(country, [
        {
          code: 'COUNTRY_MISMATCH',
          path: '/country',
          message: `${country}.json declares country ${result.catalog.country}`,
        },
      ]);
    }
    return result.catalog;
  }
}
