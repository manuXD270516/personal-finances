import { describe, expect, it } from 'vitest';
import { activeNav, initialOf, stripLocale } from './nav';

describe('navegación principal del marco', () => {
  it('quita el prefijo de locale y la barra final', () => {
    expect(stripLocale('/')).toBe('/');
    expect(stripLocale('/en')).toBe('/');
    expect(stripLocale('/pt/cuentas/')).toBe('/cuentas');
    expect(stripLocale('/cuentas')).toBe('/cuentas');
    expect(stripLocale('/entradas')).toBe('/entradas');
  });

  it('marca la sección activa, incluidas sus subrutas', () => {
    expect(activeNav('/')).toBe('home');
    expect(activeNav('/en')).toBe('home');
    expect(activeNav('/transacciones/nueva')).toBe('transactions');
    expect(activeNav('/transferencias/nueva')).toBe('transactions');
    expect(activeNav('/en/cuentas/abc')).toBe('accounts');
    expect(activeNav('/instituciones')).toBe('accounts');
    expect(activeNav('/fx/conversiones/nueva')).toBe('fx');
    expect(activeNav('/clasificacion')).toBe('classification');
    expect(activeNav('/planificacion/periodos')).toBe('planning');
    expect(activeNav('/en/planificacion')).toBe('planning');
    expect(activeNav('/pt/configuracion')).toBe('settings');
    // Phase 3 (add-recurrence-engine): detalle de definición y de ocurrencia (enlace de las notificaciones).
    expect(activeNav('/recurring')).toBe('recurring');
    expect(activeNav('/en/recurring/0198f0aa')).toBe('recurring');
    expect(activeNav('/recurring/occurrences/0198f0bb')).toBe('recurring');
    // La evolución del patrimonio cuelga del Home (add-net-worth-evolution).
    expect(activeNav('/patrimonio')).toBe('home');
    expect(activeNav('/en/patrimonio')).toBe('home');
  });

  it('no marca nada fuera de la navegación principal ni por prefijo parcial', () => {
    expect(activeNav('/preferencias')).toBeUndefined();
    expect(activeNav('/workspaces/nuevo')).toBeUndefined();
    expect(activeNav('/cuentasx')).toBeUndefined();
    expect(activeNav('/recurringx')).toBeUndefined();
  });

  it('usa la primera letra del nombre visible para el avatar', () => {
    expect(initialOf('owner demo')).toBe('O');
    expect(initialOf('  Ñandú')).toBe('Ñ');
    expect(initialOf('')).toBe('?');
  });
});
