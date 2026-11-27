import { defineConfig } from 'vitest/config';

// Unitarios del harness (sin Docker ni navegador). Las specs de Playwright viven en `specs/` y las corre `test:e2e`.
export default defineConfig({ test: { include: ['src/**/*.test.ts'] } });
