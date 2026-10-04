/**
 * Validador mínimo de los consumer contracts de los adapters (`PARALELO_RATE_CONTRACT`, `PARALELO_HISTORY_CONTRACT`,
 * `DOLARAPI_DOLARES_CONTRACT`): el subconjunto de JSON Schema que esos contratos usan (`type` simple o unión,
 * `required`, `properties`, `items`, `const` y `format: date-time`). Lo usa el smoke en vivo (`pnpm fx:smoke-live`)
 * para comparar la respuesta real con el contrato grabado; devuelve la lista de violaciones (vacía = conforme).
 */
export interface JsonContract {
  readonly type?: string | readonly string[];
  readonly required?: readonly string[];
  readonly properties?: Readonly<Record<string, JsonContract>>;
  readonly items?: JsonContract;
  readonly const?: unknown;
  readonly format?: string;
}

const typeOf = (value: unknown): string =>
  value === null
    ? 'null'
    : Array.isArray(value)
      ? 'array'
      : typeof value === 'number'
        ? Number.isInteger(value)
          ? 'integer'
          : 'number'
        : typeof value;

const matchesType = (value: unknown, type: string): boolean => {
  const actual = typeOf(value);
  return actual === type || (type === 'number' && actual === 'integer');
};

export function validateContract(contract: JsonContract, value: unknown, path = '$'): string[] {
  const errors: string[] = [];
  if (contract.type !== undefined) {
    const types = typeof contract.type === 'string' ? [contract.type] : contract.type;
    if (!types.some((t) => matchesType(value, t))) {
      return [`${path}: se esperaba ${types.join(' | ')}, llegó ${typeOf(value)}`];
    }
  }
  if (contract.const !== undefined && value !== contract.const) {
    errors.push(`${path}: se esperaba ${JSON.stringify(contract.const)}, llegó ${JSON.stringify(value)}`);
  }
  if (contract.format === 'date-time' && typeof value === 'string' && Number.isNaN(Date.parse(value))) {
    errors.push(`${path}: no es una fecha-hora válida`);
  }
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    for (const key of contract.required ?? []) if (!(key in obj)) errors.push(`${path}: falta '${key}'`);
    for (const [key, sub] of Object.entries(contract.properties ?? {})) {
      if (key in obj) errors.push(...validateContract(sub, obj[key], `${path}.${key}`));
    }
  }
  if (Array.isArray(value) && contract.items) {
    value.forEach((item, i) => errors.push(...validateContract(contract.items!, item, `${path}[${i}]`)));
  }
  return errors;
}
