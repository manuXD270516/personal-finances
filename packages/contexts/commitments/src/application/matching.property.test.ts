import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { DefinitionsService } from './definitions.service.js';
import { MatchingService } from './matching.service.js';
import { OccurrencesService } from './occurrences.service.js';
import { BANK, CASH, CATEGORY, InMemoryCommitments, USER, WS } from './testing/in-memory.js';

const bob = (amount: string) => ({ amount, currency: 'BOB' });
const noon = (date: string) => `${date}T16:00:00Z`;
const SLOTS = 4;

type Op =
  | { t: 'create'; slot: number; units: number; day: number; account: boolean }
  | { t: 'edit'; slot: number; units: number; day: number; account: boolean }
  | { t: 'void'; slot: number }
  | { t: 'redeliver'; slot: number }
  | { t: 'backfill' }
  | { t: 'dismiss'; pick: number };

const slot = fc.integer({ min: 0, max: SLOTS - 1 });
const units = fc.integer({ min: 95, max: 230 });
const day = fc.integer({ min: 12, max: 30 });
const opArb: fc.Arbitrary<Op> = fc.oneof(
  fc.record({ t: fc.constant('create' as const), slot, units, day, account: fc.boolean() }),
  fc.record({ t: fc.constant('edit' as const), slot, units, day, account: fc.boolean() }),
  fc.record({ t: fc.constant('void' as const), slot }),
  fc.record({ t: fc.constant('redeliver' as const), slot }),
  fc.record({ t: fc.constant('backfill' as const) }),
  fc.record({ t: fc.constant('dismiss' as const), pick: fc.nat(20) }),
);

const date = (d: number) => `2026-10-${String(d).padStart(2, '0')}`;

async function harness() {
  const mem = new InMemoryCommitments();
  const deps = mem.deps();
  const defs = new DefinitionsService(deps);
  const occs = new OccurrencesService(deps);
  const matching = new MatchingService(deps, occs);
  mem.setNow(noon('2026-10-19'));
  for (const [name, amt, start, type] of [
    ['Internet', '199.00', '2026-10-20', 'FIXED'],
    ['Luz', '150.00', '2026-10-22', 'ESTIMATED'],
    ['Gimnasio', '120.00', '2026-10-25', 'FIXED'],
  ] as const) {
    await defs.create({
      workspaceId: WS,
      userId: USER,
      name,
      kind: 'EXPENSE',
      template: {
        accountId: BANK,
        amount: { type, amount: bob(amt) },
        categoryId: CATEGORY,
        schedule: { cadence: 'MONTHLY', interval: 1, startDate: start },
        materialization: { mode: 'PENDING_APPROVAL', leadDays: 3 },
      },
    });
  }
  return { mem, matching };
}

describe('Propiedad: el matching nunca vincula sin confirmación (FR-COMMITMENTS-010)', () => {
  it(
    '[TC-COMMITMENTS-MATCH-014] ninguna secuencia de hechos resuelve ocurrencias, revive pares descartados o duplica pares',
    { timeout: 600_000 },
    async () => {
      let proposedSeen = 0;
      let dismissedSeen = 0;
      await fc.assert(
        fc.asyncProperty(fc.array(opArb, { minLength: 1, maxLength: 25 }), async (ops) => {
          const { mem, matching } = await harness();
          const txBySlot = new Map<number, string>();
          const occurrenceIds = mem.all().map((o) => o.id);
          const dismissed = new Set<string>();
          let eventSeq = 0;
          const eventId = () =>
            `0190a000-0000-7000-8000-${String(700_000 + (eventSeq += 1)).padStart(12, '0')}`;
          const deliver = async (id: string) =>
            matching.onTransactionChanged({ workspaceId: WS, transactionId: id, eventId: eventId() });

          for (const op of ops) {
            const before = JSON.stringify(mem.all());
            const decided = op.t === 'dismiss';
            if (op.t === 'create') {
              if (txBySlot.has(op.slot)) continue;
              const id = mem.addTransaction({
                kind: 'EXPENSE',
                accountId: op.account ? CASH : BANK,
                amount: bob(`${op.units}.00`),
                businessDate: date(op.day),
                source: op.slot % 2 === 0 ? 'IMPORT' : 'MANUAL',
              });
              txBySlot.set(op.slot, id);
              await deliver(id);
            } else if (op.t === 'edit') {
              const id = txBySlot.get(op.slot);
              if (!id) continue;
              const t = mem.transactionsStore.get(id)!;
              mem.transactionsStore.set(id, {
                ...t,
                accountId: op.account ? CASH : BANK,
                amount: bob(`${op.units}.00`),
                businessDate: date(op.day),
              });
              await deliver(id);
            } else if (op.t === 'void') {
              const id = txBySlot.get(op.slot);
              if (!id) continue;
              mem.voidTransaction(id);
              await matching.onTransactionVoided({ workspaceId: WS, transactionId: id });
            } else if (op.t === 'redeliver') {
              const id = txBySlot.get(op.slot);
              if (id) await deliver(id);
            } else if (op.t === 'backfill') {
              await matching.onOccurrencesAvailable({
                workspaceId: WS,
                occurrenceIds: occurrenceIds,
                eventId: eventId(),
              });
            } else {
              const proposed = mem.suggestions().filter((s) => s.status === 'PROPOSED');
              const target = proposed[op.pick % Math.max(proposed.length, 1)];
              if (!target) continue;
              await matching.dismiss({ workspaceId: WS, userId: USER, suggestionId: target.id });
              dismissed.add(target.id);
            }
            // El matcher jamás cambia el estado de una ocurrencia ni vincula una transacción.
            if (!decided) expect(JSON.stringify(mem.all())).toBe(before);
            expect(mem.eventsOf('commitments.RecurringOccurrenceMaterialized')).toEqual([]);
            expect(mem.all().every((o) => o.transactionId === null && o.matchedBy === null)).toBe(true);
            // Un par descartado nunca vuelve a PROPOSED; a lo sumo una sugerencia por par.
            const states = mem.suggestions();
            proposedSeen = Math.max(proposedSeen, states.length);
            dismissedSeen = Math.max(dismissedSeen, dismissed.size);
            for (const id of dismissed) expect(states.find((s) => s.id === id)?.status).toBe('DISMISSED');
            const pairs = states.map((s) => `${s.occurrenceId}|${s.transactionId}`);
            expect(new Set(pairs).size).toBe(pairs.length);
            // Toda PROPOSED es del tipo y la moneda de su ocurrencia y apunta a una transacción no anulada.
            for (const s of states.filter((x) => x.status === 'PROPOSED')) {
              const tx = mem.transactionsStore.get(s.transactionId);
              expect(tx?.status).not.toBe('VOIDED');
              expect(tx?.accountId).toBe(BANK);
            }
          }
        }),
        { numRuns: process.env['NIGHTLY'] ? 10_000 : 100 },
      );
      // La propiedad no es vacía: los generadores sí producen sugerencias y descartes.
      expect(proposedSeen).toBeGreaterThan(0);
      expect(dismissedSeen).toBeGreaterThan(0);
    },
  );
});
