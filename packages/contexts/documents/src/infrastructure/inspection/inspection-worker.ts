import { parentPort, workerData } from 'node:worker_threads';
import type { DocumentFormat } from '../../domain/types.js';
import { inspectContent, type InspectionConfig } from './inspect-content.js';

/**
 * Cuerpo del hilo aislado (design decisión 3): inspecciona un archivo y devuelve el veredicto. Corre con
 * `resourceLimits` y bajo un plazo en el hilo principal; si algo falla, el principal rechaza (falla cerrada). Solo
 * importa módulos relativos sin dependencias del workspace, para poder cargarse tal cual en el hilo.
 */
const input = workerData as {
  content: Uint8Array;
  declared: DocumentFormat;
  config: InspectionConfig;
};
const verdict = inspectContent(Buffer.from(input.content), input.declared, input.config);
parentPort?.postMessage(verdict);
