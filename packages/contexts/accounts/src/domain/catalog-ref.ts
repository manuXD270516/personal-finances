import { DomainError } from '@pf/shared-kernel';

/** Código de una entrada de catálogo: la sigla del registro oficial (o un código propio `X-<slug>`). */
export const CATALOG_CODE = /^[A-Z0-9][A-Z0-9-]{1,39}$/;
const COUNTRY = /^[A-Z]{2}$/;
const MAX_VERSION = 40;

const invalid = (pointer: string, message: string) =>
  new DomainError('VALIDATION_FAILED', message).at(pointer);

/**
 * VO `CatalogRef` (accounts/institutions, add-exchange-house-rate-providers): el vínculo de una institución del
 * workspace con una entrada del catálogo de referencia (país, código y versión del catálogo de la que se adoptó).
 * Los tres datos viajan juntos o no hay vínculo ("los tres o ninguno": el CHECK de `accounts.institution` lo repite).
 * Inmutable: renombrar o editar la institución no lo cambia.
 */
export class CatalogRef {
  private constructor(
    readonly country: string,
    readonly code: string,
    readonly version: string,
  ) {
    Object.freeze(this);
  }

  static of(country: string, code: string, version: string): CatalogRef {
    if (typeof country !== 'string' || !COUNTRY.test(country)) {
      throw invalid('/catalogRef/country', 'catalog country must be ISO 3166-1 alpha-2');
    }
    if (typeof code !== 'string' || !CATALOG_CODE.test(code)) {
      throw invalid('/catalogRef/code', 'catalog code must match ^[A-Z0-9][A-Z0-9-]{1,39}$');
    }
    if (typeof version !== 'string' || version.length < 1 || version.length > MAX_VERSION) {
      throw invalid('/catalogRef/version', `catalog version must have 1..${MAX_VERSION} characters`);
    }
    return new CatalogRef(country, code, version);
  }

  /** Reconstruye desde las tres columnas: todas nulas ⇒ sin vínculo; parcial ⇒ dato corrupto. */
  static fromColumns(country: string | null, code: string | null, version: string | null): CatalogRef | null {
    if (country === null && code === null && version === null) return null;
    if (country === null || code === null || version === null) {
      throw invalid('/catalogRef', 'catalog country, code and version must be set together or not at all');
    }
    return CatalogRef.of(country, code, version);
  }

  equals(other: CatalogRef | null): boolean {
    return other !== null && other.country === this.country && other.code === this.code;
  }

  toJSON(): { country: string; code: string; version: string } {
    return { country: this.country, code: this.code, version: this.version };
  }
}
