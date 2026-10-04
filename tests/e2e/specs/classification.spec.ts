import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { api, bob, go, newFinanceUser, openAccount, todayLaPaz } from '../src/finance.js';
import { bff } from '../src/helpers.js';

/**
 * Clasificación por la UI (openspec add-classification, tareas 8.1–8.3 y 9.2): workspace nuevo con el catálogo
 * sugerido, subcategoría con icono y color, orden persistente con el teclado, archivado (desaparece del selector y el
 * historial la conserva) y contraparte con alias y categoría por defecto.
 */
test.describe('Clasificación: categorías, etiquetas y contrapartes (classification/*)', () => {
  test('[TC-CLASSIFICATION-SEED-001] [TC-CLASSIFICATION-CATEGORY-001] [TC-CLASSIFICATION-ARCHIVE-002] [TC-CLASSIFICATION-ARCHIVE-001] workspace con catálogo, subcategoría nueva reordenada y archivada: sale del selector pero el historial la conserva', async ({
    browser,
  }) => {
    test.setTimeout(150_000);
    const { context, page } = await newFinanceUser(browser, 'cls');

    // Alta del workspace con el paso "cargar catálogo sugerido" (marcado por defecto).
    await go(page, '/workspaces/nuevo');
    const name = `Hogar ${randomUUID().slice(0, 6)}`;
    await page.locator('input[name="name"]').fill(name);
    await expect(
      page.getByLabel('Cargar el catálogo sugerido de categorías (puedes editarlo después)'),
    ).toBeChecked();
    await page.getByRole('button', { name: 'Crear espacio' }).click();
    await expect(page.getByRole('status')).toHaveText(`Espacio de trabajo creado: ${name}.`);
    const list = await bff(page, 'GET', '/api/bff/v1/workspaces?limit=200');
    const ws = (list.body?.['data'] as { id: string; name: string }[]).find((w) => w.name === name)!;
    expect((await bff(page, 'PUT', '/api/bff/session', { body: { activeWorkspaceId: ws.id } })).status).toBe(
      200,
    );
    const W = `/workspaces/${ws.id}`;

    await go(page, '/clasificacion');
    const vivienda = page.locator('[data-testid="category-group"][data-group="Vivienda"]');
    await expect(vivienda.locator('[data-category="Servicios básicos"]')).toBeVisible();
    await expect(vivienda.locator('[data-category="Internet"]')).toBeVisible();

    // Subcategoría nueva con icono y color.
    const form = page.getByRole('form', { name: 'Nueva categoría' });
    await form.getByLabel('Grupo').selectOption({ label: 'Vivienda (gasto)' });
    await form.getByLabel('Categoría padre').selectOption({ label: 'Servicios básicos' });
    await form.getByLabel('Nombre').fill('Fibra óptica');
    await form.getByLabel('Icono').selectOption('laptop');
    await form.getByLabel('Sin color').uncheck();
    await form.getByLabel('Color', { exact: true }).fill('#00838f');
    await form.getByRole('button', { name: 'Crear' }).click();
    await expect(page.getByRole('status')).toHaveText('Categoría «Fibra óptica» creada.');
    const fibra = vivienda.locator('[data-testid="category"][data-category="Fibra óptica"]');
    await expect(fibra.getByTestId('icon')).toHaveAttribute('data-icon', 'laptop');
    await expect(fibra.getByTestId('color')).toHaveAttribute('data-color', '#00838f');

    // Orden persistente con el teclado (alternativa a arrastrar): baja un lugar (o sube, si quedó última) y persiste
    // tras recargar.
    const siblingNames = () =>
      vivienda
        .locator('[data-category="Servicios básicos"]')
        .locator('xpath=ancestor::li[1]')
        .locator('ul [data-testid="category"]')
        .evaluateAll((els) => els.map((e) => e.getAttribute('data-category')));
    const before = await siblingNames();
    expect(before).toContain('Fibra óptica');
    const from = before.indexOf('Fibra óptica');
    const down = from < before.length - 1;
    const to = down ? from + 1 : from - 1;
    const expected = [...before];
    [expected[from], expected[to]] = [expected[to]!, expected[from]!];
    await fibra.getByRole('button', { name: `${down ? 'Bajar' : 'Subir'} «Fibra óptica»` }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('status')).toHaveText('Orden guardado: «Fibra óptica» movida.');
    await page.reload();
    await expect.poll(siblingNames).toEqual(expected);

    // Un gasto clasificado en la subcategoría (historial).
    const fibraId = (
      (await api(page, 'GET', `${W}/categories?limit=200`))['data'] as { id: string; name: string }[]
    ).find((c) => c.name === 'Fibra óptica')!.id;
    const bank = await openAccount(page, W, 'Banco clasificación', 'BANK', 'BOB', '500.00');
    const tx = await api(page, 'POST', `${W}/transactions`, {
      kind: 'EXPENSE',
      transactionDate: todayLaPaz(),
      accountId: bank,
      amount: bob('180.00'),
      description: 'Internet de fibra',
      splits: [{ amount: bob('180.00'), categoryId: fibraId }],
    });

    // Archivar: desaparece del árbol y del selector del formulario de transacción.
    await go(page, '/clasificacion');
    await vivienda.getByRole('button', { name: 'Archivar «Fibra óptica»' }).click();
    await expect(page.getByRole('status')).toHaveText('«Fibra óptica» archivada.');
    await expect(vivienda.locator('[data-category="Fibra óptica"]')).toHaveCount(0);
    await page.getByLabel('Mostrar archivadas').check();
    const archived = vivienda.locator('[data-testid="category"][data-category="Fibra óptica"]');
    await expect(archived).toHaveAttribute('data-archived', 'true');
    await expect(archived.getByRole('button', { name: 'Desarchivar «Fibra óptica»' })).toBeVisible();

    await go(page, '/transacciones/nueva');
    const category = page.getByTestId('transaction-form').getByLabel('Categoría de la parte 1');
    await expect(category.locator('option', { hasText: 'Servicios básicos › Internet' })).toHaveCount(1);
    await expect(category.locator('option', { hasText: 'Fibra óptica' })).toHaveCount(0);

    // El historial conserva la categoría archivada.
    await go(page, `/transacciones/${String(tx['id'])}`);
    await expect(page.getByTestId('tx-split').first()).toContainText('Fibra óptica');
    await expect(page.getByTestId('tx-split-amount').first()).toHaveText('180,00 BOB');
    await context.close();
  });

  test('[TC-CLASSIFICATION-COUNTERPARTY-001] [TC-CLASSIFICATION-ALIAS-001] contraparte con alias y categoría por defecto; etiqueta con color', async ({
    browser,
  }) => {
    const { context, page, W } = await newFinanceUser(browser, 'clscp');
    await go(page, '/clasificacion?vista=contrapartes');
    await expect(page.getByRole('tab', { name: 'Contrapartes' })).toHaveAttribute('aria-selected', 'true');
    const form = page.getByRole('form', { name: 'Nueva contraparte' });
    await form.getByLabel('Nombre').fill('Tigo');
    await form.getByLabel('Tipo').selectOption({ label: 'Proveedor de servicios' });
    await form.getByLabel('Categoría por defecto').selectOption({ label: 'Servicios básicos › Internet' });
    await form.getByLabel('Alias').fill('TIGO MONEY, TIGO BOLIVIA');
    await form.getByRole('button', { name: 'Crear' }).click();
    await expect(page.getByRole('status')).toHaveText('Contraparte «Tigo» creada.');
    const tigo = page.locator('[data-testid="counterparty"][data-counterparty="Tigo"]');
    await expect(tigo.getByTestId('counterparty-aliases')).toHaveText('Alias: TIGO BOLIVIA, TIGO MONEY');
    await expect(tigo.getByTestId('counterparty-default-category')).toHaveText(
      'Categoría por defecto: Internet',
    );
    // El alias reconoce la descripción bancaria (resolución de la API).
    const resolved = await api(
      page,
      'GET',
      `${W}/counterparties/resolve?description=${encodeURIComponent('PAGO TIGO MONEY 0423')}`,
    );
    expect((resolved['counterparty'] as { name: string }).name).toBe('Tigo');

    // Edición: un alias más.
    await tigo.getByRole('button', { name: 'Editar «Tigo»' }).click();
    const edit = tigo.getByTestId('counterparty-edit-form');
    await edit.getByLabel('Alias').fill('TIGO MONEY, TIGO BOLIVIA, TIGO HOGAR');
    await edit.getByRole('button', { name: 'Guardar' }).click();
    await expect(page.getByRole('status')).toHaveText('Contraparte «Tigo» actualizada.');
    await expect(tigo.getByTestId('counterparty-aliases')).toHaveText(
      'Alias: TIGO BOLIVIA, TIGO HOGAR, TIGO MONEY',
    );

    await page.getByRole('tab', { name: 'Etiquetas' }).click();
    const tagForm = page.getByRole('form', { name: 'Nueva etiqueta' });
    await tagForm.getByLabel('Nombre').fill('Viaje Sucre');
    await tagForm.getByRole('button', { name: 'Crear' }).click();
    await expect(page.getByRole('status')).toHaveText('Etiqueta «Viaje Sucre» creada.');
    await expect(page.locator('[data-testid="tag"][data-tag="Viaje Sucre"]')).toBeVisible();
    await context.close();
  });
});
