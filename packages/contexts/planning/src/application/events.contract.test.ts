import { readFileSync } from 'node:fs';
import { Instant } from '@pf/shared-kernel';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormatsModule from 'ajv-formats';
import { describe, expect, it } from 'vitest';
import { PeriodsService } from './periods.service.js';
import { InMemoryPlanning } from './testing/in-memory.js';

// ajv-formats es CJS: según el loader, el default llega envuelto.
const addFormats = ((addFormatsModule as unknown as { default?: unknown }).default ??
  addFormatsModule) as unknown as (ajv: Ajv2020) => void;
const EVENTS = new URL('../../../../../contracts/events/', import.meta.url);
const load = (path: string): Record<string, unknown> =>
  JSON.parse(readFileSync(new URL(path, EVENTS), 'utf8')) as Record<string, unknown>;

function payloadValidator(schemaPath: string) {
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  addFormats(ajv);
  const schema = load(schemaPath);
  ajv.addSchema(load('envelope.v1.schema.json'));
  ajv.addSchema(schema);
  return ajv.compile({ $ref: `${String(schema['$id'])}#/$defs/Payload` });
}

const W1 = '0190a000-0000-7000-8000-00000000a001';

describe('Contrato del productor planning.PeriodActivated.v1 (tarea 5.3)', () => {
  it('[TC-PLANNING-EVENT-001] dos ejecuciones del proceso publican un único evento de "2026-11" (2026-11-01..2026-11-30, AUTOMATIC) que cumple el schema', async () => {
    const mem = new InMemoryPlanning();
    mem.workspace(W1);
    const svc = new PeriodsService(mem.deps());
    mem.clock.set(Instant.parse('2026-10-20T12:00:00Z'));
    await svc.ensurePeriods({ workspaceId: W1 });
    mem.clock.set(Instant.parse('2026-11-01T04:05:00Z'));
    await svc.ensurePeriods({ workspaceId: W1 });
    await svc.ensurePeriods({ workspaceId: W1 });
    const events = mem.events.filter((e) => e.eventType === 'planning.PeriodActivated');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      eventVersion: 1,
      aggregateType: 'FinancialPeriod',
      payload: {
        workspaceId: W1,
        label: '2026-11',
        periodStart: '2026-11-01',
        periodEnd: '2026-11-30',
        startDay: 1,
        isTransition: false,
        activation: 'AUTOMATIC',
      },
    });
    const validate = payloadValidator('planning/PeriodActivated.v1.schema.json');
    expect(validate(events[0]!.payload), JSON.stringify(validate.errors)).toBe(true);
    // Un payload con un campo extra o una activación desconocida no cumple el contrato.
    expect(validate({ ...(events[0]!.payload as object), extra: 1 })).toBe(false);
    expect(validate({ ...(events[0]!.payload as object), activation: 'CRON' })).toBe(false);
  });
});
