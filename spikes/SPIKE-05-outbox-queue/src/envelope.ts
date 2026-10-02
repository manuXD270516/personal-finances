import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { v7 as uuidv7, v4 as uuidv4 } from 'uuid';

const require = createRequire(import.meta.url);
const Ajv2020 = require('ajv/dist/2020').default;
const addFormats = require('ajv-formats').default;

export interface Envelope {
  eventId: string;
  eventType: string;
  eventVersion: number;
  occurredAt: string;
  workspaceId: string;
  aggregateType: string;
  aggregateId: string;
  aggregateVersion: number;
  correlationId: string;
  causationId: string | null;
  actor: { type: 'USER' | 'SYSTEM' | 'SERVICE'; id: string | null };
  payload: Record<string, unknown>;
}

// Fuente de verdad: contracts/events/envelope.v1.schema.json (copia local sólo para la imagen Docker)
const contractPath = fileURLToPath(new URL('../../../contracts/events/envelope.v1.schema.json', import.meta.url));
const localPath = fileURLToPath(new URL('../envelope.v1.schema.json', import.meta.url));
const schema = JSON.parse(readFileSync(existsSync(contractPath) ? contractPath : localPath, 'utf8'));

const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validateFn = ajv.compile(schema);

export class EnvelopeValidationError extends Error {}

export function validateEnvelope(e: unknown): asserts e is Envelope {
  if (!validateFn(e)) {
    throw new EnvelopeValidationError(ajv.errorsText(validateFn.errors));
  }
}

export const WORKSPACE_ID = '0b9f3f4e-5d7a-4c1e-9a2b-3c4d5e6f7a8b';

export function makeEnvelope(p: {
  aggregateId: string; aggregateVersion: number; payload: Record<string, unknown>;
  eventType?: string; correlationId?: string;
}): Envelope {
  const env: Envelope = {
    eventId: uuidv7(),
    eventType: p.eventType ?? 'transactions.TransactionPosted',
    eventVersion: 1,
    occurredAt: new Date().toISOString(),
    workspaceId: WORKSPACE_ID,
    aggregateType: 'Account',
    aggregateId: p.aggregateId,
    aggregateVersion: p.aggregateVersion,
    correlationId: p.correlationId ?? uuidv4(),
    causationId: null,
    actor: { type: 'USER', id: 'owner' },
    payload: p.payload,
  };
  validateEnvelope(env);
  return env;
}
