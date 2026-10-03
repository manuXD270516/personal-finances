// ESLint flat config del monorepo (ESLint 10 + typescript-eslint 8, TypeScript 6.0.x).
// Las reglas de fronteras de arquitectura viven en dependency-cruiser (grupo 5), no aquí.
import js from '@eslint/js';
import nextPlugin from '@next/eslint-plugin-next';
import { moneyConfig } from '@pf/eslint-config';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/** docs/19 §0.3: ningún módulo lee `process.env` fuera de `@pf/platform` (contrato único de configuración). */
const noProcessEnv = {
  'no-restricted-properties': [
    'error',
    {
      object: 'process',
      property: 'env',
      message:
        'Lee la configuración vía @pf/platform/config (docs/19 §0.3). process.env solo se permite dentro de packages/platform.',
    },
  ],
};

/**
 * ADR-0023 / NFR-SEC-004 (TC-SECURITY-RLS-003): el contexto RLS solo se fija con alcance de transacción
 * (`SET LOCAL` / `set_config(..., true)`, vía `PgUnitOfWork`). Un `SET app.*` de sesión o `set_config(..., false)`
 * filtra el workspace entre requests de un pool.
 */
const SESSION_SET = String.raw`/\bSET\s+(SESSION\s+)?app\.|set_config\(\s*'app\.[a-z_]+'\s*,[^)]*,\s*false\s*\)/i`;
const SESSION_SET_MESSAGE =
  'Contexto RLS de sesión prohibido: usa SET LOCAL / set_config(..., true) vía PgUnitOfWork (ADR-0023, NFR-SEC-004).';
const noSessionRlsContext = {
  'no-restricted-syntax': [
    'error',
    { selector: `Literal[value=${SESSION_SET}]`, message: SESSION_SET_MESSAGE },
    { selector: `TemplateElement[value.raw=${SESSION_SET}]`, message: SESSION_SET_MESSAGE },
  ],
};

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/.turbo/**',
      '**/coverage/**',
      '**/.stryker-tmp/**',
      '**/playwright-report/**',
      '**/test-results/**',
      '**/next-env.d.ts',
      'spikes/**',
      'docs/**',
      'openspec/**',
      'contracts/**',
      'tests/cases/**',
      '.claude/**',
      // Fixture que falla a propósito (TC-PLATFORM-ARCH-002): lo verifica el test de @pf/eslint-config.
      'packages/eslint-config/fixtures/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-console': 'error',
      eqeqeq: ['error', 'always'],
      ...noProcessEnv,
      ...noSessionRlsContext,
    },
  },
  // ADR-0006 / INV-001 (add-ledger-core 2.4): dinero nunca como `number` y sin el Decimal global de decimal.js
  // (SPIKE-03 H7); el único dueño de decimal.js es el clon MoneyDecimal del shared-kernel.
  ...moneyConfig({ decimalAllowed: ['packages/shared-kernel/src/money/**'] }),
  {
    // Nest usa clases inyectables y decoradores: las clases sin miembros son legítimas.
    files: ['apps/api/**/*.ts', 'packages/platform/src/nest/**/*.ts'],
    rules: { '@typescript-eslint/no-extraneous-class': 'off' },
  },
  {
    // Único paquete autorizado a leer el entorno.
    files: ['packages/platform/**/*.ts'],
    rules: { 'no-restricted-properties': 'off' },
  },
  {
    // Tooling y tests: pueden leer el entorno (Testcontainers, CI) y escribir en consola.
    files: ['**/*.config.{ts,js,mjs}', 'scripts/**', '**/test/**', '**/*.test.ts'],
    rules: { 'no-restricted-properties': 'off', 'no-console': 'off', 'no-restricted-syntax': 'off' },
  },
  {
    // E2E (Playwright): leen el `.env` desechable del stack `pfos-e2e` y ejecutan código en el navegador.
    files: ['tests/e2e/**/*.ts'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: { 'no-restricted-properties': 'off', 'no-console': 'off' },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    plugins: { '@next/next': nextPlugin },
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
    },
  },
  prettier,
);
