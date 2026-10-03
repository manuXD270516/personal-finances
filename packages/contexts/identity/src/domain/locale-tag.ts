import { DomainError } from '@pf/shared-kernel';

/** Idiomas soportados por la UI (español por defecto; en/pt vía i18n). */
const SUPPORTED_LANGUAGES = new Set(['es', 'en', 'pt']);

/** Etiqueta BCP 47 canónica (`es-BO`, `en-US`). */
export class LocaleTag {
  private constructor(readonly value: string) {
    Object.freeze(this);
  }

  static of(value: string): LocaleTag {
    let canonical: string;
    try {
      canonical = Intl.getCanonicalLocales(value)[0] ?? '';
    } catch {
      throw new DomainError('VALIDATION_FAILED', `invalid locale '${String(value)}'`);
    }
    const language = canonical.split('-')[0] ?? '';
    if (!SUPPORTED_LANGUAGES.has(language) || canonical.length > 35) {
      throw new DomainError('VALIDATION_FAILED', `unsupported locale '${value}'`);
    }
    return new LocaleTag(canonical);
  }

  toString(): string {
    return this.value;
  }
}
