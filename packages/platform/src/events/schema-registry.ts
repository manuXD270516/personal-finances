import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Ajv2020, type ValidateFunction } from 'ajv/dist/2020.js';
import addFormatsModule from 'ajv-formats';
import { fullEventName, type EventEnvelope } from './envelope.js';

// ajv-formats publica CommonJS con `module.exports = formatsPlugin` y `exports.default`.
const addFormats = ((addFormatsModule as unknown as { default?: unknown }).default ??
  addFormatsModule) as unknown as (ajv: Ajv2020) => Ajv2020;

/** `$id` del envelope v1 (contracts/events/envelope.v1.schema.json). */
export const ENVELOPE_V1_SCHEMA_ID = 'https://contracts.pfos.local/events/envelope.v1.schema.json';

/** Evento que no cumple el contrato publicado o cuyo tipo/versión no tiene schema. */
export class EventContractError extends Error {
  constructor(
    readonly eventName: string,
    readonly reason: string,
  ) {
    super(`evento ${eventName} fuera de contrato: ${reason}`);
    this.name = 'EventContractError';
  }
}

function listSchemas(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return listSchemas(path);
    return entry.isFile() && entry.name.endsWith('.schema.json') ? [path] : [];
  });
}

/**
 * Registro de JSON Schemas de eventos (`contracts/events`). Precarga todos los schemas (los `$ref` relativos entre
 * archivos se resuelven por `$id`, que no es resoluble por red) y elige el de cada evento por su `title`
 * (`<eventType>.v<eventVersion>`). Ajv 2020-12 `strict` + formatos, igual que los tests de contrato de los productores.
 */
export class EventSchemaRegistry {
  private readonly ajv = addFormats(new Ajv2020({ strict: true, allErrors: true }));
  private readonly idsByName = new Map<string, string>();
  private readonly compiled = new Map<string, ValidateFunction>();

  private constructor(schemas: readonly Record<string, unknown>[]) {
    for (const schema of schemas) {
      this.ajv.addSchema(schema);
      const id = schema['$id'];
      const title = schema['title'];
      if (typeof id === 'string' && typeof title === 'string' && id !== ENVELOPE_V1_SCHEMA_ID) {
        this.idsByName.set(title, id);
      }
    }
    if (!this.ajv.getSchema(ENVELOPE_V1_SCHEMA_ID)) {
      throw new Error('contracts/events: falta envelope.v1.schema.json');
    }
  }

  /** Carga `dir` (p. ej. `contracts/events`) recursivamente. */
  static fromDirectory(dir: string): EventSchemaRegistry {
    return new EventSchemaRegistry(
      listSchemas(dir).map((file) => JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>),
    );
  }

  static fromSchemas(schemas: readonly Record<string, unknown>[]): EventSchemaRegistry {
    return new EventSchemaRegistry(schemas);
  }

  /** Nombres completos (`identity.WorkspaceCreated.v1`, …) con schema publicado. */
  eventNames(): string[] {
    return [...this.idsByName.keys()].sort();
  }

  has(eventType: string, eventVersion: number): boolean {
    return this.idsByName.has(fullEventName({ eventType, eventVersion }));
  }

  /** Lanza `EventContractError` si el envelope no cumple el envelope v1 y el schema de su evento. */
  validate(envelope: EventEnvelope): void {
    const name = fullEventName(envelope);
    const id = this.idsByName.get(name);
    if (!id) throw new EventContractError(name, 'no hay schema publicado para este tipo y versión');
    let validate = this.compiled.get(id);
    if (!validate) {
      validate = this.ajv.getSchema(id);
      if (!validate) throw new EventContractError(name, 'schema no compilable');
      this.compiled.set(id, validate);
    }
    if (!validate(envelope)) {
      const reason = (validate.errors ?? [])
        .slice(0, 5)
        .map((e) => `${e.instancePath || '/'} ${e.message ?? 'inválido'}`)
        .join('; ');
      throw new EventContractError(name, reason);
    }
  }
}
