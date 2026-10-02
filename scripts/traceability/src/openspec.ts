import { execFile } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { normalizeName, toPosix, walkFiles } from './fs-utils.js';
import type { Operation, Priority, Requirement } from './types.js';

const execFileAsync = promisify(execFile);

export type OpenSpecMode = 'auto' | 'cli' | 'markdown';

export interface ParsedRequirement {
  name: string;
  operation: Operation;
  priority: Priority | null;
  trace: string[];
  scenarios: string[];
}

const TRACE_LINE = /^\s*Trace:\s*(.*?)\s*·\s*Priority:\s*(Must|Should|Could)\s*$/m;
const TRACE_ID = /\b(?:FR|NFR)-[A-Z]+-\d{3}\b/g;

/** Lee la línea `Trace: <FR/NFR ids> · Priority: Must|Should|Could` (docs/03 §5). */
export function parseTrace(text: string): { trace: string[]; priority: Priority | null } {
  const match = TRACE_LINE.exec(text);
  if (!match) return { trace: [], priority: null };
  return { trace: (match[1] ?? '').match(TRACE_ID) ?? [], priority: match[2] as Priority };
}

/** Parser Markdown de una spec principal (`## Requirements`) o de un delta (`## ADDED|MODIFIED|REMOVED|RENAMED Requirements`). */
export function parseSpecMarkdown(content: string): ParsedRequirement[] {
  const out: ParsedRequirement[] = [];
  let operation: Operation | null = null;
  let current: (ParsedRequirement & { body: string[] }) | null = null;
  const flush = () => {
    if (!current) return;
    const { body, ...rest } = current;
    out.push({ ...rest, ...parseTrace(body.join('\n')) });
    current = null;
  };
  for (const line of content.split(/\r?\n/)) {
    const section = /^##\s+(?:(ADDED|MODIFIED|REMOVED|RENAMED)\s+)?Requirements\s*$/.exec(line);
    if (section) {
      flush();
      operation = (section[1] as Operation | undefined) ?? 'SPEC';
      continue;
    }
    if (/^##\s/.test(line)) {
      flush();
      operation = null;
      continue;
    }
    const req = /^###\s+Requirement:\s*(.+?)\s*$/.exec(line);
    if (req && operation) {
      flush();
      current = { name: req[1] ?? '', operation, priority: null, trace: [], scenarios: [], body: [] };
      continue;
    }
    if (!current) continue;
    const scenario = /^####\s+Scenario:\s*(.+?)\s*$/.exec(line);
    if (scenario) {
      (current as ParsedRequirement).scenarios.push(scenario[1] ?? '');
      continue;
    }
    if ((current as ParsedRequirement).scenarios.length === 0)
      (current as { body: string[] }).body.push(line);
  }
  flush();
  return out;
}

interface SpecSource {
  /** Capability path (`<context>/<capability>`). */
  spec: string;
  /** Archivo spec.md, relativo a la raíz con `/`. */
  file: string;
  /** Change activo al que pertenece; null si es una spec principal. */
  change: string | null;
}

/** Changes activos (excluye `archive/`) y specs principales. */
function discoverSources(root: string): SpecSource[] {
  const sources: SpecSource[] = [];
  const changesDir = join(root, 'openspec', 'changes');
  if (existsSync(changesDir)) {
    for (const entry of readdirSync(changesDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === 'archive') continue;
      const specsDir = join(changesDir, entry.name, 'specs');
      for (const abs of walkFiles(specsDir).filter((f) => f.endsWith('spec.md'))) {
        sources.push({ spec: toPosix(specsDir, dirname(abs)), file: toPosix(root, abs), change: entry.name });
      }
    }
  }
  const specsDir = join(root, 'openspec', 'specs');
  for (const abs of walkFiles(specsDir).filter((f) => f.endsWith('spec.md'))) {
    sources.push({ spec: toPosix(specsDir, dirname(abs)), file: toPosix(root, abs), change: null });
  }
  return sources;
}

/** Busca el bin del CLI de OpenSpec fijado como devDependency raíz, subiendo desde `start`. */
export function findOpenSpecBin(...starts: string[]): string | null {
  for (const start of starts) {
    let dir = start;
    for (;;) {
      const pkg = join(dir, 'node_modules', '@fission-ai', 'openspec', 'package.json');
      if (existsSync(pkg)) {
        const json = JSON.parse(readFileSync(pkg, 'utf8')) as { bin?: string | Record<string, string> };
        const bin = typeof json.bin === 'string' ? json.bin : json.bin?.['openspec'];
        if (bin) return join(dirname(pkg), bin);
      }
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return null;
}

interface CliRequirement {
  name: string;
  text: string;
  scenarios?: { name: string }[];
}

async function runOpenSpec(bin: string, root: string, args: string[]): Promise<unknown> {
  const { stdout } = await execFileAsync(process.execPath, [bin, ...args, '--json', '--no-interactive'], {
    cwd: root,
    maxBuffer: 64 * 1024 * 1024,
    env: {
      ...process.env,
      OPENSPEC_TELEMETRY: '0',
      DO_NOT_TRACK: '1',
      OPENSPEC_NO_UPDATE_CHECK: '1',
      NO_COLOR: '1',
    },
  });
  const json = JSON.parse(stdout) as { status?: { severity: string; message: string }[] };
  const failure = json.status?.find((st) => st.severity === 'error');
  if (failure) throw new Error(`openspec ${args.join(' ')}: ${failure.message}`);
  return json;
}

const fromCli = (r: CliRequirement, operation: Operation): ParsedRequirement => ({
  name: r.name.trim(),
  operation,
  ...parseTrace(r.text),
  scenarios: (r.scenarios ?? []).map((s) => s.name.trim()),
});

/** Requirements por archivo vía `openspec show <change|spec> --json`. */
async function parseWithCli(
  root: string,
  sources: SpecSource[],
  bin: string,
  strict: boolean,
): Promise<Map<string, ParsedRequirement[]>> {
  // En modo auto, si el CLI falla para un change/spec, esas fuentes quedan con el parseo Markdown.
  const tolerate = async (task: () => Promise<void>) => {
    try {
      await task();
    } catch (e) {
      if (strict) throw e;
    }
  };
  const byFile = new Map<string, ParsedRequirement[]>();
  const changes = [...new Set(sources.filter((s) => s.change).map((s) => s.change as string))];
  const specs = sources.filter((s) => !s.change);
  await Promise.all([
    ...changes.map((change) =>
      tolerate(async () => {
        const json = (await runOpenSpec(bin, root, ['show', change, '--type', 'change'])) as {
          deltas?: {
            spec: string;
            operation: Operation;
            requirement?: CliRequirement;
            requirements?: CliRequirement[];
          }[];
        };
        for (const delta of json.deltas ?? []) {
          const source = sources.find((s) => s.change === change && s.spec === delta.spec);
          if (!source) continue;
          const list = byFile.get(source.file) ?? [];
          const reqs = delta.requirements ?? (delta.requirement ? [delta.requirement] : []);
          list.push(...reqs.map((r) => fromCli(r, delta.operation)));
          byFile.set(source.file, list);
        }
      }),
    ),
    ...specs.map((source) =>
      tolerate(async () => {
        const json = (await runOpenSpec(bin, root, ['show', source.spec, '--type', 'spec'])) as {
          requirements?: CliRequirement[];
        };
        byFile.set(
          source.file,
          (json.requirements ?? []).map((r) => fromCli(r, 'SPEC')),
        );
      }),
    ),
  ]);
  return byFile;
}

export interface LoadRequirementsOptions {
  root: string;
  /** `auto` (default): CLI de OpenSpec si está instalado, si no Markdown. */
  openspec?: OpenSpecMode;
}

/**
 * Requirements vigentes: specs principales + deltas de changes activos (Phase 1: todos los changes activos).
 * Los requirements REMOVED se descartan. Si el JSON del CLI no trae la línea Trace/Priority o los scenarios
 * de un requirement, se completa con el parseo Markdown del mismo archivo.
 */
export async function loadRequirements({
  root,
  openspec = 'auto',
}: LoadRequirementsOptions): Promise<Requirement[]> {
  const sources = discoverSources(root);
  const markdown = new Map(
    sources.map((s) => [s.file, parseSpecMarkdown(readFileSync(join(root, s.file), 'utf8'))]),
  );

  let parsed = markdown;
  if (openspec !== 'markdown') {
    const bin = findOpenSpecBin(root, dirname(fileURLToPath(import.meta.url)));
    if (!bin && openspec === 'cli')
      throw new Error('No se encontró el CLI de OpenSpec (@fission-ai/openspec).');
    if (bin && sources.length > 0) {
      const viaCli = await parseWithCli(root, sources, bin, openspec === 'cli');
      parsed = new Map(
        sources.map((s) => {
          const md = markdown.get(s.file) ?? [];
          const cli = viaCli.get(s.file) ?? md;
          return [
            s.file,
            cli.map((r) => {
              const fallback = md.find((m) => normalizeName(m.name) === normalizeName(r.name));
              return {
                ...r,
                priority: r.priority ?? fallback?.priority ?? null,
                trace: r.trace.length > 0 ? r.trace : (fallback?.trace ?? []),
                scenarios: r.scenarios.length > 0 ? r.scenarios : (fallback?.scenarios ?? []),
              };
            }),
          ];
        }),
      );
    }
  }

  const byKey = new Map<string, Requirement>();
  const removed = new Set<string>();
  const declaredByChange = new Set<string>();
  for (const source of sources) {
    for (const r of parsed.get(source.file) ?? []) {
      const key = `${source.spec}#${normalizeName(r.name)}`;
      if (r.operation === 'REMOVED') {
        removed.add(key);
        continue;
      }
      if (r.operation === 'RENAMED') continue;
      if (source.change) declaredByChange.add(key);
      const existing = byKey.get(key);
      if (!existing) {
        byKey.set(key, {
          spec: source.spec,
          name: r.name,
          priority: r.priority,
          trace: [...r.trace],
          scenarios: [...r.scenarios],
          sources: [source.file],
        });
        continue;
      }
      // Mismo requirement en varias fuentes (spec principal + MODIFIED): se unen scenarios y trazas.
      existing.priority = r.priority ?? existing.priority;
      for (const t of r.trace) if (!existing.trace.includes(t)) existing.trace.push(t);
      for (const s of r.scenarios) {
        if (!existing.scenarios.some((e) => normalizeName(e) === normalizeName(s)))
          existing.scenarios.push(s);
      }
      existing.sources.push(source.file);
    }
  }
  // REMOVED retira el requirement de la spec principal salvo que otro change activo lo vuelva a declarar.
  for (const key of removed) if (!declaredByChange.has(key)) byKey.delete(key);
  return [...byKey.values()];
}
