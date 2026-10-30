import { describe, expect, it } from 'vitest';
import {
  checkFile,
  contentTypeOf,
  downloadPath,
  formatBytes,
  quotaPercent,
  reasonKey,
  sha256Hex,
} from './logic';

describe('adjuntos: validación previa y utilidades (documents/attachments)', () => {
  it('[TC-DOCUMENTS-ATTACH-022] declara el tipo por la extensión de la lista permitida y rechaza el resto', () => {
    expect(contentTypeOf('Factura.PDF')).toBe('application/pdf');
    expect(contentTypeOf('foto.jpeg')).toBe('image/jpeg');
    expect(contentTypeOf('extracto.qfx')).toBe('application/x-ofx');
    expect(contentTypeOf('logo.svg')).toBeNull();
    expect(contentTypeOf('macro.xlsm')).toBeNull();
    expect(contentTypeOf('sin-extension')).toBeNull();
  });

  it('[TC-DOCUMENTS-ATTACH-022] valida vacío, tipo y tamaño por propósito antes de subir', () => {
    expect(checkFile({ name: 'a.pdf', size: 0 }, 'RECEIPT')).toBe('EMPTY');
    expect(checkFile({ name: 'a.svg', size: 10 }, 'RECEIPT')).toBe('TYPE');
    expect(checkFile({ name: 'a.pdf', size: 15_728_640 }, 'RECEIPT')).toBe('OK');
    expect(checkFile({ name: 'a.pdf', size: 15_728_641 }, 'RECEIPT')).toBe('TOO_LARGE');
    expect(checkFile({ name: 'a.csv', size: 19_922_944 }, 'IMPORT_SOURCE')).toBe('OK');
    expect(checkFile({ name: 'a.csv', size: 20_971_521 }, 'IMPORT_SOURCE')).toBe('TOO_LARGE');
  });

  it('[TC-DOCUMENTS-ATTACH-022] calcula el SHA-256 en el navegador', async () => {
    expect(await sha256Hex(new Blob(['abc']))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('formatea tamaños y la cuota en uso', () => {
    expect(formatBytes(482_133, 'es-BO')).toMatch(/^470[,.]8 KB$/u);
    expect(formatBytes(0)).toBe('0 B');
    expect(
      quotaPercent({
        usedBytes: 1_000,
        reservedBytes: 500,
        quotaBytes: 3_000,
        pendingUploads: 1,
        maxPendingUploads: 20,
      }),
    ).toBe(50);
    expect(
      quotaPercent({
        usedBytes: 9,
        reservedBytes: 0,
        quotaBytes: 0,
        pendingUploads: 0,
        maxPendingUploads: 20,
      }),
    ).toBe(0);
  });

  it('traduce los motivos de rechazo por clave; uno desconocido cae en el genérico', () => {
    expect(reasonKey('TYPE_MISMATCH')).toBe('reasons.TYPE_MISMATCH');
    expect(reasonKey('ALGO_NUEVO')).toBe('reasons.UNKNOWN');
    expect(reasonKey(null)).toBe('reasons.UNKNOWN');
  });

  it('la descarga va por el BFF (nunca por una URL del almacenamiento)', () => {
    expect(downloadPath('/api/bff/v1', 'w1', 'd1')).toBe('/api/bff/v1/workspaces/w1/documents/d1/download');
  });
});
