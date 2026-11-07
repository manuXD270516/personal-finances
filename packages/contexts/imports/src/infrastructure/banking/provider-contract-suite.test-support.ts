import { describe, expect, it } from 'vitest';
import type { BankingProvider, ProviderCallContext } from '../../application/banking/ports.js';
import type { ExternalRecord } from '../../domain/index.js';

/**
 * Suite de contrato COMÚN de los proveedores (openspec add-banking-providers decisión 2, TC-IMPORTS-BANKING-001): todo
 * proveedor, simulado o real, la pasa antes de habilitarse. Verifica ventana respetada, ids estables entre páginas,
 * cursor reanudable (cortar en la página k y reanudar entrega los mismos registros UNA vez), montos como texto decimal
 * exacto, nada fuera de `allowedHosts` y ningún dato del workspace en las solicitudes.
 */
export interface ContractFixtures {
  /** Registros que el servidor del proveedor debe devolver para `window`, en orden. */
  readonly expected: readonly ExternalRecord[];
  readonly window: { readonly from: string; readonly to: string };
  /** Contexto con la credencial de prueba y el cliente HTTP con allowlist. */
  readonly context: () => ProviderCallContext;
  /** Solicitudes capturadas hasta ahora (URL y cabeceras) del servidor del proveedor. */
  readonly requests: () => readonly {
    readonly url: string;
    readonly headers: Readonly<Record<string, string>>;
  }[];
  /** Textos que NUNCA deben aparecer en una solicitud (ids del workspace, nombres de cuentas, montos propios). */
  readonly forbiddenInRequests: readonly string[];
}

async function collect(
  provider: BankingProvider,
  fx: ContractFixtures,
  cursor: string | null,
  maxPages = Number.POSITIVE_INFINITY,
) {
  const pages: { records: readonly ExternalRecord[]; nextCursor: string | null }[] = [];
  for await (const page of provider.fetchRecords(fx.context(), fx.window, cursor)) {
    pages.push(page);
    if (pages.length >= maxPages) break;
  }
  return pages;
}

export function providerContractSuite(provider: BankingProvider, fx: ContractFixtures): void {
  describe(`Suite de contrato del proveedor ${provider.descriptor.id}`, () => {
    it('devuelve los registros de la ventana con ids estables', async () => {
      const pages = await collect(provider, fx, null);
      const records = pages.flatMap((p) => p.records);
      expect(records.map((r) => `${r.type}:${r.externalId}`)).toEqual(
        fx.expected.map((r) => `${r.type}:${r.externalId}`),
      );
      expect(new Set(records.map((r) => `${r.type}:${r.externalId}`)).size).toBe(records.length);
      for (const r of records) {
        const day = r.executedAt.slice(0, 10);
        expect(day >= fx.window.from && day <= fx.window.to).toBe(true);
      }
    });

    it('entrega los montos como texto decimal exacto, sin redondear', async () => {
      const records = (await collect(provider, fx, null)).flatMap((p) => p.records);
      for (const r of records) {
        for (const leg of r.legs) expect(leg.amount).toMatch(/^\d+(\.\d+)?$/);
        for (const fee of r.fees) expect(fee.amount).toMatch(/^\d+(\.\d+)?$/);
      }
      expect(records.map((r) => r.legs.map((l) => l.amount))).toEqual(
        fx.expected.map((r) => r.legs.map((l) => l.amount)),
      );
    });

    it('el cursor es reanudable: cortar en la página k y reanudar da los mismos registros una sola vez', async () => {
      const all = await collect(provider, fx, null);
      if (all.length < 2) return;
      for (let k = 1; k < all.length; k += 1) {
        const first = all.slice(0, k);
        const cursor = first[k - 1]?.nextCursor ?? null;
        expect(cursor).not.toBeNull();
        const rest = await collect(provider, fx, cursor);
        const ids = [...first, ...rest].flatMap((p) => p.records).map((r) => `${r.type}:${r.externalId}`);
        expect(ids).toEqual(all.flatMap((p) => p.records).map((r) => `${r.type}:${r.externalId}`));
      }
    });

    it('solo habla con sus hosts permitidos y sin datos del workspace', async () => {
      await collect(provider, fx, null);
      const requests = fx.requests();
      expect(requests.length).toBeGreaterThan(0);
      for (const r of requests) {
        expect(provider.descriptor.allowedHosts).toContain(new URL(r.url).hostname);
        const text = JSON.stringify(r);
        for (const forbidden of fx.forbiddenInRequests) expect(text).not.toContain(forbidden);
      }
    });

    it('verifica los permisos de la clave sin leer movimientos', async () => {
      const permissions = await provider.verifyCredential(fx.context());
      expect(typeof permissions.read).toBe('boolean');
      expect(typeof permissions.trade).toBe('boolean');
      expect(typeof permissions.withdraw).toBe('boolean');
      expect(typeof permissions.transfer).toBe('boolean');
    });
  });
}
