import { readFileSync } from 'node:fs';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormatsModule from 'ajv-formats';
import { describe, expect, it } from 'vitest';
import { CommitmentsQueries } from './commitments.queries.js';
import { DefinitionsService } from './definitions.service.js';
import { GenerateOccurrencesService } from './generate-occurrences.service.js';
import { MatchingService } from './matching.service.js';
import { OccurrencesService } from './occurrences.service.js';
import { SubscriptionDailyService } from './subscription-daily.service.js';
import { SubscriptionsQueries } from './subscriptions.queries.js';
import { SubscriptionsService } from './subscriptions.service.js';
import { BANK, CARD, CATEGORY, InMemoryCommitments, USER, VISA_USD, WS } from './testing/in-memory.js';
import { InMemorySubscriptions, MUSICBOX, STREAMLY } from './testing/in-memory-subscriptions.js';

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

/** Hechos de suscripciones (add-subscriptions). */
const SUBSCRIPTION_FILES: Record<string, string> = {
  'commitments.SubscriptionPriceChanged': 'commitments/SubscriptionPriceChanged.v1.schema.json',
  'commitments.SubscriptionRenewalUpcoming': 'commitments/SubscriptionRenewalUpcoming.v1.schema.json',
  'commitments.SubscriptionTrialEnding': 'commitments/SubscriptionTrialEnding.v1.schema.json',
  'commitments.SubscriptionCancelled': 'commitments/SubscriptionCancelled.v1.schema.json',
};

/** Hecho de sugerencias de coincidencia (add-commitment-matching). */
const MATCHING_FILES: Record<string, string> = {
  'commitments.OccurrenceMatchSuggested': 'commitments/OccurrenceMatchSuggested.v1.schema.json',
};

function validators(files: Record<string, string> = FILES) {
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  addFormats(ajv);
  ajv.addSchema(load('envelope.v1.schema.json'));
  const out = new Map<string, ReturnType<Ajv2020['compile']>>();
  for (const [type, file] of Object.entries(files)) {
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

  it('cada hecho de suscripciones cumple su JSON Schema y los ejemplos son válidos', async () => {
    const mem = new InMemorySubscriptions();
    mem.setNow('2026-11-01T16:00:00Z');
    mem.rateTable.set('USD/BOB', '9.80');
    const deps = mem.subscriptionDeps();
    const subs = new SubscriptionsService(deps);
    const daily = new SubscriptionDailyService(deps);
    const base = {
      workspaceId: WS,
      userId: USER,
      price: { amount: '10.99', currency: 'USD' },
      billingCycle: { cadence: 'MONTHLY' },
      materialization: { mode: 'PENDING_APPROVAL', leadDays: 3 },
    };
    const streamly = await subs.create({
      ...base,
      counterpartyId: STREAMLY,
      name: 'Streamly',
      planName: 'Premium',
      paymentAccountId: CARD,
      firstRenewalOn: '2026-11-15',
    });
    await subs.create({
      ...base,
      counterpartyId: MUSICBOX,
      name: 'MusicBox',
      paymentAccountId: VISA_USD,
      firstRenewalOn: '2026-11-20',
      trialEndsOn: '2026-11-20',
    });
    const queries = new SubscriptionsQueries(deps);
    const ver = async (id: string) => (await queries.get(WS, id)).version;
    mem.setNow('2026-11-13T16:00:00Z');
    await daily.runWorkspace(WS);
    mem.setNow('2026-11-17T16:00:00Z');
    await daily.runWorkspace(WS);
    await subs.changePrice({
      workspaceId: WS,
      userId: USER,
      subscriptionId: streamly.id,
      expectedVersion: await ver(streamly.id),
      price: { amount: '12.99', currency: 'USD' },
      effectiveFrom: '2027-03-15',
    });
    // cancelación programada que ejecuta el job
    await subs.cancel({
      workspaceId: WS,
      userId: USER,
      subscriptionId: streamly.id,
      expectedVersion: await ver(streamly.id),
      effectiveOn: '2026-11-20',
      reason: 'ya no lo uso',
    });
    mem.setNow('2026-11-20T16:00:00Z');
    await daily.runWorkspace(WS);

    const check = validators(SUBSCRIPTION_FILES);
    const seen = new Set<string>();
    for (const event of mem.events.filter((e) => e.eventType.startsWith('commitments.Subscription'))) {
      const validate = check.get(event.eventType);
      expect(validate, event.eventType).toBeDefined();
      expect(validate?.(event.payload), `${event.eventType}: ${JSON.stringify(validate?.errors)}`).toBe(true);
      seen.add(event.eventType);
    }
    expect([...seen].sort()).toEqual([
      'commitments.SubscriptionCancelled',
      'commitments.SubscriptionPriceChanged',
      'commitments.SubscriptionRenewalUpcoming',
      'commitments.SubscriptionTrialEnding',
    ]);

    // Los ejemplos de cada schema cumplen el envelope completo y su payload.
    const ajv = new Ajv2020({ strict: true, allErrors: true });
    addFormats(ajv);
    ajv.addSchema(load('envelope.v1.schema.json'));
    for (const file of Object.values(SUBSCRIPTION_FILES)) {
      const schema = load(file);
      ajv.addSchema(schema);
      const validate = ajv.compile({ $ref: String(schema['$id']) });
      for (const example of schema['examples'] as unknown[]) {
        expect(validate(example), `${file}: ${JSON.stringify(validate.errors)}`).toBe(true);
      }
    }

    // Un campo extra o un enum desconocido no cumplen el contrato.
    const priceChanged = mem.eventsOf('commitments.SubscriptionPriceChanged')[0]!;
    const validate = check.get('commitments.SubscriptionPriceChanged')!;
    expect(validate({ ...priceChanged.payload, extra: 1 })).toBe(false);
    expect(validate({ ...priceChanged.payload, origin: 'MAGIC' })).toBe(false);
    expect(validate({ ...priceChanged.payload, changePercentage: '18.2' })).toBe(false);
  });

  it('[TC-COMMITMENTS-MATCH-016] OccurrenceMatchSuggested cumple su JSON Schema con montos como texto decimal', async () => {
    const mem = new InMemoryCommitments();
    mem.setNow('2026-10-19T16:00:00Z');
    const deps = mem.deps();
    const defs = new DefinitionsService(deps);
    const matching = new MatchingService(deps, new OccurrencesService(deps));
    const internet = await defs.create({
      workspaceId: WS,
      userId: USER,
      name: 'Internet',
      kind: 'EXPENSE',
      template: {
        accountId: BANK,
        amount: { type: 'FIXED', amount: { amount: '199.00', currency: 'BOB' } },
        categoryId: CATEGORY,
        schedule: { cadence: 'MONTHLY', startDate: '2026-10-20' },
        materialization: { mode: 'PENDING_APPROVAL', leadDays: 3 },
      },
    });
    await defs.create({
      workspaceId: WS,
      userId: USER,
      name: 'Compra mayorista',
      kind: 'EXPENSE',
      template: {
        accountId: BANK,
        amount: { type: 'VARIABLE' },
        categoryId: CATEGORY,
        counterpartyId: '0190a000-0000-7000-8000-0000000c1001',
        schedule: { cadence: 'MONTHLY', startDate: '2026-10-21' },
        materialization: { mode: 'PENDING_APPROVAL', leadDays: 3 },
      },
    });
    const tx = mem.addTransaction({
      kind: 'EXPENSE',
      accountId: BANK,
      amount: { amount: '199.00', currency: 'BOB' },
      businessDate: '2026-10-19',
    });
    const wholesale = mem.addTransaction({
      kind: 'EXPENSE',
      accountId: BANK,
      amount: { amount: '812.30', currency: 'BOB' },
      businessDate: '2026-10-21',
      counterpartyId: '0190a000-0000-7000-8000-0000000c1001',
      source: 'IMPORT',
    });
    await matching.onTransactionChanged({ workspaceId: WS, transactionId: tx, eventId: null });
    await matching.onTransactionChanged({ workspaceId: WS, transactionId: wholesale, eventId: null });

    const check = validators(MATCHING_FILES);
    const validate = check.get('commitments.OccurrenceMatchSuggested')!;
    const events = mem.eventsOf('commitments.OccurrenceMatchSuggested');
    expect(events).toHaveLength(2);
    for (const event of events) {
      expect(validate(event.payload), JSON.stringify(validate.errors)).toBe(true);
    }
    const [first, second] = events;
    expect(first?.payload).toMatchObject({
      occurrenceId: mem.forDefinition(internet.id)[0]!.id,
      transactionId: tx,
      score: '85.00',
      confidence: 'HIGH',
      amountDelta: { amount: '0.00', currency: 'BOB' },
      dateDeltaDays: 1,
      ambiguous: false,
      transactionOrigin: 'MANUAL',
    });
    // una ocurrencia VARIABLE no tiene diferencia de monto
    expect(second?.payload).toMatchObject({ amountDelta: null, transactionOrigin: 'IMPORT', score: '75.00' });

    // Los ejemplos del schema cumplen el envelope completo y su payload.
    const ajv = new Ajv2020({ strict: true, allErrors: true });
    addFormats(ajv);
    ajv.addSchema(load('envelope.v1.schema.json'));
    const schema = load(MATCHING_FILES['commitments.OccurrenceMatchSuggested'] as string);
    ajv.addSchema(schema);
    const full = ajv.compile({ $ref: String(schema['$id']) });
    for (const example of schema['examples'] as unknown[]) {
      expect(full(example), JSON.stringify(full.errors)).toBe(true);
    }

    // Un campo extra, un enum desconocido o un puntaje numérico no cumplen el contrato.
    const payload = first?.payload as object;
    expect(validate({ ...payload, extra: 1 })).toBe(false);
    expect(validate({ ...payload, confidence: 'CERTAIN' })).toBe(false);
    expect(validate({ ...payload, score: 85 })).toBe(false);
    expect(validate({ ...payload, score: '85.5' })).toBe(false);
    expect(validate({ ...payload, amountDelta: { amount: 0, currency: 'BOB' } })).toBe(false);
  });
});
