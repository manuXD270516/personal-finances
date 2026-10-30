/**
 * `normalizeText`: minúsculas, sin acentos (NFD + quitar diacríticos), espacios colapsados y sin espacios en los
 * extremos. Base común de la unicidad de nombres y de los alias de CLASSIFICATION y de la comparación de texto de las
 * reglas de RULES (openspec add-rule-engine decisión 9): ambos contextos comparan igual.
 */
export function normalizeText(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/\s+/gu, ' ')
    .trim();
}
