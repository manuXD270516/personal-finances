import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { EventSchemaRegistry } from '@pf/platform/events';

/**
 * JSON Schemas de eventos: en el repo se lee la fuente (`contracts/events`); en la imagen, la copia que deja el build
 * en `apps/api/contract/events/` (scripts/copy-contract.mjs).
 */
export function resolveEventContractsDir(): string {
  const candidates = [
    new URL('../../../../contracts/events/', import.meta.url),
    new URL('../../contract/events/', import.meta.url),
  ].map((u) => fileURLToPath(u));
  const found = candidates.find((p) => existsSync(p));
  if (!found) throw new Error(`contratos de eventos no encontrados (${candidates.join(' | ')})`);
  return found;
}

let cached: EventSchemaRegistry | undefined;

/** Registro de schemas de eventos (se carga una vez por proceso). */
export function eventSchemaRegistry(): EventSchemaRegistry {
  cached ??= EventSchemaRegistry.fromDirectory(resolveEventContractsDir());
  return cached;
}
