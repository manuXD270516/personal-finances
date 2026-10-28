import { describe, expect, it } from 'vitest';

// Rama de prueba de fix-nightly-pipeline 8.6 (NO FUSIONAR): fallo forzado para `regression` y `mutation`.
describe('verificación 8.6', () => {
  it('falla a propósito', () => {
    expect(1).toBe(2);
  });
});
