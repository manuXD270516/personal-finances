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
  });

  it('no marca nada fuera de la navegación principal ni por prefijo parcial', () => {
    expect(activeNav('/preferencias')).toBeUndefined();
    expect(activeNav('/workspaces/nuevo')).toBeUndefined();
    expect(activeNav('/cuentasx')).toBeUndefined();
  });

  it('usa la primera letra del nombre visible para el avatar', () => {
    expect(initialOf('owner demo')).toBe('O');
    expect(initialOf('  Ñandú')).toBe('Ñ');
    expect(initialOf('')).toBe('?');
  });
});
