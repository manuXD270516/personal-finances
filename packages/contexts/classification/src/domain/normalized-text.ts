/**
 * VO `NormalizedText` (design §5): minúsculas, sin acentos (NFD + quitar diacríticos), espacios colapsados y sin
 * espacios en los extremos. Base de la unicidad de nombres (categorías, grupos, tags, counterparties) y de la
 * coincidencia de alias en descripciones bancarias.
 */
export function normalizeText(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/\s+/gu, ' ')
    .trim();
}

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
