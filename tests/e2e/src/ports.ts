import { parseEnvLines } from '../../../scripts/stack/src/lib/dotenv.js';

/** Prefijos de puertos válidos (CLAUDE.md: el 5 choca con otro stack en 55432 y 56379). */
export const PORT_PREFIXES = ['3', '4'] as const;
export type PortPrefix = (typeof PORT_PREFIXES)[number];

/**
 * Primer dígito de los puertos publicados de la corrida (`4` ⇒ 4xxxx por omisión). Un valor fuera de `3|4` falla
 * ANTES de tocar Docker (se evalúa al importar el harness) en lugar de caer en silencio a otro prefijo.
 */
export function resolvePortPrefix(raw: string | undefined): PortPrefix {
  if (raw === undefined || raw === '') return '4';
  if ((PORT_PREFIXES as readonly string[]).includes(raw)) return raw as PortPrefix;
  throw new Error(
    `PF_E2E_PORT_PREFIX debe ser 3 o 4 (recibido: ${raw}); el prefijo 5 choca con otro stack en 55432 y 56379`,
  );
}

/** Todos los `PF_*_PORT` de `.env.example` (también los de TLS) con el primer dígito reemplazado por el prefijo. */
export function portsFor(exampleText: string, prefix: PortPrefix): Map<string, string> {
  const ports = new Map<string, string>();
  for (const line of parseEnvLines(exampleText)) {
    if (line.key && /^PF_[A-Z0-9_]+_PORT$/.test(line.key))
      ports.set(line.key, `${prefix}${line.value!.slice(1)}`);
  }
  return ports;
}
