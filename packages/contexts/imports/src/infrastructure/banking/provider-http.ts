import { request as httpsRequest } from 'node:https';
import type { ProviderHttp, ProviderHttpResponse } from '../../application/banking/ports.js';
import { ProviderCallError, type ProviderDescriptor } from '../../domain/index.js';

/**
 * Cliente HTTP de proveedores con allowlist por descriptor (openspec add-banking-providers decisiones 2 y 7;
 * NFR-COMP-001, NFR-SEC-015). Solo `GET` por `https` a los hosts del descriptor, con la URL ya construida por el
 * adapter (query fija: ventana y cursor) y las cabeceras que este fija (la credencial de ESA conexión), sin cookies.
 * Una redirección solo se sigue si apunta a otro host PERMITIDO por `https`; cualquier otra se bloquea ANTES de enviar
 * nada (la credencial nunca llega a un host fuera de la lista).
 */

export const MAX_REDIRECTS = 3;
const MAX_BODY_BYTES = 4 * 1024 * 1024;

export type ProviderTransport = (
  url: URL,
  headers: Readonly<Record<string, string>>,
  timeoutMs: number,
) => Promise<ProviderHttpResponse>;

/** Transporte real sobre `node:https` (sin seguir redirecciones: lo decide `AllowlistedProviderHttp`). */
export const nodeHttpsTransport: ProviderTransport = (url, headers, timeoutMs) =>
  new Promise((resolve, reject) => {
    const req = httpsRequest(url, { method: 'GET', headers: { ...headers }, agent: false }, (res) => {
      const chunks: Buffer[] = [];
      let size = 0;
      res.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_BODY_BYTES) {
          req.destroy(new ProviderCallError('PROVIDER_PAYLOAD_INVALID', 'response body too large'));
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => {
        const flat: Record<string, string> = {};
        for (const [k, v] of Object.entries(res.headers)) {
          if (v !== undefined) flat[k] = Array.isArray(v) ? v.join(', ') : v;
        }
        resolve({ status: res.statusCode ?? 0, headers: flat, body: Buffer.concat(chunks).toString('utf8') });
      });
      res.on('error', reject);
    });
    req.setTimeout(timeoutMs, () =>
      req.destroy(new ProviderCallError('PROVIDER_UNAVAILABLE', `no response within ${timeoutMs} ms`)),
    );
    req.on('error', reject);
    req.end();
  });

export class AllowlistedProviderHttp implements ProviderHttp {
  constructor(
    private readonly transport: ProviderTransport = nodeHttpsTransport,
    private readonly timeoutMs = 15_000,
  ) {}

  async get(
    descriptor: ProviderDescriptor,
    rawUrl: string,
    headers: Readonly<Record<string, string>>,
  ): Promise<ProviderHttpResponse> {
    let url = this.assertAllowed(descriptor, rawUrl);
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      const response = await this.transport(url, headers, this.timeoutMs);
      if (response.status < 300 || response.status >= 400) return response;
      const location = response.headers['location'] ?? response.headers['Location'];
      if (!location) {
        throw new ProviderCallError('PROVIDER_UNAVAILABLE', 'redirect without a location');
      }
      // Valida el destino ANTES de enviar nada: un host fuera de la lista no recibe la solicitud ni la credencial.
      url = this.assertAllowed(descriptor, new URL(location, url).href);
    }
    throw new ProviderCallError('PROVIDER_UNAVAILABLE', 'too many redirects');
  }

  private assertAllowed(descriptor: ProviderDescriptor, rawUrl: string): URL {
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      throw new ProviderCallError('PROVIDER_HOST_NOT_ALLOWED', 'invalid provider URL');
    }
    if (
      url.protocol !== 'https:' ||
      url.username !== '' ||
      url.password !== '' ||
      !descriptor.allowedHosts.includes(url.hostname)
    ) {
      throw new ProviderCallError('PROVIDER_HOST_NOT_ALLOWED', `host not allowed: ${url.hostname}`);
    }
    return url;
  }
}
