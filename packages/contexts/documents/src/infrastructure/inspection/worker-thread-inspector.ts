import { Worker } from 'node:worker_threads';
import type { ContentInspector } from '../../application/ports/index.js';
import type { DocumentFormat, InspectionVerdict } from '../../domain/types.js';
import {
  DEFAULT_INSPECTION_CONFIG,
  NEEDS_ISOLATION,
  inspectContent,
  type InspectionConfig,
} from './inspect-content.js';

export interface WorkerInspectorOptions {
  readonly config?: InspectionConfig;
  /** Plazo de la inspección aislada (`DOCUMENT_INSPECTION_TIMEOUT`, `PT10S` por defecto). */
  readonly timeoutMs?: number;
  /** Tope del heap de V8 del hilo (`maxOldGenerationSizeMb`, 128 por defecto). */
  readonly maxOldGenerationSizeMb?: number;
}

const SELF = import.meta.url;
const FROM_SOURCE = SELF.endsWith('.ts');

/**
 * Inspección de PDF y XLSX en un `worker_thread` con límites de memoria y tiempo: un parser que se cuelga, agota la
 * memoria o falla deja el documento `REJECTED/MALFORMED_CONTENT` (falla cerrada) sin afectar al proceso de la API. El
 * resto de formatos (texto, imágenes) se inspecciona en línea: leen solo cabeceras o texto acotado. Sin consumidores
 * ni conexiones nuevas.
 */
export class WorkerThreadInspector implements ContentInspector {
  private readonly config: InspectionConfig;
  private readonly timeoutMs: number;
  private readonly maxOldGenerationSizeMb: number;

  constructor(options: WorkerInspectorOptions = {}) {
    this.config = options.config ?? DEFAULT_INSPECTION_CONFIG;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.maxOldGenerationSizeMb = options.maxOldGenerationSizeMb ?? 128;
  }

  inspect(content: Buffer, declared: DocumentFormat): Promise<InspectionVerdict> {
    if (!NEEDS_ISOLATION.includes(declared)) {
      return Promise.resolve(inspectContent(content, declared, this.config));
    }
    return new Promise((resolve) => {
      const file = new URL(`./inspection-worker${FROM_SOURCE ? '.ts' : '.js'}`, SELF);
      // Copia propia: el `Buffer` del llamador puede ser una vista de un ArrayBuffer compartido (pool).
      const copy = new Uint8Array(content.length);
      copy.set(content);
      let settled = false;
      const finish = (verdict: InspectionVerdict): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        void worker.terminate();
        resolve(verdict);
      };
      const worker = new Worker(file, {
        workerData: { content: copy, declared, config: this.config },
        transferList: [copy.buffer],
        resourceLimits: { maxOldGenerationSizeMb: this.maxOldGenerationSizeMb },
        // Desde fuentes (pruebas y desarrollo) el hilo carga TypeScript con tsx.
        execArgv: FROM_SOURCE ? ['--import', 'tsx'] : [],
      });
      const timer = setTimeout(() => finish({ ok: false, reason: 'MALFORMED_CONTENT' }), this.timeoutMs);
      worker.once('message', (verdict: InspectionVerdict) => finish(verdict));
      worker.once('error', () => finish({ ok: false, reason: 'MALFORMED_CONTENT' }));
      worker.once('exit', () => finish({ ok: false, reason: 'MALFORMED_CONTENT' }));
    });
  }
}
