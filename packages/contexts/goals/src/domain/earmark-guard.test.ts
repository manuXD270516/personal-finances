import { DomainError, LocalDate, currency, dec } from '@pf/shared-kernel';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  NORMAL_RESERVATION,
  assertEarmarkWithinBalance,
  evaluateEpisode,
  type ReservationEpisodeState,
} from './earmark-guard.js';

const BOB = currency('BOB', 2);
const d = (s: string) => LocalDate.parse(s);

function codeAndDetails(fn: () => void): { code: string; details: unknown } | null {
  try {
    fn();
  } catch (err) {
    if (err instanceof DomainError) return { code: err.code, details: err.details };
    throw err;
  }
  return null;
}

describe('EarmarkGuard (FR-GOALS-004, INV-018)', () => {
  it('[TC-GOALS-SAVINGS-014] 3600.00 sobre un disponible de 3500.00 se rechaza con el detalle de saldo, reservado y disponible', () => {
    const r = codeAndDetails(() =>
      assertEarmarkWithinBalance({
        balance: dec('7000.00'),
        reserved: dec('3500.00'),
        amount: dec('3600.00'),
        currency: BOB,
      }),
    );
    expect(r?.code).toBe('EARMARK_EXCEEDS_BALANCE');
    expect(r?.details).toEqual({
      balance: { amount: '7000.00', currency: 'BOB' },
      reserved: { amount: '3500.00', currency: 'BOB' },
      available: { amount: '3500.00', currency: 'BOB' },
    });
  });

  it('[TC-GOALS-SAVINGS-015] reservar exactamente el disponible se acepta (límite inclusivo)', () => {
    expect(
      codeAndDetails(() =>
        assertEarmarkWithinBalance({
          balance: dec('7000.00'),
          reserved: dec('3500.00'),
          amount: dec('3500.00'),
          currency: BOB,
        }),
      ),
    ).toBeNull();
  });

  it('[TC-GOALS-SAVINGS-015] una cuenta llena de aportes reales (reservado = saldo) rechaza hasta 1.00', () => {
    const r = codeAndDetails(() =>
      assertEarmarkWithinBalance({
        balance: dec('1000.00'),
        reserved: dec('1000.00'),
        amount: dec('1.00'),
        currency: BOB,
      }),
    );
    expect(r?.code).toBe('EARMARK_EXCEEDS_BALANCE');
  });

  it('[TC-GOALS-SAVINGS-015] PBT: una reserva aceptada nunca deja reservado > saldo y una rechazada sí lo habría dejado', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1_000_000 }),
        fc.integer({ min: 0, max: 1_000_000 }),
        fc.integer({ min: 1, max: 500_000 }),
        (balance, reserved, amount) => {
          const outcome = codeAndDetails(() =>
            assertEarmarkWithinBalance({
              balance: dec(String(balance)),
              reserved: dec(String(reserved)),
              amount: dec(String(amount)),
              currency: BOB,
            }),
          );
          if (outcome === null) expect(reserved + amount).toBeLessThanOrEqual(balance);
          else expect(reserved + amount).toBeGreaterThan(balance);
        },
      ),
      { numRuns: 500 },
    );
  }, 30_000);
});

describe('ReservationEpisode (FR-GOALS-004, decisión 6)', () => {
  const run = (
    current: ReservationEpisodeState,
    balance: string,
    reserved: string,
    today = '2026-10-15',
    id = 'ep-1',
  ) =>
    evaluateEpisode(current, {
      balance: dec(String(balance)),
      reserved: dec(String(reserved)),
      currency: BOB,
      today: d(today),
      newEpisodeId: () => id,
    });

  it('[TC-GOALS-SAVINGS-016] un gasto de 1200.00 con 7000.00 reservados abre un episodio con faltante 1200.00 y un hecho', () => {
    const r = run(NORMAL_RESERVATION, '5800.00', '7000.00');
    expect(r.change).toBe('OPENED');
    expect(r.next).toEqual({
      state: 'OVER_ALLOCATED',
      episodeId: 'ep-1',
      since: '2026-10-15',
      shortfall: '1200.00',
      currency: 'BOB',
    });
  });

  it('[TC-GOALS-SAVINGS-017] dentro del episodio solo cambia el faltante (sin hecho nuevo) y reentregar no cambia nada', () => {
    const open = run(NORMAL_RESERVATION, '5800.00', '7000.00').next;
    const second = run(open, '5700.00', '7000.00', '2026-10-16', 'ep-2');
    expect(second.change).toBe('UPDATED');
    expect(second.next).toMatchObject({ episodeId: 'ep-1', shortfall: '1300.00', since: '2026-10-15' });
    expect(run(second.next, '5700.00', '7000.00', '2026-10-16', 'ep-3').change).toBe('UNCHANGED');
  });

  it('[TC-GOALS-SAVINGS-017] un ingreso que cubre lo reservado cierra el episodio y la próxima caída abre otro', () => {
    const open = run(NORMAL_RESERVATION, '5700.00', '7000.00').next;
    const closed = run(open, '7700.00', '7000.00');
    expect(closed).toEqual({ next: NORMAL_RESERVATION, change: 'CLOSED' });
    const reopened = run(closed.next, '6900.00', '7000.00', '2026-10-20', 'ep-9');
    expect(reopened.change).toBe('OPENED');
    expect(reopened.next).toMatchObject({ episodeId: 'ep-9', shortfall: '100.00' });
  });

  it('[TC-GOALS-SAVINGS-017] saldo exactamente igual a lo reservado no es sobre-asignación', () => {
    expect(run(NORMAL_RESERVATION, '7000.00', '7000.00').change).toBe('UNCHANGED');
  });

  it('una cuenta sin nada reservado nunca está sobre-asignada, aunque su saldo sea negativo', () => {
    expect(run(NORMAL_RESERVATION, '-50.00', '0').change).toBe('UNCHANGED');
    const open = run(NORMAL_RESERVATION, '10.00', '100.00').next;
    expect(run(open, '-50.00', '0').change).toBe('CLOSED');
  });
});
