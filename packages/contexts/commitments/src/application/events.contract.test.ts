import { readFileSync } from 'node:fs';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormatsModule from 'ajv-formats';
import { describe, expect, it } from 'vitest';
import { CommitmentsQueries } from './commitments.queries.js';
import { DefinitionsService } from './definitions.service.js';
import { GenerateOccurrencesService } from './generate-occurrences.service.js';
import { OccurrencesService } from './occurrences.service.js';
import { BANK, CATEGORY, InMemoryCommitments, USER, WS } from './testing/in-memory.js';

// ajv-formats es CJS: según el loader, el default llega envuelto.
const addFormats = ((addFormatsModule as unknown as { default?: unknown }).default ??
  addFormatsModule) as unknown as (ajv: Ajv2020) => void;
const EVENTS = new URL('../../../../../contracts/events/', import.meta.url);
const load = (path: string): Record<string, unknown> =>
  JSON.parse(readFileSync(new URL(path, EVENTS), 'utf8')) as Record<string, unknown>;

const FILES: Record<string, string> = {
  'commitments.OccurrencesGenerated': 'commitments/OccurrencesGenerated.v1.schema.json',
  'commitments.RecurringOccurrenceDue': 'commitments/RecurringOccurrenceDue.v1.schema.json',
  'commitments.RecurringOccurrenceMaterialized': 'commitments/RecurringOccurrenceMaterialized.v1.schema.json',
  'commitments.RecurringOccurrenceChanged': 'commitments/RecurringOccurrenceChanged.v1.schema.json',
  'commitments.RecurringDefinitionChanged': 'commitments/RecurringDefinitionChanged.v1.schema.json',
};

function validators() {
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  addFormats(ajv);
  ajv.addSchema(load('envelope.v1.schema.json'));
  const out = new Map<string, ReturnType<Ajv2020['compile']>>();
  for (const [type, file] of Object.entries(FILES)) {
    const schema = load(file);
    ajv.addSchema(schema);
    out.set(type, ajv.compile({ $ref: `${String(schema['$id'])}#/$defs/Payload` }));
  }
  return out;
}

describe('Contrato de los hechos de commitments', () => {
  it('[TC-COMMITMENTS-RECUR-040] cada hecho publicado cumple su JSON Schema y los montos viajan como texto decimal', async () => {
    const mem = new InMemoryCommitments();
    mem.setNow('2026-11-02T16:00:00Z');
    const deps = mem.deps();
    const defs = new DefinitionsService(deps);
    const occs = new OccurrencesService(deps);
    const job = new GenerateOccurrencesService(deps, occs);
    const queries = new CommitmentsQueries(deps);
    const rent = await defs.create({
      workspaceId: WS,
      userId: USER,
      name: 'Alquiler',
      kind: 'EXPENSE',
      template: {
        accountId: BANK,
        amount: { type: 'FIXED', amount: { amount: '3500.00', currency: 'BOB' } },
        categoryId: CATEGORY,
        schedule: { cadence: 'MONTHLY', startDate: '2026-11-05' },
        materialization: { mode: 'PENDING_APPROVAL', leadDays: 3 },
      },
    });
    await job.runWorkspace(WS);
    const [first, second] = mem.forDefinition(rent.id);
    await occs.materialize({ workspaceId: WS, userId: USER, occurrenceId: first!.id });
    await occs.edit({
      workspaceId: WS,
      userId: USER,
      occurrenceId: second!.id,
      expectedVersion: mem.occurrence(second!.id).version,
      dueDate: '2026-12-07',
    });
    await occs.skip({ workspaceId: WS, userId: USER, occurrenceId: second!.id, reason: 'viaje' });
    const third = mem.forDefinition(rent.id)[2]!;
    const txn = mem.addTransaction({
      kind: 'EXPENSE',
      accountId: BANK,
      amount: { amount: '3500.00', currency: 'BOB' },
    });
    await occs.link({ workspaceId: WS, userId: USER, occurrenceId: third.id, transactionId: txn });
    mem.voidTransaction(txn);
    await occs.onTransactionVoided({ workspaceId: WS, transactionId: txn });
    const def = await queries.getDefinition(WS, rent.id);
    await defs.pause({ workspaceId: WS, userId: USER, definitionId: rent.id, expectedVersion: def.version });
    const paused = await queries.getDefinition(WS, rent.id);
    await defs.resume({
      workspaceId: WS,
      userId: USER,
      definitionId: rent.id,
      expectedVersion: paused.version,
    });
    const resumed = await queries.getDefinition(WS, rent.id);
    await defs.revise({
      workspaceId: WS,
      userId: USER,
      definitionId: rent.id,
      expectedVersion: resumed.version,
      effectiveFrom: '2027-01-05',
      changes: { amount: { type: 'FIXED', amount: { amount: '3800.00', currency: 'BOB' } } },
    });

    const check = validators();
    const seen = new Set<string>();
    for (const event of mem.events) {
      const validate = check.get(event.eventType);
      expect(validate, event.eventType).toBeDefined();
      expect(validate?.(event.payload), `${event.eventType}: ${JSON.stringify(validate?.errors)}`).toBe(true);
      seen.add(event.eventType);
    }
    expect([...seen].sort()).toEqual(Object.keys(FILES).sort());

    const materialized = mem.eventsOf('commitments.RecurringOccurrenceMaterialized')[0];
    expect(materialized?.payload).toMatchObject({
      occurrenceId: first!.id,
      mode: 'CREATED',
      amount: { amount: '3500.00', currency: 'BOB' },
    });
    expect(
      mem
        .eventsOf('commitments.RecurringOccurrenceMaterialized')
        .filter((e) => e.payload['occurrenceId'] === first!.id),
    ).toHaveLength(1);

    // Un campo extra o un enum desconocido no cumplen el contrato.
    const validate = check.get('commitments.RecurringOccurrenceMaterialized')!;
    expect(validate({ ...(materialized?.payload as object), extra: 1 })).toBe(false);
    expect(validate({ ...(materialized?.payload as object), mode: 'MAGIC' })).toBe(false);
    expect(
      validate({ ...(materialized?.payload as object), amount: { amount: 3500, currency: 'BOB' } }),
    ).toBe(false);
  });
});
