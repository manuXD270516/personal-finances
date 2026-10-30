import { deflateRawSync } from 'node:zlib';

/** Constructor de libros XLSX SINTETICOS para pruebas (no se versionan binarios). Solo lo que el lector necesita. */

const CRC_TABLE = (() => {
  const table: number[] = [];
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table.push(c >>> 0);
  }
  return table;
})();

function crc32(data: Buffer): number {
  let c = 0xffffffff;
  for (const byte of data) c = (CRC_TABLE[(c ^ byte) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function zip(files: Readonly<Record<string, string>>): Uint8Array {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const raw = Buffer.from(text, 'utf8');
    const data = deflateRawSync(raw);
    const nameBytes = Buffer.from(name, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc32(raw), 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc32(raw), 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, data);
    centrals.push(central, nameBytes);
    offset += local.length + nameBytes.length + data.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(Object.keys(files).length, 8);
  eocd.writeUInt16LE(Object.keys(files).length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, centralBuf, eocd]));
}

export type SyntheticCell =
  | { readonly kind: 'text'; readonly value: string }
  | { readonly kind: 'number'; readonly value: string }
  | { readonly kind: 'formula'; readonly formula: string; readonly cached: string }
  | { readonly kind: 'date'; readonly serial: string };

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const colName = (i: number) => String.fromCharCode(65 + i);

/** Libro de una hoja: las celdas de texto van como cadenas compartidas; `date` usa el estilo 1 (formato de fecha). */
export function buildXlsx(
  sheetName: string,
  rows: readonly (readonly (SyntheticCell | null)[])[],
): Uint8Array {
  const shared: string[] = [];
  const sharedIndex = (text: string) => {
    const at = shared.indexOf(text);
    if (at >= 0) return at;
    shared.push(text);
    return shared.length - 1;
  };
  const sheetRows = rows
    .map((cells, r) => {
      const xml = cells
        .map((cell, c) => {
          if (cell === null) return '';
          const ref = `${colName(c)}${r + 1}`;
          if (cell.kind === 'text') return `<c r="${ref}" t="s"><v>${sharedIndex(cell.value)}</v></c>`;
          if (cell.kind === 'number') return `<c r="${ref}"><v>${cell.value}</v></c>`;
          if (cell.kind === 'date') return `<c r="${ref}" s="1"><v>${cell.serial}</v></c>`;
          return `<c r="${ref}"><f>${esc(cell.formula)}</f><v>${cell.cached}</v></c>`;
        })
        .join('');
      return `<row r="${r + 1}">${xml}</row>`;
    })
    .join('');
  return zip({
    '[Content_Types].xml': '<?xml version="1.0"?><Types/>',
    'xl/workbook.xml': `<?xml version="1.0"?><workbook xmlns:r="r"><sheets><sheet name="${esc(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels':
      '<?xml version="1.0"?><Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/styles.xml':
      '<?xml version="1.0"?><styleSheet><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>',
    'xl/sharedStrings.xml': `<?xml version="1.0"?><sst>${shared.map((s) => `<si><t>${esc(s)}</t></si>`).join('')}</sst>`,
    'xl/worksheets/sheet1.xml': `<?xml version="1.0"?><worksheet><sheetData>${sheetRows}</sheetData></worksheet>`,
  });
}
