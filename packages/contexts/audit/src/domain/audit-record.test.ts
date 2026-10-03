import { FixedClock, Instant, Money, currency } from '@pf/shared-kernel';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { AuditActor } from './audit-actor.js';
import { AuditError } from './audit-error.js';
import { AuditRecord, type AuditRecordProps } from './audit-record.js';
import { changeSet, auditChange, toAuditMoney, toAuditValue } from './change-set.js';

const U1 = '0190a000-0000-7000-8000-000000000001';
const W1 = '0190a000-0000-7000-8000-0000000000a1';
const T1 = '0190a000-0000-7000-8000-0000000000f1';
const C1 = '0190a000-0000-7000-8000-0000000000c1';
const clock = new FixedClock(Instant.parse('2026-03-15T14:00:00Z'));

const props = (over: Partial<AuditRecordProps> = {}): AuditRecordProps => ({
  id: '0190a000-0000-7000-8000-0000000000e1',
  workspaceId: W1,
  occurredAt: clock.now(),
  actor: { type: 'USER', userId: U1 },
  action: 'transactions.transaction.amended',
  aggregateType: 'Transaction',
  aggregateId: T1,
  aggregateVersion: 2,
  changes: changeSet([
    auditChange('amount', toAuditMoney({ amount: '120.00', currency: 'BOB' }), {
      amount: '102.00',
      currency: 'BOB',
    }),
  ]),
  reason: null,
  origin: 'ui',
  correlationId: C1,
  requestId: C1,
  idempotencyKey: null,
  clientIpHash: null,
  userAgent: 'Mozilla/5.0',
  ...over,
});

const codeOf = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (err) {
    return err instanceof AuditError ? err.code : 'OTHER';
  }
  return undefined;
};

describe('[TC-AUDIT-CONTENT-001] el registro de auditoría contiene todos los campos requeridos', () => {
  it('actor U1, workspace W1, acción, T1 con su nueva versión, montos exactos, instante UTC, correlación y origen ui', () => {
    const r = AuditRecord.create(props());
    expect(r).toMatchObject({
      workspaceId: W1,
      actor: { type: 'USER', userId: U1, process: null },
      action: 'transactions.transaction.amended',
      aggregateType: 'Transaction',
      aggregateId: T1,
      aggregateVersion: 2,
      correlationId: C1,
      origin: 'ui',
    });
    expect(r.occurredAt.toString()).toBe('2026-03-15T14:00:00.000Z');
    expect(r.changes).toEqual([
      {
        field: 'amount',
        before: { amount: '120.00', currency: 'BOB' },
        after: { amount: '102.00', currency: 'BOB' },
      },
    ]);
    // Montos como string decimal con moneda (sin pérdida de escala), nunca number.
    expect(JSON.stringify(r.changes)).toContain('"120.00"');
  });

  it('el motivo se conserva ("Duplicada") y el registro es inmutable (congelado, sin setters)', () => {
    const r = AuditRecord.create(props({ action: 'transactions.transaction.voided', reason: 'Duplicada' }));
    expect(r.reason).toBe('Duplicada');
    expect(Object.isFrozen(r)).toBe(true);
    expect(Object.isFrozen(r.changes)).toBe(true);
    expect(() => {
      (r as { reason: string | null }).reason = 'otra';
    }).toThrow(TypeError);
  });

  it('rechaza acción, agregado, origen, ids o motivo inválidos', () => {
    expect(codeOf(() => AuditRecord.create(props({ action: 'Edit amount' })))).toBe('AUDIT_INVALID_RECORD');
    expect(codeOf(() => AuditRecord.create(props({ aggregateType: 'transaction' })))).toBe(
      'AUDIT_INVALID_RECORD',
    );
    expect(codeOf(() => AuditRecord.create(props({ origin: 'web' as never })))).toBe('AUDIT_INVALID_RECORD');
    expect(codeOf(() => AuditRecord.create(props({ correlationId: 'C1' })))).toBe('AUDIT_INVALID_RECORD');
    expect(codeOf(() => AuditRecord.create(props({ reason: '   ' })))).toBe('AUDIT_INVALID_RECORD');
    expect(codeOf(() => AuditRecord.create(props({ aggregateVersion: 0 })))).toBe('AUDIT_INVALID_RECORD');
    expect(codeOf(() => AuditRecord.create(props({ clientIpHash: new Uint8Array(4) })))).toBe(
      'AUDIT_INVALID_RECORD',
    );
  });
});

describe('[TC-AUDIT-ACTOR-001] el actor es un usuario o un proceso del sistema, nunca ambiguo', () => {
  it('SYSTEM/WORKER llevan proceso y no usuario', () => {
    const r = AuditRecord.create(
      props({ actor: { type: 'SYSTEM', process: 'ledger.system-accounts' }, origin: 'system' }),
    );
    expect(r.actor).toEqual({ type: 'SYSTEM', userId: null, process: 'ledger.system-accounts' });
    expect(AuditActor.worker('audit.ensure-partitions')).toEqual({
      type: 'WORKER',
      userId: null,
      process: 'audit.ensure-partitions',
    });
  });

  it('USER sin userId o SYSTEM sin proceso se rechazan', () => {
    expect(codeOf(() => AuditActor.of({ type: 'USER', userId: '' }))).toBe('AUDIT_INVALID_RECORD');
    expect(codeOf(() => AuditActor.of({ type: 'SYSTEM', process: '' }))).toBe('AUDIT_INVALID_RECORD');
    expect(codeOf(() => AuditActor.of({ type: 'WORKER' } as never))).toBe('AUDIT_INVALID_RECORD');
    expect(codeOf(() => AuditActor.of({ type: 'ROBOT', process: 'x' } as never))).toBe(
      'AUDIT_INVALID_RECORD',
    );
  });
});

describe('ChangeSet y montos (tarea 2.2)', () => {
  it('un monto es string decimal + moneda; un number fraccionario se rechaza; los enteros se admiten', () => {
    expect(toAuditValue(Money.parse('100.000000', currency('USDT', 6)))).toEqual({
      amount: '100.000000',
      currency: 'USDT',
    });
    expect(codeOf(() => toAuditValue(120.5))).toBe('AUDIT_INVALID_VALUE');
    expect(toAuditValue(5)).toBe(5);
    expect(codeOf(() => toAuditMoney({ amount: 120, currency: 'BOB' }))).toBe('AUDIT_INVALID_VALUE');
    expect(codeOf(() => toAuditMoney({ amount: '1e3', currency: 'BOB' }))).toBe('AUDIT_INVALID_VALUE');
    expect(codeOf(() => toAuditValue({ token: 'x' }))).toBe('AUDIT_INVALID_VALUE');
    expect(codeOf(() => changeSet([auditChange('a', 1, 2), auditChange('a', 2, 3)]))).toBe(
      'AUDIT_INVALID_RECORD',
    );
  });

  it.each([0, 2, 6, 8, 18])(
    'PBT: round-trip JSON de Money a escala %i conserva el string exacto',
    (scale) => {
      const cur = currency(`T${scale}X`, scale);
      fc.assert(
        fc.property(fc.bigInt({ min: -(10n ** 19n), max: 10n ** 19n }), (units) => {
          const neg = units < 0n;
          const digits = (neg ? -units : units).toString().padStart(scale + 1, '0');
          const text = scale === 0 ? digits : `${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
          const money = Money.parse(`${neg ? '-' : ''}${text}`, cur);
          const stored = JSON.parse(JSON.stringify(toAuditValue(money))) as {
            amount: string;
            currency: string;
          };
          expect(typeof stored.amount).toBe('string');
          expect(stored).toEqual({ amount: money.toFixed(), currency: cur.code });
          expect(Money.parse(stored.amount, cur).equals(money)).toBe(true);
        }),
        { numRuns: 200 },
      );
    },
  );
});
