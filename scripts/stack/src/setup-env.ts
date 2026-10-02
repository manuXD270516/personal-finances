// pnpm setup:env [-- --force] [--apply-ports] [--check]
// Crea `.env` desde `.env.example` con secretos de desarrollo aleatorios y comprueba que los puertos PF_*_PORT
// estén libres (sugiere alternativas; con --apply-ports las escribe). Nunca imprime secretos.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from './lib/args.js';
import { log, runMain, UsageError, warn } from './lib/cli.js';
import { run } from './lib/compose.js';
import { interpolateEnv, parseEnvLines } from './lib/dotenv.js';
import { rawValues, renderEnv } from './lib/env-template.js';
import { ENV_EXAMPLE, composeProject, envFilePath } from './lib/paths.js';
import { inRanges, isPortFree, suggestPort, windowsExcludedPortRanges } from './lib/ports.js';

/** Puertos publicados por los contenedores del propio proyecto (ocupados "por nosotros": no son conflicto). */
async function ownPublishedPorts(project: string): Promise<Set<number>> {
  const result = await run(
    'docker',
    ['ps', '--filter', `label=com.docker.compose.project=${project}`, '--format', '{{.Ports}}'],
    { mode: 'capture' },
  ).catch(() => ({ code: 1, stdout: '', stderr: '' }));
  const ports = new Set<number>();
  for (const m of result.stdout.matchAll(/:(\d+)->/g)) ports.add(Number(m[1]));
  return ports;
}

runMain(async () => {
  const args = parseArgs(process.argv.slice(2));
  const force = args.flags.has('force');
  const applyPorts = args.flags.has('apply-ports');
  const checkOnly = args.flags.has('check');
  const envPath = envFilePath();
  const example = readFileSync(ENV_EXAMPLE, 'utf8');

  const existed = existsSync(envPath);
  const existing = existed && !force ? rawValues(readFileSync(envPath, 'utf8')) : new Map();
  let rendered = renderEnv(example, existing);

  // ── Puertos ──
  const env = interpolateEnv(parseEnvLines(rendered.text));
  const host = env['PF_BIND_ADDR'] || '127.0.0.1';
  const excluded = await windowsExcludedPortRanges();
  const own = await ownPublishedPorts(composeProject());
  const portKeys = Object.keys(env).filter((k) => /^PF_[A-Z0-9_]+_PORT$/.test(k));
  const taken = new Set(portKeys.map((k) => Number(env[k])));
  const overrides = new Map<string, string>();
  let conflicts = 0;
  for (const key of portKeys) {
    const port = Number(env[key]);
    if (own.has(port)) continue;
    const reserved = inRanges(port, excluded);
    if (!reserved && (await isPortFree(port, host))) continue;
    conflicts++;
    const alternative = await suggestPort(port, host, excluded, taken);
    const reason = reserved ? 'reservado por Windows (excludedportrange)' : 'ocupado';
    if (alternative !== undefined) taken.add(alternative);
    if (applyPorts && alternative !== undefined) {
      overrides.set(key, String(alternative));
      warn(`${key}=${port} ${reason} → se usará ${alternative}`);
    } else {
      warn(
        `${key}=${port} ${reason}` +
          (alternative !== undefined ? ` → alternativa libre: ${key}=${alternative} (o --apply-ports)` : ''),
      );
    }
  }
  if (overrides.size > 0) rendered = renderEnv(example, new Map([...existing, ...overrides]), overrides);

  if (checkOnly) {
    log(conflicts === 0 ? 'puertos PF_* libres' : `${conflicts} puerto(s) en conflicto`);
    return conflicts === 0 ? 0 : 3;
  }

  writeFileSync(envPath, rendered.text, { encoding: 'utf8' });
  log(
    `${existed && !force ? 'actualizado' : 'creado'} ${envPath}: ` +
      `${rendered.generated.length} secreto(s) generado(s), ${rendered.kept.length} valor(es) conservado(s)`,
  );
  if (conflicts > 0 && !applyPorts) {
    throw new UsageError('hay puertos en conflicto: edita .env o ejecuta pnpm setup:env -- --apply-ports', 3);
  }
  return 0;
});
