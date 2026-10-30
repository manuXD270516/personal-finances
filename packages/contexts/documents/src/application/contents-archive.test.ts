import { describe, expect, it } from 'vitest';
import { ContentsArchiveError, readArchive, writeArchive, type ArchiveEntry } from './contents-archive.js';

// Formato del archivo de contenidos del export (openspec add-document-attachments, tarea 8.2; TC-DOCUMENTS-ATTACH-024).
const AT = new Date('2026-10-29T14:00:00.000Z');
const LIMITS = { maxEntries: 10, maxEntryBytes: 1024, maxTotalBytes: 4096 };

async function* of(...entries: ArchiveEntry[]): AsyncGenerator<ArchiveEntry> {
  for (const e of entries) yield e;
}
async function build(...entries: ArchiveEntry[]): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of writeArchive(of(...entries), AT)) chunks.push(c);
  return Buffer.concat(chunks);
}
async function* chunked(buf: Buffer, size: number): AsyncGenerator<Buffer> {
  for (let i = 0; i < buf.length; i += size) yield buf.subarray(i, i + size);
}
async function readAll(source: AsyncIterable<Buffer>, limits = LIMITS): Promise<ArchiveEntry[]> {
  const out: ArchiveEntry[] = [];
  for await (const e of readArchive(source, limits)) out.push(e);
  return out;
}

describe('archivo de contenidos (ZIP secuencial)', () => {
  it('[TC-DOCUMENTS-ATTACH-024] escribir y leer devuelve las mismas entradas, aun con el flujo en trozos de 7 bytes', async () => {
    const a = { name: 'documents-manifest.json', data: Buffer.from('{"formatVersion":1}') };
    const b = { name: 'documents/0193a000-0000-7000-8000-000000000001', data: Buffer.alloc(300, 9) };
    const empty = { name: 'documents/vacio', data: Buffer.alloc(0) };
    const zip = await build(a, b, empty);
    const read = await readAll(chunked(zip, 7));
    expect(read.map((e) => e.name)).toEqual([a.name, b.name, empty.name]);
    expect(read[1]?.data.equals(b.data)).toBe(true);
    expect(read[2]?.data.length).toBe(0);
  });

  it('[TC-DOCUMENTS-ATTACH-024] el directorio central termina el recorrido y es un ZIP estándar (firma de fin de directorio)', async () => {
    const zip = await build({ name: 'a', data: Buffer.from('x') });
    expect(zip.readUInt32LE(0)).toBe(0x04034b50);
    expect(zip.readUInt32LE(zip.length - 22)).toBe(0x06054b50);
    expect((await readAll(chunked(zip, 64))).length).toBe(1);
  });

  it('[TC-DOCUMENTS-ATTACH-025] un byte alterado en el contenido falla por CRC-32', async () => {
    const zip = await build({ name: 'documents/x', data: Buffer.from('contenido original') });
    const tampered = Buffer.from(zip);
    const at = 30 + 'documents/x'.length + 3;
    tampered[at] = (tampered[at] ?? 0) ^ 0xff;
    await expect(readAll(chunked(tampered, 16))).rejects.toThrow(ContentsArchiveError);
  });

  it('[TC-DOCUMENTS-ATTACH-025] un archivo truncado, uno que no es ZIP y los nombres inseguros o repetidos se rechazan', async () => {
    const zip = await build(
      { name: 'a', data: Buffer.from('hola') },
      { name: 'b', data: Buffer.from('mundo') },
    );
    await expect(readAll(chunked(zip.subarray(0, 40), 16))).rejects.toThrow(/truncated/u);
    await expect(readAll(chunked(Buffer.from('no soy un zip'), 4))).rejects.toThrow(ContentsArchiveError);
    await expect(
      readAll(chunked(await build({ name: '../fuera', data: Buffer.from('x') }), 16)),
    ).rejects.toThrow(/invalid entry name/u);
    await expect(
      readAll(
        chunked(
          await build({ name: 'a', data: Buffer.from('1') }, { name: 'a', data: Buffer.from('2') }),
          16,
        ),
      ),
    ).rejects.toThrow(/duplicate/u);
  });

  it('[TC-DOCUMENTS-ATTACH-025] los límites de entradas, tamaño por entrada y total se hacen cumplir antes de leer el contenido', async () => {
    const big = await build({ name: 'a', data: Buffer.alloc(2000) });
    await expect(readAll(chunked(big, 100))).rejects.toThrow(/entry too large/u);
    const three = await build(
      { name: 'a', data: Buffer.alloc(900) },
      { name: 'b', data: Buffer.alloc(900) },
      { name: 'c', data: Buffer.alloc(900) },
      { name: 'd', data: Buffer.alloc(900) },
      { name: 'e', data: Buffer.alloc(900) },
    );
    await expect(readAll(chunked(three, 512))).rejects.toThrow(/archive too large/u);
    const many = await build(
      ...Array.from({ length: 4 }, (_, i) => ({ name: `n${i}`, data: Buffer.from('x') })),
    );
    await expect(readAll(chunked(many, 64), { ...LIMITS, maxEntries: 3 })).rejects.toThrow(
      /too many entries/u,
    );
  });

  it('[TC-DOCUMENTS-ATTACH-024] los descriptores de datos y la compresión no se aceptan (lo que no escribe este formato)', async () => {
    const zip = await build({ name: 'a', data: Buffer.from('hola') });
    const withDescriptor = Buffer.from(zip);
    withDescriptor.writeUInt16LE(0x0808, 6);
    await expect(readAll(chunked(withDescriptor, 16))).rejects.toThrow(/not supported/u);
    const deflated = Buffer.from(zip);
    deflated.writeUInt16LE(8, 8);
    await expect(readAll(chunked(deflated, 16))).rejects.toThrow(/compression/u);
  });
});
