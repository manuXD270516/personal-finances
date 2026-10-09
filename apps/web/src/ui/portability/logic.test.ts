import { describe, expect, it } from 'vitest';
import {
  MAX_IMPORT_BYTES,
  canDownload,
  checkImportFile,
  exportInProgress,
  filenameFrom,
  formatBytes,
  importInProgress,
  importStep,
  needsReauth,
  reauthUrl,
} from './logic';

describe('portabilidad del workspace: lógica de UI', () => {
  it('estados de export y de importación', () => {
    expect(exportInProgress({ status: 'RUNNING' })).toBe(true);
    expect(exportInProgress({ status: 'READY' })).toBe(false);
    expect(canDownload({ status: 'READY' })).toBe(true);
    expect(canDownload({ status: 'EXPIRED' })).toBe(false);
    expect(canDownload({ status: 'DISCARDED' })).toBe(false);
    expect(importInProgress(null)).toBe(false);
    expect(importInProgress({ status: 'IMPORTING' })).toBe(true);
    expect(importInProgress({ status: 'FAILED' })).toBe(false);
    expect(importStep('RECEIVED')).toBe(1);
    expect(importStep('VERIFYING')).toBe(4);
    expect(importStep('SUCCEEDED')).toBe(4);
  });

  it('la reautenticación se pide solo ante REAUTHENTICATION_REQUIRED y fuerza el login', () => {
    expect(needsReauth({ code: 'REAUTHENTICATION_REQUIRED' })).toBe(true);
    expect(needsReauth({ code: 'INSUFFICIENT_ROLE' })).toBe(false);
    expect(needsReauth(undefined)).toBe(false);
    expect(reauthUrl('/configuracion')).toBe('/api/bff/auth/login?reauth=1&returnTo=%2Fconfiguracion');
  });

  it('nombre de archivo solo con caracteres seguros', () => {
    expect(filenameFrom('attachment; filename="pfos-export-abc-2026-10-09.zip"', 'x.zip')).toBe(
      'pfos-export-abc-2026-10-09.zip',
    );
    expect(filenameFrom('attachment; filename="../../etc/passwd"', 'x.zip')).toBe('x.zip');
    expect(filenameFrom(null, 'x.zip')).toBe('x.zip');
  });

  it('validación local del archivo a importar', () => {
    expect(checkImportFile({ name: 'a.zip', size: 10 })).toBe('ok');
    expect(checkImportFile({ name: 'a.zip', size: 0 })).toBe('empty');
    expect(checkImportFile({ name: 'a.zip', size: MAX_IMPORT_BYTES + 1 })).toBe('tooLarge');
    expect(checkImportFile({ name: 'a.txt', size: 10 })).toBe('notZip');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KiB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MiB');
  });
});
