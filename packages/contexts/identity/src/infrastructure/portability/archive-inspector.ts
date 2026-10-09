import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DomainError } from '@pf/shared-kernel';
import { Ajv2020, type ValidateFunction } from 'ajv/dist/2020.js';
import addFormatsModule from 'ajv-formats';
import type { ArchiveInspector } from '../../application/portability/ports.js';
import { MANIFEST_FILE, parseExportManifest, type ExportManifest } from '../../domain/export-manifest.js';
import { ZipFormatError, ZipReader, DEFAULT_ZIP_LIMITS, type ZipLimits } from './zip.js';

// ajv-formats publica CommonJS con `module.exports = formatsPlugin` y `exports.default`.
const addFormats = ((addFormatsModule as unknown as { default?: unknown }).default ??
  addFormatsModule) as unknown as (ajv: Ajv2020) => Ajv2020;

const sha256Hex = (data: Buffer): string => createHash('sha256').update(data).digest('hex');
const corrupted = (detail: string) => new DomainError('EXPORT_FILE_CORRUPTED', `export file: ${detail}`);

export interface InspectedArchive {
  readonly manifest: ExportManifest;
  readonly reader: ZipReader;
}

/**
 * Validación del ZIP SIN escribir nada (openspec add-workspace-export, decisión 11): ZIP legible, `manifest.json`
 * presente y de un formato/versión soportados (no demo), cada archivo declarado presente con su SHA-256, y ningún archivo
 * extra. `sectionNames` son las secciones que el sistema sabe importar: una sección desconocida se rechaza (no se
 * descarta información en silencio).
 */
export function inspectArchive(
  zip: Buffer,
  sectionNames: ReadonlySet<string>,
  limits: ZipLimits = DEFAULT_ZIP_LIMITS,
): InspectedArchive {
  let reader: ZipReader;
  try {
    reader = ZipReader.open(zip, limits);
  } catch (err) {
    if (err instanceof ZipFormatError) throw corrupted(err.message);
    throw err;
  }
  if (!reader.has(MANIFEST_FILE)) throw corrupted('missing manifest.json');
  let raw: unknown;
  try {
    raw = JSON.parse(reader.read(MANIFEST_FILE).toString('utf8'));
  } catch (err) {
    if (err instanceof ZipFormatError || err instanceof SyntaxError)
      throw corrupted('unreadable manifest.json');
    throw err;
  }
  const manifest = parseExportManifest(raw);
  const expected = new Set<string>([MANIFEST_FILE]);
  try {
    for (const entry of [...manifest.sections, ...manifest.csv]) {
      expected.add(entry.file);
      if (!reader.has(entry.file)) throw corrupted(`missing ${entry.file}`);
      if (sha256Hex(reader.read(entry.file)) !== entry.sha256)
        throw corrupted(`checksum mismatch in ${entry.file}`);
    }
  } catch (err) {
    if (err instanceof ZipFormatError) throw corrupted(err.message);
    throw err;
  }
  for (const section of manifest.sections) {
    if (!sectionNames.has(section.name)) {
      throw new DomainError('EXPORT_FORMAT_UNSUPPORTED', `unknown section ${section.name}`);
    }
  }
  const extra = reader.names().filter((n) => !expected.has(n));
  if (extra.length > 0) throw corrupted('unexpected files in the archive');
  return { manifest, reader };
}

/** `ArchiveInspector` del servicio de importación (validación previa síncrona). */
export function archiveInspector(sectionNames: ReadonlySet<string>, limits?: ZipLimits): ArchiveInspector {
  return { inspect: (zip) => inspectArchive(zip, sectionNames, limits).manifest };
}

/** Validadores Ajv 2020-12 de los registros, compilados una vez desde `contracts/export/v1`. */
export class RecordValidators {
  private readonly ajv: Ajv2020;
  private readonly compiled = new Map<string, ValidateFunction>();

  constructor(private readonly schemaDir: string) {
    this.ajv = addFormats(new Ajv2020({ strict: false, allErrors: false }));
  }

  /** Valida un registro; devuelve `null` si cumple o un resumen SIN valores (puntero y regla) si no. */
  check(sectionName: string, record: unknown): string | null {
    let validate = this.compiled.get(sectionName);
    if (!validate) {
      const schema = JSON.parse(
        readFileSync(join(this.schemaDir, `${sectionName}.schema.json`), 'utf8'),
      ) as object;
      validate = this.ajv.compile(schema);
      this.compiled.set(sectionName, validate);
    }
    if (validate(record)) return null;
    const e = validate.errors?.[0];
    return e ? `${e.instancePath || '/'} ${e.keyword}` : 'invalid record';
  }
}
