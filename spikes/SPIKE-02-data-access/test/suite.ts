import { Decimal } from 'decimal.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  describeError,
  errorChainIncludes,
  EXTREME_AMOUNTS,
  extremeAmountsEntry,
  seedWorkspace,
  usdtToBobConversion,
  type LedgerRepo,
  type WorkspaceFixture,
} from '../src/shared/scenario.js';

const BENCH_N = Number(process.env.BENCH_N ?? 1000);
const log = (tool: string, msg: string) => console.log(`[${tool}] ${msg}`);

/** Mismo contrato de pruebas para las tres herramientas. */
export function ledgerSuite(tool: string, makeRepo: (opts?: { max?: number }) => LedgerRepo) {
  describe(`${tool}: ledger + RLS + NUMERIC sobre PostgreSQL 18`, () => {
    let repo: LedgerRepo;
    let w1: WorkspaceFixture;
    let w2: WorkspaceFixture;
    let w2EntryId: string;

    beforeAll(async () => {
      repo = makeRepo();
      w1 = await seedWorkspace(`${tool}-W1`);
      w2 = await seedWorkspace(`${tool}-W2`);
      const e2 = usdtToBobConversion(w2);
      await repo.postEntry(w2.ws, e2);
      w2EntryId = e2.id;
    });
    afterAll(async () => repo.close());

    it('(a) inserta en una transacción la conversión USDT→BOB balanceada (SET LOCAL app.workspace_id)', async () => {
      const entry = usdtToBobConversion(w1);
      await repo.postEntry(w1.ws, entry);
      const rows = await repo.readEntryPostings(w1.ws, entry.id);
      expect(rows.map((r) => [r.lineNo, r.currency, new Decimal(r.amount).toFixed()])).toEqual([
        [1, 'USDT', '-100'],
        [2, 'USDT', '100'],
        [3, 'BOB', '-690'],
        [4, 'BOB', '685'],
        [5, 'BOB', '5'],
      ]);
      const sums = await repo.sumByCurrency(w1.ws, entry.id);
      expect(new Decimal(sums.USDT!).isZero()).toBe(true);
      expect(new Decimal(sums.BOB!).isZero()).toBe(true);
      log(tool, `(a) OK 5 postings; sums=${JSON.stringify(sums)}`);
    });

    it('(b) entry desbalanceada: los INSERT pasan y el constraint trigger diferido falla en COMMIT', async () => {
      const entry = usdtToBobConversion(w1, '4.00'); // BOB suma -1.00
      let insertsDone = false;
      let err: unknown;
      try {
        await repo.postEntry(w1.ws, entry, { afterInserts: () => (insertsDone = true) });
      } catch (e) {
        err = e;
      }
      expect(insertsDone).toBe(true); // ningún INSERT falló: el error vino en COMMIT
      expect(err).toBeDefined();
      expect(errorChainIncludes(err, 'LEDGER_UNBALANCED_ENTRY')).toBe(true);
      const sqlstateVisible = errorChainIncludes(err, 'PF001');
      log(tool, `(b) error en COMMIT: ${describeError(err)} | SQLSTATE PF001 accesible=${sqlstateVisible}`);
      expect(await repo.readEntryPostings(w1.ws, entry.id)).toEqual([]); // rollback completo
    });

    it('(c) round-trip exacto de NUMERIC(38,18) como string (sin float)', async () => {
      const entry = extremeAmountsEntry(w1);
      await repo.postEntry(w1.ws, entry);
      const rows = await repo.readEntryPostings(w1.ws, entry.id);
      expect(rows).toHaveLength(EXTREME_AMOUNTS.length * 2);
      EXTREME_AMOUNTS.forEach((a, i) => {
        const pos = rows[i * 2]!;
        const neg = rows[i * 2 + 1]!;
        expect(pos.amount).toBe(new Decimal(a).toFixed(18));
        expect(neg.amount).toBe(new Decimal(a).neg().toFixed(18));
        expect(new Decimal(pos.amount).eq(new Decimal(a))).toBe(true);
      });
      const sums = await repo.sumByCurrency(w1.ws, entry.id);
      expect(new Decimal(sums.ETH!).isZero()).toBe(true);
      log(tool, `(c) tipo runtime de amount=${rows[0]!.rawAmountType}; leído=${rows.map((r) => r.amount).filter((_, i) => i % 2 === 0).join(' | ')}`);
    });

    it('(d1) RLS: repo SIN filtro por workspace solo ve filas del workspace del contexto', async () => {
      const visible = await repo.listAllPostingsUnfiltered(w1.ws);
      expect(visible.length).toBeGreaterThan(0);
      expect(new Set(visible.map((r) => r.workspaceId))).toEqual(new Set([w1.ws]));
      expect(await repo.readEntryPostings(w1.ws, w2EntryId)).toEqual([]); // entry de W2 invisible desde W1
      expect((await repo.readEntryPostings(w2.ws, w2EntryId)).length).toBe(5);
      log(tool, `(d1) W1 ve ${visible.length} postings propios; entry de W2 -> 0 filas`);
    });

    it('(d2) RLS fail-closed: sin contexto (conexión nueva) la query falla', async () => {
      const fresh = makeRepo({ max: 1 });
      try {
        const err = await fresh.listAllPostingsWithoutContext().then(
          () => undefined,
          (e: unknown) => e,
        );
        expect(errorChainIncludes(err, 'unrecognized configuration parameter "app.workspace_id"')).toBe(true);
        log(tool, `(d2) sin contexto, conexión nueva: ${describeError(err)}`);
      } finally {
        await fresh.close();
      }
    });

    it('(d3) pool safety: una conexión reutilizada tras SET LOCAL no hereda el workspace', async () => {
      const single = makeRepo({ max: 1 });
      try {
        await single.postEntry(w1.ws, usdtToBobConversion(w1));
        const err = await single.listAllPostingsWithoutContext().then(
          () => undefined,
          (e: unknown) => e,
        );
        expect(err).toBeDefined();
        expect(errorChainIncludes(err, 'invalid input syntax for type uuid')).toBe(true);
        log(tool, `(d3) misma conexión, sin contexto tras tx previa: ${describeError(err)}`);
      } finally {
        await single.close();
      }
    });

    it('(d4) concurrencia: 40 tx en paralelo (pool=4) alternando W1/W2 sin fuga de contexto', async () => {
      const results = await Promise.all(
        Array.from({ length: 40 }, (_, i) => {
          const ws = i % 2 === 0 ? w1.ws : w2.ws;
          return repo.probeContext(ws).then((r) => ({ ws, ...r }));
        }),
      );
      for (const r of results) {
        expect(r.setting).toBe(r.ws);
        expect(r.visibleWorkspaces).toEqual([r.ws]);
      }
      log(tool, `(d4) 40/40 transacciones vieron solo su workspace`);
    });

    it('(e) pf_app no puede UPDATE ni DELETE de un posting', async () => {
      const entry = usdtToBobConversion(w1);
      await repo.postEntry(w1.ws, entry);
      const target = entry.postings[3]!;
      const upd = await repo.updatePostingAmount(w1.ws, target.id, '999.00').then(
        () => undefined,
        (e: unknown) => e,
      );
      const del = await repo.deletePosting(w1.ws, target.id).then(
        () => undefined,
        (e: unknown) => e,
      );
      expect(errorChainIncludes(upd, 'permission denied for table posting')).toBe(true);
      expect(errorChainIncludes(del, 'permission denied for table posting')).toBe(true);
      const after = await repo.readEntryPostings(w1.ws, entry.id);
      expect(after.find((r) => r.id === target.id)!.amount).toBe(new Decimal('685').toFixed(18));
      log(tool, `(e) UPDATE: ${describeError(upd)}`);
      log(tool, `(e) DELETE: ${describeError(del)}`);
    });

    it(`(bench) ${BENCH_N} entries de 5 postings, una tx por entry`, { timeout: 600_000 }, async () => {
      const entries = Array.from({ length: BENCH_N }, () => usdtToBobConversion(w2));
      const t0 = performance.now();
      for (const e of entries) await repo.postEntry(w2.ws, e);
      const ms = performance.now() - t0;
      log(tool, `(bench) ${BENCH_N} entries en ${ms.toFixed(0)} ms -> ${(ms / BENCH_N).toFixed(2)} ms/entry`);
    });
  });
}
