// Sondas de type-safety (solo `pnpm typecheck`, nunca se ejecutan).
// Cada @ts-expect-error DEBE producir error de compilación; si el compilador lo acepta, tsc falla.
import { Kysely } from 'kysely';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { DB } from '../kysely/db.generated.js';
import { postingInLedger } from '../drizzle/schema.js';
import { PrismaClient } from '../prisma/generated/client.ts';

declare const k: Kysely<DB>;
declare const d: ReturnType<typeof drizzle>;
declare const p: InstanceType<typeof PrismaClient>;
const base = {
  id: 'x', workspace_id: 'w', journal_entry_id: 'j', entry_date: '2026-10-01', line_no: 1,
  ledger_account_id: 'a', account_type: 'ASSET', currency: 'BOB', split_id: null,
};

export async function probes() {
  // --- Kysely (tipos generados por kysely-codegen + override de amount) ---
  // @ts-expect-error amount como number rechazado (override ColumnType<string,string,never>)
  await k.insertInto('ledger.posting').values({ ...base, amount: 685.0 }).execute();
  // @ts-expect-error amount no es actualizable a nivel de tipos
  await k.updateTable('ledger.posting').set({ amount: '1' }).execute();
  // @ts-expect-error columna inexistente
  await k.selectFrom('ledger.posting').select('amout').execute();
  const kRow = await k.selectFrom('ledger.posting').select(['amount', 'entry_date']).executeTakeFirstOrThrow();
  const kAmount: string = kRow.amount; // string
  const kDate: string = kRow.entry_date; // string (--date-parser string)

  // --- Drizzle (schema TS de drizzle-kit pull; numeric mode 'string' por defecto) ---
  // @ts-expect-error amount como number rechazado
  await d.insert(postingInLedger).values({ id: 'x', workspaceId: 'w', journalEntryId: 'j', entryDate: '2026-10-01', lineNo: 1, ledgerAccountId: 'a', accountType: 'ASSET', currency: 'BOB', amount: 685.0 });
  // Nota: UPDATE de amount compila (no hay forma declarativa de marcarlo inmutable)
  await d.update(postingInLedger).set({ amount: '1' });
  const [dRow] = await d.select({ amount: postingInLedger.amount }).from(postingInLedger);
  const dAmount: string = dRow!.amount;

  // --- Prisma 7 (client generado de prisma db pull) ---
  // SIN error: Prisma acepta number para Decimal -> float puede colarse en escrituras
  await p.posting.create({ data: { ...base, entry_date: new Date(), amount: 685.1 } });
  // SIN error: UPDATE de amount compila
  await p.posting.update({ where: { id: 'x' }, data: { amount: '1' } });
  const pRow = await p.posting.findFirstOrThrow({ select: { amount: true, entry_date: true } });
  // @ts-expect-error amount es Prisma.Decimal, no string: el tipo del ORM llega al mapper
  const pAmount: string = pRow.amount;
  const pDate: Date = pRow.entry_date; // Date (medianoche UTC) para una columna DATE

  return { kAmount, kDate, dAmount, pAmount, pDate };
}
