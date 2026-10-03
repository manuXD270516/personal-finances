import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ACCOUNT_TYPES, type Account, type Institution } from '../common/types';
import { esContext, textOf } from '../test-support';
import { AccountsListView } from './AccountsListView';
import {
  accountsQuery,
  defaultLiquidity,
  EMPTY_ACCOUNT_FILTERS,
  groupAccounts,
  lastFourOf,
  maskedIdentifier,
  natureOf,
} from './logic';

const f = esContext('Accounts');
const id = (n: number) => `0190a000-0000-7000-8000-0000000000${String(n).padStart(2, '0')}`;
const account = (over: Partial<Account>): Account => ({
  id: id(1),
  name: 'Bank A',
  type: 'BANK',
  classification: 'ASSET',
  status: 'ACTIVE',
  liquidity: 'LIQUID',
  currency: 'BOB',
  balance: { amount: '1000.00', currency: 'BOB' },
  baseCurrencyBalance: null,
  includeInNetWorth: true,
  version: 1,
  createdAt: '2026-03-01T12:00:00Z',
  ...over,
});

const ACCOUNTS: Account[] = [
  account({ id: id(1), name: 'Bank A', accountNumberLast4: '6789' }),
  account({
    id: id(2),
    name: 'USD Savings',
    type: 'SAVINGS',
    currency: 'USD',
    institutionId: id(90),
    balance: { amount: '500.00', currency: 'USD' },
    baseCurrencyBalance: {
      amount: { amount: '3480.00', currency: 'BOB' },
      rateDate: '2026-03-14',
      rateSource: 'MANUAL',
      fxRateId: id(80),
    },
  }),
  account({
    id: id(3),
    name: 'Wallet USDT',
    type: 'CRYPTO_WALLET',
    currency: 'USDT',
    balance: { amount: '50.000000', currency: 'USDT' },
  }),
  account({
    id: id(4),
    name: 'Credit Card',
    type: 'CREDIT_CARD',
    classification: 'LIABILITY',
    liquidity: 'ILLIQUID',
    balance: { amount: '350.00', currency: 'BOB' },
  }),
  account({
    id: id(5),
    name: 'Caja vieja',
    type: 'CASH',
    status: 'CLOSED',
    balance: { amount: '0.00', currency: 'BOB' },
  }),
];
const INSTITUTIONS = new Map<string, Institution>([
  [id(90), { id: id(90), name: 'Banco Demo', kind: 'BANK', version: 1 }],
]);
const render = (groupBy: 'type' | 'institution' | 'none' = 'type', accounts = ACCOUNTS) =>
  renderToStaticMarkup(
    <AccountsListView
      accounts={accounts}
      institutions={INSTITUTIONS}
      groupBy={groupBy}
      baseCurrency="BOB"
      ctx={f}
      href={(p) => p}
    />,
  );
const row = (html: string, name: string) => {
  const m = new RegExp(`<li data-testid="account-row"[^>]*>(?:(?!</li>).)*${name}[\\s\\S]*?</li>`).exec(html);
  if (!m) throw new Error(`sin fila ${name}`);
  return m[0];
};

describe('pantalla Cuentas (add-accounts-management 7.1)', () => {
  it('[TC-ACCOUNTS-LIST-001] saldo en su moneda y equivalente en BOB con fecha y fuente de la tasa; sin tasa lo dice sin inventar', () => {
    const html = render();
    const usd = textOf(row(html, 'USD Savings'));
    expect(usd).toContain('500,00 USD');
    expect(usd).toMatch(/≈ 3\.480,00 BOB · tasa del 14[^·]*mar[^·]*2026 · manual/);
    const usdt = row(html, 'Wallet USDT');
    expect(usdt).toContain('data-testid="account-no-rate"');
    expect(textOf(usdt)).toContain('Sin tasa a BOB: equivalente no disponible');
    expect(textOf(usdt)).not.toContain('≈');
    // Cuentas en la moneda base: sin línea de equivalente.
    expect(row(html, 'Bank A')).not.toContain('account-no-rate');
  });

  it('sin baseCurrencyBalance usa la valoración del resumen (misma tasa del Home) con su fecha y fuente', () => {
    const html = renderToStaticMarkup(
      <AccountsListView
        accounts={ACCOUNTS}
        institutions={INSTITUTIONS}
        groupBy="none"
        baseCurrency="BOB"
        ctx={f}
        href={(p) => p}
        valuations={
          new Map([
            [
              id(3),
              {
                converted: { amount: '601.00', currency: 'BOB' },
                rate: {
                  rate: { base: 'USDT', quote: 'BOB', value: '12.02' },
                  derivation: 'DIRECT',
                  rateType: 'PARALLEL',
                  source: 'MANUAL',
                  asOf: '2026-10-01T02:30:00Z',
                  ageDays: 0,
                  approx: false,
                },
              },
            ],
          ])
        }
      />,
    );
    // 2026-10-01T02:30Z es el 30/09 en La Paz.
    expect(textOf(row(html, 'Wallet USDT'))).toMatch(/≈ 601,00 BOB · tasa del 30[^·]*sept[^·]*2026 · manual/);
  });

  it('los pasivos se muestran como "Adeuda" (positivo) y un saldo a favor no se muestra negativo', () => {
    const html = render();
    expect(textOf(row(html, 'Credit Card'))).toContain('Adeuda 350,00 BOB');
    const inFavor = render('none', [
      account({
        id: id(6),
        name: 'Visa',
        type: 'CREDIT_CARD',
        classification: 'LIABILITY',
        balance: { amount: '-50.00', currency: 'BOB' },
      }),
    ]);
    expect(textOf(inFavor)).toContain('Saldo a favor 50,00 BOB');
    expect(textOf(inFavor)).not.toContain('-50,00');
  });

  it('[TC-ACCOUNTS-MASK-001] el identificador se muestra solo como •••• y sus últimos 4 caracteres', () => {
    const bank = row(render(), 'Bank A');
    expect(bank).toContain(
      '<span data-testid="account-mask" aria-label="Identificador terminado en 6789">•••• 6789</span>',
    );
    expect(lastFourOf('DEMO-000123456789')).toBe('6789');
    expect(lastFourOf(' 12-3 ')).toBeNull();
    expect(maskedIdentifier('6789')).toBe('•••• 6789');
    expect(maskedIdentifier(null)).toBeNull();
  });

  it('agrupa por tipo o por institución conservando el orden manual; estado no activo como texto', () => {
    const byType = render();
    expect(byType.match(/data-testid="account-group"/g)).toHaveLength(5);
    expect(byType).toMatch(/<h2 id="account-group-CREDIT_CARD"[^>]*>Tarjeta de crédito<\/h2>/);
    const byInstitution = render('institution');
    expect(textOf(byInstitution)).toContain('Banco Demo');
    expect(textOf(byInstitution)).toContain('Sin institución');
    expect(row(byType, 'Caja vieja')).toContain('<span data-testid="account-status" data-status="CLOSED"');
    expect(textOf(row(byType, 'Caja vieja'))).toContain('Cerrada');
    expect(render('none', [])).toContain('No hay cuentas con estos filtros.');
    const groups = groupAccounts(ACCOUNTS, 'institution', {
      type: (t) => t,
      institutions: INSTITUTIONS,
      noInstitution: '—',
      all: 'Todas',
    });
    expect(groups.map((g) => [g.label, g.accounts.map((a) => a.name)])).toEqual([
      ['—', ['Bank A', 'Wallet USDT', 'Credit Card', 'Caja vieja']],
      ['Banco Demo', ['USD Savings']],
    ]);
  });

  it('[TC-ACCOUNTS-LIQUIDITY-001] liquidez por defecto según el tipo y naturaleza derivada', () => {
    const expected = {
      BANK: 'LIQUID',
      CASH: 'LIQUID',
      DIGITAL_WALLET: 'LIQUID',
      CRYPTO_WALLET: 'LIQUID',
      SAVINGS: 'LIQUID',
      INVESTMENT: 'SEMI_LIQUID',
      VIRTUAL: 'ILLIQUID',
      MANUAL_ASSET: 'ILLIQUID',
      CREDIT_CARD: 'ILLIQUID',
      LOAN: 'ILLIQUID',
      MANUAL_LIABILITY: 'ILLIQUID',
    } as const;
    for (const type of ACCOUNT_TYPES) expect(defaultLiquidity(type)).toBe(expected[type]);
    expect(ACCOUNT_TYPES.filter((t) => natureOf(t) === 'LIABILITY')).toEqual([
      'CREDIT_CARD',
      'LOAN',
      'MANUAL_LIABILITY',
    ]);
  });

  it('archivadas ocultas por defecto: solo "mostrar archivadas" agrega includeArchived', () => {
    expect(accountsQuery(EMPTY_ACCOUNT_FILTERS).toString()).toBe('limit=200');
    expect(
      accountsQuery({
        ...EMPTY_ACCOUNT_FILTERS,
        type: 'BANK',
        currency: 'USD',
        includeArchived: true,
      }).toString(),
    ).toBe('type=BANK&currency=USD&includeArchived=true&limit=200');
  });
});
