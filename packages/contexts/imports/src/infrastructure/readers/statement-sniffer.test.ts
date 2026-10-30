import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { sniffStatementFormat } from '../../domain/statement-sniffer.js';

const DIR = resolve(__dirname, '../../../../../../tests/fixtures/imports');
const bytes = (rel: string) => new Uint8Array(readFileSync(resolve(DIR, rel)));
const encode = (s: string) => new TextEncoder().encode(s);

describe('detección del formato por contenido', () => {
  it('[TC-IMPORTS-PIPELINE-011] elige el lector por el contenido y no por el nombre', () => {
    expect(sniffStatementFormat(bytes('qif/banco.qif'))?.format).toBe('QIF');
    expect(sniffStatementFormat(bytes('ofx/extracto-sgml.ofx'))?.format).toBe('OFX');
    expect(sniffStatementFormat(bytes('ofx/extracto-xml.ofx'))?.format).toBe('OFX');
    expect(sniffStatementFormat(bytes('json/valido.json'))?.format).toBe('JSON');
    expect(sniffStatementFormat(bytes('csv/banco-demo-perfil/input.csv'))?.format).toBe('CSV');
    // Un QIF que "se llama" .csv sigue siendo QIF.
    expect(sniffStatementFormat(encode('!Type:Bank\nD1/1/2026\nT-1.00\n^\n'))?.format).toBe('QIF');
  });

  it('[TC-IMPORTS-PIPELINE-012] un PDF o un binario desconocido no son importables', () => {
    expect(sniffStatementFormat(encode('%PDF-1.7\n1 0 obj\n'))).toBeNull();
    expect(sniffStatementFormat(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0]))).toBeNull();
    expect(sniffStatementFormat(new Uint8Array())).toBeNull();
  });
});
