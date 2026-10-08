import type { Pool, PoolClient } from 'pg';
import { describe, expect, it } from 'vitest';
import { PgCommandTransaction, PgUnitOfWork, isRetryableConflict } from './command-transaction.js';

// Aislamiento SERIALIZABLE con reintento acotado (`x-isolation`, openspec add-reconciliation; docs/08 §11): la
// transacción del comando se abre con `BEGIN ISOLATION LEVEL SERIALIZABLE`, un conflicto (40001/40P01) descarta los
// efectos y reintenta con una transacción nueva, y cualquier otro error o agotar los intentos se propaga. Sin la opción,
// READ COMMITTED y sin reintentos (comportamiento previo).
function fakePool() {
  const log: string[] = [];
  let clients = 0;
  const pool = {
    async connect() {
      clients += 1;
      const id = clients;
      return {
        async query(sql: string) {
          log.push(`${id}:${sql.split(/\s+/).slice(0, 4).join(' ')}`);
          return { rows: [], rowCount: 0 };
        },
        release() {
          log.push(`${id}:release`);
        },
      } as unknown as PoolClient;
    },
  } as unknown as Pool;
  return { pool, log };
}

const conflict = () => Object.assign(new Error('could not serialize access'), { code: '40001' });
const scope = { userId: 'u', workspaceId: 'w' };

describe('Transacción del comando con aislamiento (x-isolation)', () => {
  it('[TC-TRANSACTIONS-RECONCILIATION-006] SERIALIZABLE: abre con el nivel pedido y reintenta ante un fallo de serialización', async () => {
    const { pool, log } = fakePool();
    let calls = 0;
    const result = await new PgCommandTransaction(pool).run(
      scope,
      async () => {
        calls += 1;
        if (calls < 3) throw conflict();
        return 'ok';
      },
      { isolation: 'SERIALIZABLE' },
    );
    expect(result).toBe('ok');
    expect(calls).toBe(3);
    const begins = log.filter((l) => l.includes('BEGIN'));
    expect(begins).toHaveLength(3);
    expect(begins.every((l) => l.endsWith('BEGIN ISOLATION LEVEL SERIALIZABLE'))).toBe(true);
    // Cada intento revierte (efectos descartados) y libera su conexión; solo el último confirma.
    expect(log.filter((l) => l.endsWith('ROLLBACK'))).toHaveLength(2);
    expect(log.filter((l) => l.endsWith('COMMIT'))).toHaveLength(1);
  });

  it('agotar los intentos propaga el conflicto; un error que no es de serialización no se reintenta', async () => {
    const a = fakePool();
    let calls = 0;
    await expect(
      new PgCommandTransaction(a.pool).run(
        scope,
        async () => {
          calls += 1;
          throw conflict();
        },
        { isolation: 'SERIALIZABLE', attempts: 2 },
      ),
    ).rejects.toMatchObject({ code: '40001' });
    expect(calls).toBe(2);

    const b = fakePool();
    calls = 0;
    await expect(
      new PgCommandTransaction(b.pool).run(
        scope,
        async () => {
          calls += 1;
          throw new Error('boom');
        },
        { isolation: 'SERIALIZABLE' },
      ),
    ).rejects.toThrow('boom');
    expect(calls).toBe(1);
  });

  it('sin la opción: BEGIN simple (READ COMMITTED) y un conflicto no se reintenta', async () => {
    const { pool, log } = fakePool();
    let calls = 0;
    await expect(
      new PgCommandTransaction(pool).run(scope, async () => {
        calls += 1;
        throw conflict();
      }),
    ).rejects.toMatchObject({ code: '40001' });
    expect(calls).toBe(1);
    expect(log.find((l) => l.includes('BEGIN'))).toMatch(/:BEGIN$/);
  });

  it('la unidad de trabajo sin transacción previa abre SERIALIZABLE y reintenta; dentro de una transacción en curso la reutiliza', async () => {
    const { pool, log } = fakePool();
    const uow = new PgUnitOfWork(pool);
    let calls = 0;
    const out = await uow.run(
      scope,
      async () => {
        calls += 1;
        if (calls === 1) throw conflict();
        // Anidada: reutiliza la transacción abierta (no abre otra ni cambia su aislamiento).
        return uow.run(scope, async () => 'nested', { isolation: 'SERIALIZABLE' });
      },
      { isolation: 'SERIALIZABLE' },
    );
    expect(out).toBe('nested');
    expect(log.filter((l) => l.includes('BEGIN ISOLATION LEVEL SERIALIZABLE'))).toHaveLength(2);
    expect(log.filter((l) => l.endsWith('COMMIT'))).toHaveLength(1);
  });

  it('isRetryableConflict reconoce serialización y deadlock', () => {
    expect(isRetryableConflict({ code: '40001' })).toBe(true);
    expect(isRetryableConflict({ code: '40P01' })).toBe(true);
    expect(isRetryableConflict({ code: '23505' })).toBe(false);
    expect(isRetryableConflict(null)).toBe(false);
  });
});
