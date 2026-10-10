import { DomainError, LocalDate, Money, currency } from '@pf/shared-kernel';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { SUBSCRIPTION_LIFECYCLE, SUBSCRIPTION_STATUSES } from './lifecycle.js';
import { Subscription } from './subscription.js';

const USD = currency('USD', 2);
const WS = '0190a000-0000-7000-8000-00000000a001';
const AT = '2026-10-10T12:00:00.000Z';
const TODAY = LocalDate.parse('2026-11-01');
const usd = (amount: string) => Money.parse(amount, USD);

const codeOf = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (err) {
    return err instanceof DomainError ? err.code : `no-domain:${String(err)}`;
  }
  return undefined;
};

function subscription(over: { trialEndsOn?: string; firstRenewalOn?: string } = {}): Subscription {
  return Subscription.create({
    id: 'sub-1',
    workspaceId: WS,
    definitionId: 'def-1',
    counterpartyId: 'cp-1',
    name: 'Streamly',
    planName: 'Premium',
    price: usd('10.99'),
    priceEntryId: 'price-1',
    firstRenewalOn: over.firstRenewalOn ?? '2026-11-15',
    ...(over.trialEndsOn ? { trialEndsOn: over.trialEndsOn } : {}),
    at: AT,
    by: 'user-1',
  });
}

describe('Suscripción: alta y estados', () => {
  it('[TC-COMMITMENTS-SUBS-001] la suscripción nace ACTIVE con su primer precio vigente desde la primera renovación', () => {
    const sub = subscription();
    expect(sub.status).toBe('ACTIVE');
    expect(sub.snapshot.tolerancePercent).toBe('1.00');
    expect(sub.snapshot.reminder).toEqual({ enabled: true, daysBefore: 3 });
    expect(sub.lastTransition).toEqual({ transition: 'CREATE', from: null, to: 'ACTIVE' });
    expect(sub.addedPrices).toHaveLength(1);
    const first = sub.priceAt('2026-11-15');
    expect(first?.origin).toBe('INITIAL');
    expect(first?.price.toJSON()).toEqual({ amount: '10.99', currency: 'USD' });
    expect(sub.priceAt('2026-11-14')).toBeNull();
  });

  it('[TC-COMMITMENTS-SUBS-008] con fin de trial nace en TRIAL y la primera renovación no puede preceder al fin', () => {
    const sub = subscription({ trialEndsOn: '2026-11-20', firstRenewalOn: '2026-11-20' });
    expect(sub.status).toBe('TRIAL');
    expect(codeOf(() => subscription({ trialEndsOn: '2026-11-20', firstRenewalOn: '2026-11-01' }))).toBe(
      'VALIDATION_FAILED',
    );
  });

  it('[TC-COMMITMENTS-SUBS-008] el fin de trial pasa a ACTIVE una sola vez, solo cuando llegó la fecha', () => {
    const sub = subscription({ trialEndsOn: '2026-11-20', firstRenewalOn: '2026-11-20' });
    expect(codeOf(() => sub.endTrial(LocalDate.parse('2026-11-19'), AT, null))).toBe('VALIDATION_FAILED');
    sub.endTrial(LocalDate.parse('2026-11-20'), AT, null);
    expect(sub.status).toBe('ACTIVE');
    expect(sub.lastTransition).toEqual({ transition: 'END_TRIAL', from: 'TRIAL', to: 'ACTIVE' });
    expect(codeOf(() => sub.endTrial(LocalDate.parse('2026-11-21'), AT, null))).toBe(
      'INVALID_STATUS_TRANSITION',
    );
  });

  it('[TC-COMMITMENTS-SUBS-007] una transición no permitida se rechaza sin cambiar el estado', () => {
    const trial = subscription({ trialEndsOn: '2026-11-20', firstRenewalOn: '2026-11-20' });
    expect(codeOf(() => trial.pause(AT, null))).toBe('INVALID_STATUS_TRANSITION');
    expect(trial.status).toBe('TRIAL');

    const sub = subscription();
    sub.cancel({ on: '2026-11-01', today: TODAY }, AT, 'user-1');
    expect(sub.status).toBe('CANCELLED');
    expect(codeOf(() => sub.resume(AT, null))).toBe('INVALID_STATUS_TRANSITION');
    expect(codeOf(() => sub.pause(AT, null))).toBe('INVALID_STATUS_TRANSITION');
    expect(codeOf(() => sub.cancel({ on: '2026-11-01', today: TODAY }, AT, null))).toBe(
      'INVALID_STATUS_TRANSITION',
    );
    expect(codeOf(() => sub.annotate({ planName: 'Estándar' }, AT, null))).toBe('INVALID_STATUS_TRANSITION');
    expect(sub.status).toBe('CANCELLED');

    const active = subscription();
    expect(codeOf(() => active.resume(AT, null))).toBe('INVALID_STATUS_TRANSITION');
    active.pause(AT, null);
    expect(active.status).toBe('PAUSED');
    active.resume(AT, null);
    expect(active.status).toBe('ACTIVE');
  });

  it('[TC-COMMITMENTS-SUBS-007] PBT: ninguna secuencia de comandos sale de CANCELLED', () => {
    const commands = ['pause', 'resume', 'cancel', 'schedule', 'undo', 'endTrial'] as const;
    fc.assert(
      fc.property(fc.array(fc.constantFrom(...commands), { maxLength: 12 }), (steps) => {
        const sub = subscription({ trialEndsOn: '2026-11-01', firstRenewalOn: '2026-11-15' });
        let wasCancelled = false;
        for (const step of steps) {
          try {
            if (step === 'pause') sub.pause(AT, null);
            else if (step === 'resume') sub.resume(AT, null);
            else if (step === 'cancel') sub.cancel({ on: '2026-11-01', today: TODAY }, AT, null);
            else if (step === 'schedule')
              sub.scheduleCancellation({ on: '2026-12-15', today: TODAY }, AT, null);
            else if (step === 'undo') sub.undoScheduledCancellation(AT, null);
            else sub.endTrial(TODAY, AT, null);
          } catch (err) {
            expect(err).toBeInstanceOf(DomainError);
          }
          if (wasCancelled) expect(sub.status).toBe('CANCELLED');
          wasCancelled ||= sub.status === 'CANCELLED';
          expect(SUBSCRIPTION_STATUSES).toContain(sub.status);
        }
      }),
      { numRuns: process.env['NIGHTLY'] ? 10_000 : 100 },
    );
  });

  it('[TC-COMMITMENTS-SUBS-007] la máquina declara CANCELLED como terminal y todos los estados alcanzables', () => {
    expect(SUBSCRIPTION_LIFECYCLE.isTerminal('CANCELLED')).toBe(true);
    expect([...SUBSCRIPTION_LIFECYCLE.reachableStates()].sort()).toEqual([
      'ACTIVE',
      'CANCELLED',
      'PAUSED',
      'TRIAL',
    ]);
  });

  it('[TC-COMMITMENTS-SUBS-019] la cancelación programada es un atributo: el estado no cambia hasta la fecha', () => {
    const sub = subscription();
    expect(codeOf(() => sub.scheduleCancellation({ on: '2026-11-01', today: TODAY }, AT, null))).toBe(
      'VALIDATION_FAILED',
    );
    sub.scheduleCancellation({ on: '2026-12-15', reason: 'ya no lo uso', today: TODAY }, AT, 'user-1');
    expect(sub.status).toBe('ACTIVE');
    expect(sub.snapshot.scheduledCancellationOn).toBe('2026-12-15');
    expect(sub.lastTransition).toEqual({ transition: 'SCHEDULE_CANCELLATION', from: 'ACTIVE', to: 'ACTIVE' });

    sub.undoScheduledCancellation(AT, 'user-1');
    expect(sub.status).toBe('ACTIVE');
    expect(sub.snapshot.scheduledCancellationOn).toBeNull();
    expect(codeOf(() => sub.undoScheduledCancellation(AT, null))).toBe('INVALID_STATUS_TRANSITION');

    sub.scheduleCancellation({ on: '2026-12-15', today: TODAY }, AT, null);
    expect(codeOf(() => sub.cancel({ on: '2026-12-15', today: TODAY }, AT, null))).toBe('VALIDATION_FAILED');
    sub.cancel({ on: '2026-12-15', today: LocalDate.parse('2026-12-15') }, AT, null);
    expect(sub.status).toBe('CANCELLED');
    expect(sub.snapshot.cancelledOn).toBe('2026-12-15');
    expect(sub.snapshot.scheduledCancellationOn).toBeNull();
    expect(sub.snapshot.nextRenewalOn).toBeNull();
  });

  it('[TC-COMMITMENTS-SUBS-015] cancelar deja la fecha y el motivo y conserva el historial de precios', () => {
    const sub = subscription();
    sub.cancel({ on: '2026-11-02', reason: 'caro', today: LocalDate.parse('2026-11-02') }, AT, 'user-1');
    expect(sub.snapshot.cancelledOn).toBe('2026-11-02');
    expect(sub.snapshot.cancellationReason).toBe('caro');
    expect(sub.history.entries).toHaveLength(1);
    expect(sub.lastTransition).toEqual({ transition: 'CANCEL', from: 'ACTIVE', to: 'CANCELLED' });
  });

  it('[TC-COMMITMENTS-SUBS-002] valida nombre, recordatorio y tolerancia en el alta', () => {
    const build = (over: Partial<Parameters<typeof Subscription.create>[0]>) => () =>
      Subscription.create({
        id: 's',
        workspaceId: WS,
        definitionId: 'd',
        counterpartyId: 'c',
        name: 'X',
        price: usd('1.00'),
        priceEntryId: 'p',
        firstRenewalOn: '2026-11-15',
        at: AT,
        by: null,
        ...over,
      });
    expect(codeOf(build({ name: '  ' }))).toBe('VALIDATION_FAILED');
    expect(codeOf(build({ price: usd('0.00') }))).toBe('AMOUNT_NOT_POSITIVE');
    expect(codeOf(build({ reminder: { daysBefore: 0 } }))).toBe('VALIDATION_FAILED');
    expect(codeOf(build({ reminder: { daysBefore: 31 } }))).toBe('VALIDATION_FAILED');
    expect(codeOf(build({ tolerancePercent: '50.01' }))).toBe('VALIDATION_FAILED');
    expect(codeOf(build({ tolerancePercent: '-1' }))).toBe('VALIDATION_FAILED');
    expect(build({ tolerancePercent: '50' })).not.toThrow();
    expect(codeOf(build({ firstRenewalOn: '2026-13-01' }))).toBe('VALIDATION_FAILED');
  });

  it('[TC-COMMITMENTS-SUBS-004] conserva la escala de USDT (6 decimales) en el precio', () => {
    const USDT = currency('USDT', 6);
    const sub = Subscription.create({
      id: 's',
      workspaceId: WS,
      definitionId: 'd',
      counterpartyId: 'c',
      name: 'VPN Pro',
      price: Money.parse('5.000000', USDT),
      priceEntryId: 'p',
      firstRenewalOn: '2026-11-03',
      at: AT,
      by: null,
    });
    expect(sub.snapshot.priceCurrency).toBe('USDT');
    expect(sub.priceAt('2026-11-03')?.price.toJSON()).toEqual({ amount: '5.000000', currency: 'USDT' });
  });

  it('anotar nombre/plan/ajustes sube la versión y reporta los campos cambiados', () => {
    const sub = subscription();
    sub.annotate({ planName: 'Estándar', reminder: { daysBefore: 5 } }, AT, 'user-1');
    expect(sub.version).toBe(2);
    expect(sub.lastTransition).toBeNull();
    expect([...sub.changedFields].sort()).toEqual(['planName', 'reminderDaysBefore']);
    sub.annotate({ planName: 'Estándar' }, AT, 'user-1');
    expect(sub.version).toBe(2);
    expect(sub.changedFields).toEqual([]);
  });
});
