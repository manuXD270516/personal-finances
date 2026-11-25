import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { WorkspaceContext } from '../../common/workspace';
import { esContext, textOf } from '../../test-support';
import { CardChargeView } from './CardChargeTransaction';
import { ChargeFormPanel } from './CardCharges';
import {
  buildChargeInput,
  chargeTotal,
  emptyChargeForm,
  parseChargeComponents,
  possibleDuplicates,
} from './charges-logic';
import { card } from './fixtures';

const f = esContext('Cards');
const opts = { locale: 'es-BO', scales: { BOB: 2, USD: 2 } };
const form = (over: Record<string, string> = {}) => ({ ...emptyChargeForm('2026-10-25'), ...over });

describe('formulario de cargos de la tarjeta (lógica)', () => {
  it('[TC-DEBT-CARD-043] arma el cuerpo con la fecha y solo los componentes positivos (coma decimal de es-BO)', () => {
    const built = buildChargeInput(form({ interest: '4,00', insurance: '0,80' }), {
      ...opts,
      accountId: 'acc-bob',
      currency: 'BOB',
    });
    expect(built).toEqual({
      ok: true,
      input: { accountId: 'acc-bob', businessDate: '2026-10-25', interest: '4.00', insurance: '0.80' },
    });
  });

  it('[TC-DEBT-CARD-043] el total en vivo suma los componentes sin redondear: 4,00 + 0,80 = 4.80', () => {
    expect(
      chargeTotal(form({ interest: '4.00', insurance: '0.80' }), 'BOB', { ...opts, locale: 'en-US' }),
    ).toEqual({
      amount: '4.80',
      currency: 'BOB',
    });
    expect(chargeTotal(form({ interest: 'abc' }), 'BOB', opts)).toBeNull();
    expect(chargeTotal(form(), 'BOB', opts)).toEqual({ amount: '0.00', currency: 'BOB' });
  });

  it('[TC-DEBT-CARD-045] sin componentes positivos, con un negativo o sin fecha no se envía', () => {
    const base = { ...opts, accountId: 'acc-bob', currency: 'BOB' };
    expect(buildChargeInput(form({ interest: '0,00' }), base)).toEqual({
      ok: false,
      errors: { form: 'NO_COMPONENT' },
    });
    expect(buildChargeInput(form({ interest: '4,00', fees: '-1' }), base)).toEqual({
      ok: false,
      errors: { fees: 'NEGATIVE' },
    });
    expect(buildChargeInput(form({ interest: '4,00', businessDate: '' }), base)).toEqual({
      ok: false,
      errors: { businessDate: 'REQUIRED_DATE' },
    });
  });

  it('[TC-DEBT-CARD-046] más decimales que la moneda se rechaza sin redondear', () => {
    const parsed = parseChargeComponents(form({ interest: '1,255' }), 'USD', opts);
    expect(parsed).toEqual({ ok: false, errors: { interest: 'SCALE' } });
  });

  it('[TC-DEBT-CARD-051] la adopción envía el gasto y no la fecha', () => {
    const built = buildChargeInput(form({ interest: '4,80' }), {
      ...opts,
      accountId: 'acc-bob',
      currency: 'BOB',
      adoptTransactionId: 'tx-1',
    });
    expect(built).toEqual({
      ok: true,
      input: { accountId: 'acc-bob', adoptTransactionId: 'tx-1', interest: '4.80' },
    });
  });

  it('avisa de un posible doble registro solo con gastos sin adoptar en las categorías de intereses o comisiones', () => {
    const tx = (
      id: string,
      categoryId: string,
      debtRole: 'CARD_CHARGE' | null = null,
      status = 'POSTED',
    ) => ({
      id,
      kind: 'EXPENSE',
      status,
      debtRole,
      splits: [{ categoryId }],
    });
    const found = possibleDuplicates(
      [
        tx('a', 'interest'),
        tx('b', 'interest', 'CARD_CHARGE'),
        tx('c', 'comida'),
        tx('d', 'fees', null, 'VOIDED'),
        tx('e', 'fees'),
      ],
      new Set(['interest', 'fees']),
    );
    expect(found.map((t) => t.id)).toEqual(['a', 'e']);
  });
});

const ctx = {
  formatLocale: 'es-BO',
  scales: { BOB: 2, USD: 2 },
  base: '/api/v1/workspaces/w1',
  href: (p: string) => `/es${p}`,
  uiLocale: 'es',
  api: {},
  canEdit: true,
} as unknown as WorkspaceContext;

describe('formulario de cargos (render)', () => {
  const render = (extra: Record<string, unknown> = {}) =>
    renderToStaticMarkup(
      <ChargeFormPanel
        ctx={ctx}
        f={f}
        card={card()}
        accountId="acc-bob"
        currency="BOB"
        initial={form({ interest: '4,00', insurance: '0,80' })}
        onDone={() => undefined}
        onCancel={() => undefined}
        {...extra}
      />,
    );

  it('[TC-DEBT-CARD-043] muestra la fecha por omisión (el cierre), los cuatro componentes rotulados y el total en vivo', () => {
    const html = render();
    const text = textOf(html);
    expect(html).toContain('value="2026-10-25"');
    for (const label of ['Intereses (BOB)', 'Comisiones (BOB)', 'Seguro (BOB)', 'Impuestos (BOB)']) {
      expect(text).toContain(label);
    }
    expect(text).toContain('Total del cargo: 4,80 BOB');
    expect(html).toContain('data-testid="charge-save"');
  });

  it('[TC-DEBT-CARD-051] en la adopción no hay fecha y el texto explica que no crea otra transacción', () => {
    const html = render({ adoptTransactionId: 'tx-1', testId: 'adopt-form' });
    expect(html).not.toContain('data-testid="charge-date"');
    expect(textOf(html)).toContain('No crea otra transacción ni cambia el saldo');
    expect(textOf(html)).toContain('Adoptar como cargo');
  });

  it('avisa de un posible doble registro con enlace al gasto sin adoptar', () => {
    const html = render({
      duplicates: [{ id: 'tx-9', transactionDate: '2026-10-25' }],
    });
    expect(html).toContain('data-testid="charge-duplicate-warning"');
    expect(html).toContain('href="/es/transacciones/tx-9"');
  });
});

describe('cargo en el detalle de la transacción', () => {
  it('[TC-TRANSACTIONS-CARDCHARGE-001] el cargo enlaza a su tarjeta e informa que la administra la tarjeta', () => {
    const html = renderToStaticMarkup(
      <CardChargeView
        f={f}
        cardName="Visa Oro"
        cardId="card-1"
        href={(p) => `/es${p}`}
        managedMessage="Administrada por la tarjeta"
      />,
    );
    expect(html).toContain('href="/es/debts/tarjetas/card-1"');
    expect(textOf(html)).toContain('Cargo de la tarjeta');
    expect(textOf(html)).toContain('Visa Oro');
    expect(textOf(html)).toContain('Administrada por la tarjeta');
  });
});
