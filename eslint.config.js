// ESLint flat config del monorepo (ESLint 10 + typescript-eslint 8, TypeScript 6.0.x).
// Las reglas de fronteras de arquitectura viven en dependency-cruiser (grupo 5), no aquí.
import js from '@eslint/js';
import nextPlugin from '@next/eslint-plugin-next';
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

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/.turbo/**',
      '**/coverage/**',
      '**/.stryker-tmp/**',
      '**/next-env.d.ts',
      'spikes/**',
      'docs/**',
      'openspec/**',
      'contracts/**',
      'tests/cases/**',
      '.claude/**',
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
    },
  },
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
