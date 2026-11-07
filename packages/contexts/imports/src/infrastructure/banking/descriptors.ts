import type { ProviderDescriptor } from '../../domain/index.js';
import { FAKE_EXCHANGE_DESCRIPTOR, FAKE_EXCHANGE_FILE_DESCRIPTOR } from './fake-exchange.js';

/**
 * Catálogo de proveedores (openspec add-banking-providers decisión 10). Los cuatro adapters REALES (archivo y API de
 * Binance y Bybit) están declarados con `termsStatus = PENDING`: ninguno se ofrece ni se usa mientras el owner no
 * cumpla la puerta del grupo 9 (ADR-0031 aceptado, términos leídos, muestras y fixtures). ADR-0029 C4 sigue vigente
 * para los precios públicos. Para pasar a `VERIFIED` basta cambiar el estado, el ADR y la fecha de ESTE catálogo, con
 * su adapter y los fixtures; nada más del código depende de ello.
 */
const real = (
  over: Pick<ProviderDescriptor, 'id' | 'kind' | 'displayName' | 'exchange' | 'allowedHosts'> &
    Partial<ProviderDescriptor>,
): ProviderDescriptor => ({
  capabilities: ['TRADES', 'DEPOSITS', 'WITHDRAWALS'],
  credentialMode: over.kind === 'EXCHANGE_FILE' ? 'NONE' : 'API_KEY_SECRET',
  termsStatus: 'PENDING',
  termsAdr: null,
  termsVerifiedAt: null,
  formatStatus: over.kind === 'EXCHANGE_FILE' ? 'PENDING_SAMPLE' : 'NOT_APPLICABLE',
  attribution: null,
  ...over,
});

export const PROVIDER_DESCRIPTORS: readonly ProviderDescriptor[] = [
  real({
    id: 'EXCHANGE_FILE_BINANCE',
    kind: 'EXCHANGE_FILE',
    displayName: 'Binance (archivo de historial)',
    exchange: 'BINANCE',
    allowedHosts: [],
  }),
  real({
    id: 'EXCHANGE_FILE_BYBIT',
    kind: 'EXCHANGE_FILE',
    displayName: 'Bybit (archivo de historial)',
    exchange: 'BYBIT',
    allowedHosts: [],
  }),
  real({
    id: 'EXCHANGE_API_BINANCE',
    kind: 'EXCHANGE_API',
    displayName: 'Binance (API de solo lectura)',
    exchange: 'BINANCE',
    allowedHosts: ['api.binance.com'],
  }),
  real({
    id: 'EXCHANGE_API_BYBIT',
    kind: 'EXCHANGE_API',
    displayName: 'Bybit (API de solo lectura)',
    exchange: 'BYBIT',
    allowedHosts: ['api.bybit.com'],
  }),
  FAKE_EXCHANGE_DESCRIPTOR,
  FAKE_EXCHANGE_FILE_DESCRIPTOR,
];
