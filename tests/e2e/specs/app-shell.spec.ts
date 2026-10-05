import { expect, test, type Page } from '@playwright/test';
import {
  api,
  bob,
  expectNoHorizontalScroll,
  go,
  newFinanceUser,
  openAccount,
  todayLaPaz,
  userCategories,
} from '../src/finance.js';

/**
 * Marco global de la app autenticada (docs/28 §2.1, §5, §10): landmarks, enlace "saltar al contenido", navegación
 * principal con la sección activa (`aria-current="page"`), menú de la cuenta con idioma y cierre de sesión, y panel
 * de navegación plegable en móvil sin scroll horizontal. Deja capturas de Inicio, Transacciones y Cuentas en
 * escritorio y móvil dentro de `test-results/` (no versionado) para la revisión visual.
 */
const SCREENS = [
  { path: '/', nav: 'Inicio', file: 'home' },
  { path: '/transacciones', nav: 'Transacciones', file: 'transacciones' },
  { path: '/cuentas', nav: 'Cuentas', file: 'cuentas' },
] as const;

const primaryNav = (page: Page) => page.getByRole('navigation', { name: 'Navegación principal' });

test.describe('Marco de la app (AppFrame)', () => {
  test('landmarks, saltar al contenido, sección activa, menú de la cuenta y navegación móvil', async ({
    browser,
  }, testInfo) => {
    const { context, page, W } = await newFinanceUser(browser, 'shell');
    const bank = await openAccount(page, W, 'Banco Shell', 'BANK', 'BOB', '2500.00');
    await openAccount(page, W, 'Ahorro USD Shell', 'SAVINGS', 'USD', '300.00');
    const [food] = await userCategories(page, W, 'EXPENSE');
    await api(page, 'POST', `${W}/transactions`, {
      kind: 'EXPENSE',
      transactionDate: todayLaPaz(),
      accountId: bank,
      amount: bob('245.30'),
      splits: [{ amount: bob('245.30'), categoryId: food!.id }],
    });

    // Escritorio: barra superior, sidebar y contenido.
    await page.setViewportSize({ width: 1280, height: 860 });
    for (const s of SCREENS) {
      await go(page, s.path);
      await expect(page.getByRole('banner')).toBeVisible();
      await expect(page.getByRole('main')).toBeVisible();
      await expect(primaryNav(page)).toBeVisible();
      await expect(primaryNav(page).getByRole('link', { name: s.nav, exact: true })).toHaveAttribute(
        'aria-current',
        'page',
      );
      await expect(primaryNav(page).locator('[aria-current="page"]')).toHaveCount(1);
      if (s.path === '/') {
        await expect(page.getByTestId('top-categories')).toHaveAttribute('data-comparison', 'ready');
      }
      await page.screenshot({ path: testInfo.outputPath(`shell-desktop-${s.file}.png`), fullPage: true });
    }

    // Subrutas: la sección sigue marcada.
    await go(page, '/transferencias/nueva');
    await expect(primaryNav(page).getByRole('link', { name: 'Transacciones', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );

    // Saltar al contenido: primer elemento enfocable; lleva el foco a <main>.
    await go(page, '/cuentas');
    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: 'Saltar al contenido' });
    await expect(skip).toBeFocused();
    await expect(skip).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('main')).toBeFocused();

    // Menú de la cuenta: disclosure con preferencias, idioma y cierre de sesión; Escape lo cierra.
    const toggle = page.getByTestId('user-menu');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByTestId('logout')).toBeHidden();
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByRole('link', { name: 'Mis preferencias' })).toBeVisible();
    const languages = page.getByRole('navigation', { name: 'Idioma' });
    await expect(languages.getByRole('link', { name: 'Español (Bolivia)' })).toHaveAttribute(
      'aria-current',
      'true',
    );
    await expect(languages.getByRole('link', { name: 'English (United States)' })).toHaveAttribute(
      'href',
      '/en/cuentas',
    );
    await expect(page.getByTestId('logout')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(toggle).toBeFocused();

    // Móvil: la navegación es un panel plegable detrás del botón de menú; sin scroll horizontal.
    await page.setViewportSize({ width: 375, height: 812 });
    for (const s of SCREENS) {
      await go(page, s.path);
      const menu = page.getByRole('button', { name: 'Menú de navegación' });
      await expect(menu).toHaveAttribute('aria-expanded', 'false');
      await expect(primaryNav(page)).toBeHidden();
      await expectNoHorizontalScroll(page);
      if (s.path === '/') {
        await expect(page.getByTestId('top-categories')).toHaveAttribute('data-comparison', 'ready');
      }
      await page.screenshot({ path: testInfo.outputPath(`shell-mobile-${s.file}.png`), fullPage: true });
    }
    const menu = page.getByRole('button', { name: 'Menú de navegación' });
    await menu.click();
    await expect(menu).toHaveAttribute('aria-expanded', 'true');
    await expect(primaryNav(page).getByRole('link', { name: 'Cuentas', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expectNoHorizontalScroll(page);
    await page.screenshot({ path: testInfo.outputPath('shell-mobile-menu-abierto.png') });
    await primaryNav(page).getByRole('link', { name: 'Transacciones', exact: true }).click();
    await expect(page).toHaveURL(/\/transacciones$/);
    await expect(page.getByTestId('ready')).toBeAttached();
    await expect(primaryNav(page)).toBeHidden();

    await context.close();
  });
});
