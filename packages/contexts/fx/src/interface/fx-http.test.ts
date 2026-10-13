import 'reflect-metadata';
import { currency } from '@pf/shared-kernel';
import { describe, expect, it } from 'vitest';
import { ExchangeRate } from '../domain/index.js';
import { toFxRateDto } from './fx-http.js';

const USDT = currency('USDT', 6);
const BOB = currency('BOB', 2);

const observation = ExchangeRate.userConversionObservation({
  id: 'obs-1',
  workspaceId: 'ws',
  base: USDT,
  quote: BOB,
  value: '11.900000000000000000',
  executedAt: '2026-10-05T14:00:00Z',
  effectiveDate: '2026-10-05',
  conversion: { transactionId: 'tx-1', revision: 1 },
  createdAt: '2026-10-05T14:00:02Z',
});

describe('FxRate del contrato: observaciones de conversiones propias (D231)', () => {
  it('[TC-FX-USERCONV-004] la observación expone su origen, la conversión de origen y sin marca de anulada', () => {
    const dto = toFxRateDto({ rate: observation, supersededById: null, withdrawal: null });
    expect(dto).toMatchObject({
      source: 'USER_CONVERSION',
      rateType: 'CUSTOM',
      value: '11.9',
      conversionRef: { transactionId: 'tx-1', revision: 1 },
      withdrawn: null,
      sourceLabel: 'Conversión',
    });
  });

  it('[TC-FX-USERCONV-004] la observación anulada informa cuándo y por qué sin cambiar su valor', () => {
    const dto = toFxRateDto({
      rate: observation,
      supersededById: null,
      withdrawal: {
        rateId: 'obs-1',
        workspaceId: 'ws',
        transactionId: 'tx-1',
        reason: 'conversión anulada',
        withdrawnAt: '2026-10-06T10:00:00.000Z',
      },
    });
    expect(dto).toMatchObject({
      value: '11.9',
      withdrawn: { at: '2026-10-06T10:00:00.000Z', reason: 'conversión anulada' },
    });
  });

  it('una tasa manual no lleva conversionRef ni withdrawn', () => {
    const manual = ExchangeRate.record({
      id: 'm1',
      workspaceId: 'ws',
      base: USDT,
      quote: BOB,
      value: '12.00',
      rateType: 'P2P',
      asOf: '2026-10-05T13:00:00Z',
      effectiveDate: '2026-10-05',
      createdAt: '2026-10-05T13:00:00Z',
      createdBy: 'u1',
    });
    const dto = toFxRateDto({ rate: manual, supersededById: null });
    expect('conversionRef' in dto).toBe(false);
    expect('withdrawn' in dto).toBe(false);
  });
});
