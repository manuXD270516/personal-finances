import { readFileSync } from 'node:fs';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormatsModule from 'ajv-formats';
import { describe, expect, it } from 'vitest';
import { IdentityService } from './identity.service.js';
import { InMemoryIdentity } from './testing/in-memory.js';

// ajv-formats es CJS: según el loader, el default llega envuelto.
const addFormats = ((addFormatsModule as unknown as { default?: unknown }).default ??
  addFormatsModule) as unknown as (ajv: Ajv2020) => void;
const EVENTS = new URL('../../../../../contracts/events/', import.meta.url);
const load = (path: string): Record<string, unknown> =>
  JSON.parse(readFileSync(new URL(path, EVENTS), 'utf8')) as Record<string, unknown>;

function payloadValidator(schemaPath: string) {
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  addFormats(ajv);
  const envelope = load('envelope.v1.schema.json');
  const schema = load(schemaPath);
  ajv.addSchema(envelope);
  ajv.addSchema(schema);
  return ajv.compile({ $ref: `${String(schema['$id'])}#/$defs/Payload` });
}

describe('Contratos de eventos de IDENTITY (tarea 6.3, payloads contra contracts/events/identity)', () => {
  it('identity.WorkspaceCreated.v1: el payload producido cumple el schema (Ajv strict)', async () => {
    const mem = new InMemoryIdentity();
    const svc = new IdentityService(mem.deps());
    const { userId } = await svc.provision({
      issuer: 'https://idp.test',
      subject: 'kc-1',
      email: 'nuevo@demo.pfos.test',
      emailVerified: true,
      displayName: 'Nuevo',
    });
    await svc.createWorkspace(userId, {
      name: 'Hogar',
      baseCurrency: 'USD',
      timezone: 'UTC',
      locale: 'en-US',
    });
    const validate = payloadValidator('identity/WorkspaceCreated.v1.schema.json');
    const created = mem.outboxEvents.filter((e) => e.eventType === 'identity.WorkspaceCreated');
    expect(created).toHaveLength(2);
    for (const e of created) expect(validate(e.payload), JSON.stringify(validate.errors)).toBe(true);
  });

  it('identity.WorkspaceSettingsChanged.v1: cambios con Money como string y valores null cumplen el schema', async () => {
    const mem = new InMemoryIdentity();
    const svc = new IdentityService(mem.deps());
    const owner = mem.addUser('owner@demo.pfos.test');
    const ws = mem.addWorkspace('Personal', [[owner, 'OWNER']]);
    await svc.updateWorkspaceSettings(owner.id, ws.id, 1, {
      name: 'Casa',
      baseCurrency: 'USD',
      timezone: 'America/Sao_Paulo',
      locale: 'en-US',
      fiscalMonthStartDay: 25,
      minimumLiquidityReserve: { amount: '1500.00', currency: 'BOB' },
    });
    await svc.updateWorkspaceSettings(owner.id, ws.id, 2, { minimumLiquidityReserve: null });
    const validate = payloadValidator('identity/WorkspaceSettingsChanged.v1.schema.json');
    const changed = mem.outboxEvents.filter((e) => e.eventType === 'identity.WorkspaceSettingsChanged');
    expect(changed.map((e) => e.aggregateVersion)).toEqual([2, 3]);
    for (const e of changed) {
      const payload = JSON.parse(JSON.stringify(e.payload)) as unknown;
      expect(validate(payload), JSON.stringify(validate.errors)).toBe(true);
    }
  });
});
