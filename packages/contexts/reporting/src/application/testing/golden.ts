import type { InMemoryReporting } from './in-memory.js';

/**
 * Escenario dorado del Home (cifras a mano de los TC de reporting; FixedClock 2026-09-30T18:00:00-04:00):
 * Banco BOB 685.00, Caja BOB 120.50, Wallet USDT 50.000000, Visa adeuda 400.00 BOB, Wallet BTC 0.01000000 sin tasa;
 * USDT/BOB 12.02 PARALLEL de paralelo.bo (21:53:07Z); USD/BOB 11.96 vigente el 10-sep.
 * Septiembre: salario 8000.00; Supermercado 1200.00; Restaurantes 300.00 − 200.00 (reembolso); fee de conversión
 * 5.00; Viajes 20.00 USD el 10-sep. Agosto: Supermercado 1200.00 el 12-ago.
 */
export function goldenScenario(mem: InMemoryReporting): void {
  mem.addAccount({ accountId: 'banco', name: 'Banco BOB', type: 'BANK', currency: 'BOB' }, '685.00');
  mem.addAccount({ accountId: 'caja', name: 'Caja BOB', type: 'CASH', currency: 'BOB' }, '120.50');
  mem.addAccount(
    { accountId: 'wallet', name: 'Wallet USDT', type: 'CRYPTO_WALLET', currency: 'USDT' },
    '50.000000',
  );
  mem.addAccount({ accountId: 'visa', name: 'Visa', type: 'CREDIT_CARD', currency: 'BOB' }, '400.00');
  mem.addAccount(
    { accountId: 'btc', name: 'Wallet BTC', type: 'CRYPTO_WALLET', currency: 'BTC' },
    '0.01000000',
  );
  mem.rates.push(
    { base: 'USDT', quote: 'BOB', value: '12.02', asOf: '2026-09-30T21:53:07Z', fxRateId: 'r-usdt' },
    { base: 'USD', quote: 'BOB', value: '11.96', asOf: '2026-09-10T20:00:00Z', fxRateId: 'r-usd' },
  );
  const cat = (
    categoryId: string,
    name: string,
    kind: 'INCOME' | 'EXPENSE',
    systemCode: string | null = null,
  ) => mem.categories.push({ categoryId, name, kind, parentId: null, systemCode, archived: false });
  cat('sal', 'Salario', 'INCOME');
  cat('sup', 'Supermercado', 'EXPENSE');
  cat('res', 'Restaurantes', 'EXPENSE');
  cat('via', 'Viajes', 'EXPENSE');
  cat('fee', 'Fees', 'EXPENSE', 'FEES');
  mem.flow('2026-08-12', 'EXPENSE', 'sup', '1200.00');
  mem.flow('2026-09-05', 'INCOME', 'sal', '8000.00');
  mem.flow('2026-09-08', 'EXPENSE', 'sup', '1200.00');
  mem.flow('2026-09-09', 'EXPENSE', 'res', '300.00');
  mem.flow('2026-09-10', 'EXPENSE', 'via', '20.00', 'USD');
  mem.flow('2026-09-20', 'EXPENSE', 'res', '-200.00');
  mem.flow('2026-09-30', 'EXPENSE', 'fee', '5.00');
}
