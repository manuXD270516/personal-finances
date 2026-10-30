import { normalizeText } from '@pf/shared-kernel';

/**
 * VO `NormalizedText` (design §5): minúsculas, sin acentos (NFD + quitar diacríticos), espacios colapsados y sin
 * espacios en los extremos. Base de la unicidad de nombres (categorías, grupos, tags, counterparties) y de la
 * coincidencia de alias en descripciones bancarias. `normalizeText` vive en `@pf/shared-kernel` (`text/normalize`,
 * openspec add-rule-engine): RULES y CLASSIFICATION comparan igual; se re-exporta sin cambio de comportamiento.
 */
export { normalizeText };

export class NormalizedText {
  private constructor(readonly value: string) {}

  static of(raw: string): NormalizedText {
    return new NormalizedText(normalizeText(raw));
  }

  equals(other: NormalizedText): boolean {
    return this.value === other.value;
  }

  contains(other: NormalizedText): boolean {
    return other.value.length > 0 && this.value.includes(other.value);
  }

  toString(): string {
    return this.value;
  }
}
