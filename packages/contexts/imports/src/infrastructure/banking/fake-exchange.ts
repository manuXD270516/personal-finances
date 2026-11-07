import { waitFor } from '../../domain/banking/budget.js';
import {
  ProviderCallError,
  type CredentialPermissions,
  type ExternalAsset,
  type ExternalRecord,
  type ExternalRecordType,
  type ProviderDescriptor,
} from '../../domain/index.js';
import type {
  BankingProvider,
  FileHistoryProvider,
  FetchWindow,
  ProviderCallContext,
  ProviderHttpResponse,
  RecordsPage,
} from '../../application/banking/ports.js';
import type { ProviderTransport } from './provider-http.js';

/**
 * Proveedor simulado `FAKE_EXCHANGE` (openspec add-banking-providers decisión 10): cubre TODO el comportamiento en CI
 * sin red. Prohibido en staging y producción (el registro falla al arrancar). Habla con un servidor simulado
 * (`FakeExchangeBackend`) a través del MISMO cliente con allowlist que usarán los adapters reales, así la suite
 * ejercita la lista de hosts, las redirecciones y el contenido de las solicitudes.
 */

export const FAKE_HOST = 'fake-exchange.test';

export const FAKE_EXCHANGE_DESCRIPTOR: ProviderDescriptor = {
  id: 'FAKE_EXCHANGE',
  kind: 'FAKE',
  displayName: 'Exchange simulado (solo pruebas)',
  exchange: 'FAKE',
  capabilities: ['TRADES', 'DEPOSITS', 'WITHDRAWALS', 'REWARDS'],
  credentialMode: 'API_KEY_SECRET',
  allowedHosts: [FAKE_HOST],
  termsStatus: 'VERIFIED',
  termsAdr: 'n/a (proveedor simulado)',
  termsVerifiedAt: '2026-11-04',
  formatStatus: 'NOT_APPLICABLE',
  attribution: null,
};

export const READ_ONLY: CredentialPermissions = {
  read: true,
  trade: false,
  withdraw: false,
  transfer: false,
  ipRestricted: null,
};

export interface FakeRequest {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
}

interface Failure {
  readonly status: number;
  readonly retryAfter?: string;
  readonly location?: string;
}

/** Servidor simulado: registros por ventana, páginas, permisos y fallas programadas. */
export class FakeExchangeBackend {
  constructor(public records: ExternalRecord[] = []) {}

  pageSize = 2;
  permissions: CredentialPermissions = READ_ONLY;
  assets: string[] = ['USDT', 'BTC'];
  /** Cuando es `true` responde 401 (clave borrada o inválida). */
  rejectCredential = false;
  readonly requests: FakeRequest[] = [];
  /** Falla programada por índice de página (0-based) de `/history`; se consume una vez. */
  private readonly failures = new Map<number, Failure>();
  private historyRequests = 0;

  failOnPage(page: number, failure: Failure): void {
    this.failures.set(page, failure);
  }

  readonly transport: ProviderTransport = async (url, headers) => {
    this.requests.push({ url: url.href, headers });
    return this.respond(url);
  };

  private respond(url: URL): ProviderHttpResponse {
    const json = (
      status: number,
      body: unknown,
      extra: Record<string, string> = {},
    ): ProviderHttpResponse => ({
      status,
      headers: { 'content-type': 'application/json', ...extra },
      body: JSON.stringify(body),
    });
    if (this.rejectCredential) return json(401, { error: 'invalid key' });
    if (url.pathname === '/v1/permissions') return json(200, this.permissions);
    if (url.pathname === '/v1/assets') return json(200, { assets: this.assets });
    if (url.pathname !== '/v1/history') return json(404, {});
    const from = url.searchParams.get('from') ?? '0000-00-00';
    const to = url.searchParams.get('to') ?? '9999-99-99';
    const cursor = url.searchParams.get('cursor');
    const page = cursor === null ? 0 : Number(cursor.replace(/^p/, ''));
    this.historyRequests += 1;
    const failure = this.failures.get(page);
    if (failure) {
      this.failures.delete(page);
      return json(
        failure.status,
        { error: 'scripted' },
        {
          ...(failure.retryAfter ? { 'retry-after': failure.retryAfter } : {}),
          ...(failure.location ? { location: failure.location } : {}),
        },
      );
    }
    // Ventana por fecha UTC del instante (inclusive en ambos extremos).
    const inWindow = this.records.filter(
      (r) => r.executedAt.slice(0, 10) >= from && r.executedAt.slice(0, 10) <= to,
    );
    const slice = inWindow.slice(page * this.pageSize, (page + 1) * this.pageSize);
    const hasMore = (page + 1) * this.pageSize < inWindow.length;
    return json(200, {
      records: slice.map((r) => ({
        type: r.type,
        id: r.externalId,
        time: r.executedAt,
        legs: r.legs.map((l) => ({ asset: l.asset, amount: l.amount, dir: l.direction })),
        fees: r.fees.map((f) => ({ asset: f.asset, amount: f.amount, kind: f.kind })),
        ...(r.quotedPrice ? { price: r.quotedPrice } : {}),
        note: r.description,
      })),
      next: hasMore ? `p${page + 1}` : null,
    });
  }

  get historyCalls(): number {
    return this.historyRequests;
  }
}

const RECORD_TYPES: readonly ExternalRecordType[] = [
  'TRADE',
  'DEPOSIT',
  'WITHDRAWAL',
  'FEE',
  'REWARD',
  'P2P',
  'OTHER',
];

const invalid = (what: string) =>
  new ProviderCallError('PROVIDER_PAYLOAD_INVALID', `invalid payload: ${what}`);
const text = (v: unknown, what: string): string => {
  if (typeof v !== 'string') throw invalid(what);
  return v;
};
/** Los montos SIEMPRE llegan como texto decimal exacto: un `number` JSON se rechaza (INV-001). */
const amountText = (v: unknown, what: string): string => {
  const s = text(v, what);
  if (!/^\d+(\.\d+)?$/.test(s)) throw invalid(what);
  return s;
};

export function parseFakeRecord(r: Record<string, unknown>): ExternalRecord {
  const type = text(r['type'], 'type') as ExternalRecordType;
  if (!RECORD_TYPES.includes(type)) throw invalid('type');
  const legs = (Array.isArray(r['legs']) ? r['legs'] : []) as Record<string, unknown>[];
  const fees = (Array.isArray(r['fees']) ? r['fees'] : []) as Record<string, unknown>[];
  const price = r['price'] as Record<string, unknown> | undefined;
  return {
    type,
    externalId: text(r['id'], 'id'),
    executedAt: text(r['time'], 'time'),
    legs: legs.map((l) => ({
      asset: text(l['asset'], 'asset'),
      amount: amountText(l['amount'], 'amount'),
      direction: l['dir'] === 'OUT' ? 'OUT' : 'IN',
    })),
    fees: fees.map((f) => ({
      asset: text(f['asset'], 'asset'),
      amount: amountText(f['amount'], 'amount'),
      kind: f['kind'] === 'NETWORK' ? 'NETWORK' : 'PROVIDER',
    })),
    ...(price
      ? {
          quotedPrice: {
            base: text(price['base'], 'base'),
            quote: text(price['quote'], 'quote'),
            price: amountText(price['price'], 'price'),
          },
        }
      : {}),
    description: typeof r['note'] === 'string' ? r['note'] : null,
    raw: {},
  };
}

export class FakeExchangeProvider implements BankingProvider {
  readonly descriptor = FAKE_EXCHANGE_DESCRIPTOR;

  private async call(ctx: ProviderCallContext, path: string, query: Record<string, string> = {}) {
    if (!ctx.credential) throw new ProviderCallError('PROVIDER_AUTH_REJECTED', 'no credential');
    const qs = new URLSearchParams(query).toString();
    const url = `https://${FAKE_HOST}${path}${qs ? `?${qs}` : ''}`;
    // Solo la credencial de ESTA conexión viaja en las cabeceras (nada del workspace, NFR-COMP-001).
    const res = await ctx.http.get(this.descriptor, url, {
      accept: 'application/json',
      'x-api-key': ctx.credential.keyId,
      'x-api-secret': ctx.credential.secret,
    });
    if (res.status === 401) throw new ProviderCallError('PROVIDER_AUTH_REJECTED', 'credential rejected');
    const wait = waitFor({ status: res.status, retryAfter: res.headers['retry-after'] ?? null });
    if (wait !== null) {
      throw new ProviderCallError(
        'PROVIDER_RATE_LIMITED',
        'rate limited',
        new Date(ctx.nowMs() + wait).toISOString(),
      );
    }
    if (res.status !== 200) throw new ProviderCallError('PROVIDER_UNAVAILABLE', `status ${res.status}`);
    try {
      return JSON.parse(res.body) as Record<string, unknown>;
    } catch {
      throw invalid('json');
    }
  }

  async verifyCredential(ctx: ProviderCallContext): Promise<CredentialPermissions> {
    const body = await this.call(ctx, '/v1/permissions');
    const bool = (k: string) => {
      if (typeof body[k] !== 'boolean') throw invalid(k);
      return body[k] as boolean;
    };
    return {
      read: bool('read'),
      trade: bool('trade'),
      withdraw: bool('withdraw'),
      transfer: bool('transfer'),
      ipRestricted: typeof body['ipRestricted'] === 'boolean' ? body['ipRestricted'] : null,
    };
  }

  async listAssets(ctx: ProviderCallContext): Promise<readonly ExternalAsset[]> {
    const body = await this.call(ctx, '/v1/assets');
    const assets = body['assets'];
    if (!Array.isArray(assets)) throw invalid('assets');
    return assets.map((a) => ({ asset: text(a, 'asset') }));
  }

  async *fetchRecords(
    ctx: ProviderCallContext,
    window: FetchWindow,
    cursor: string | null,
  ): AsyncIterable<RecordsPage> {
    let next = cursor;
    do {
      const body = await this.call(ctx, '/v1/history', {
        from: window.from,
        to: window.to,
        ...(next ? { cursor: next } : {}),
      });
      const raw = body['records'];
      if (!Array.isArray(raw)) throw invalid('records');
      const records = raw.map((r) => parseFakeRecord(r as Record<string, unknown>));
      next = typeof body['next'] === 'string' ? body['next'] : null;
      yield { records, nextCursor: next };
    } while (next !== null);
  }
}

/**
 * Historial sintético de ejemplo del proveedor simulado (local, CI y E2E): una compra de BTC con comisión en el activo
 * recibido, un depósito, un retiro con comisión de red, una recompensa y una orden P2P (que queda excluida). Datos
 * ficticios; fechas fijas dentro de la primera ventana de 365 días.
 */
export function sampleRecords(): ExternalRecord[] {
  const base = { fees: [] as ExternalRecord['fees'], description: null, raw: {} };
  return [
    {
      ...base,
      type: 'DEPOSIT',
      externalId: 'D-1001',
      executedAt: '2026-10-01T13:00:00.000Z',
      legs: [{ asset: 'USDT', amount: '1200.000000', direction: 'IN' }],
    },
    {
      ...base,
      type: 'TRADE',
      externalId: 'T-1001',
      executedAt: '2026-10-02T15:30:00.000Z',
      legs: [
        { asset: 'USDT', amount: '975.000000', direction: 'OUT' },
        { asset: 'BTC', amount: '0.01500000', direction: 'IN' },
      ],
      fees: [{ asset: 'BTC', amount: '0.00001500', kind: 'PROVIDER' }],
      quotedPrice: { base: 'BTC', quote: 'USDT', price: '65000.00' },
    },
    {
      ...base,
      type: 'WITHDRAWAL',
      externalId: 'W-1001',
      executedAt: '2026-10-03T12:00:00.000Z',
      legs: [{ asset: 'USDT', amount: '200.000000', direction: 'OUT' }],
      fees: [{ asset: 'USDT', amount: '1.000000', kind: 'NETWORK' }],
    },
    {
      ...base,
      type: 'REWARD',
      externalId: 'R-1001',
      executedAt: '2026-10-04T08:00:00.000Z',
      legs: [{ asset: 'USDT', amount: '1.500000', direction: 'IN' }],
      description: 'Staking',
    },
    {
      ...base,
      type: 'P2P',
      externalId: 'P-1001',
      executedAt: '2026-10-05T10:00:00.000Z',
      legs: [{ asset: 'USDT', amount: '100.000000', direction: 'OUT' }],
    },
  ];
}

export const FAKE_EXCHANGE_FILE_DESCRIPTOR: ProviderDescriptor = {
  id: 'FAKE_EXCHANGE_FILE',
  kind: 'FAKE',
  displayName: 'Archivo de historial simulado (solo pruebas)',
  exchange: 'FAKE',
  capabilities: ['TRADES', 'DEPOSITS', 'WITHDRAWALS', 'REWARDS'],
  credentialMode: 'NONE',
  allowedHosts: [],
  termsStatus: 'VERIFIED',
  termsAdr: 'n/a (proveedor simulado)',
  termsVerifiedAt: '2026-11-04',
  formatStatus: 'VERIFIED',
  attribution: null,
};

/**
 * Archivo de historial simulado: JSON `{ schema: 'pfos.fake-exchange-history', version: 1, records: [...] }` con los
 * mismos registros que la API simulada (mismo namespace de referencias). Los formatos REALES de Binance y Bybit llegan
 * con las muestras del owner (grupo 9); hasta entonces un archivo que no coincide con un formato verificado se rechaza.
 */
export class FakeExchangeFileProvider implements FileHistoryProvider {
  readonly descriptor = FAKE_EXCHANGE_FILE_DESCRIPTOR;

  parse(bytes: Uint8Array): readonly ExternalRecord[] | null {
    let doc: unknown;
    try {
      doc = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    } catch {
      return null;
    }
    if (typeof doc !== 'object' || doc === null) return null;
    const d = doc as Record<string, unknown>;
    if (d['schema'] !== 'pfos.fake-exchange-history' || d['version'] !== 1 || !Array.isArray(d['records'])) {
      return null;
    }
    try {
      return d['records'].map((r) => parseFakeRecord(r as Record<string, unknown>));
    } catch {
      return null;
    }
  }
}
