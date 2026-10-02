// SPIKE-08 — cross-platform wrapper over `docker compose` (stand-in for scripts/stack.ts).
// Runs identically from PowerShell, cmd, Git Bash and WSL: no shell, no bash-isms, node:path only.
//   pnpm tsx scripts/stack.ts up [--profile=core,seed]   (default profile: core)
//   pnpm tsx scripts/stack.ts down
//   pnpm tsx scripts/stack.ts reset [--yes]              (down -v + up)
//   pnpm tsx scripts/stack.ts logs [service] [--since=10m] [--no-follow]
//   pnpm tsx scripts/stack.ts ps
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PROJECT = process.env.PF_COMPOSE_PROJECT ?? 'pf-spike-08';
const BASE = ['compose', '-p', PROJECT, '-f', resolve(ROOT, 'compose.yaml'), '--project-directory', ROOT];
const ALL_PROFILES = ['deps', 'core', 'seed', 'observability'];

const [cmd = 'help', ...rest] = process.argv.slice(2);
const flags = new Map<string, string>();
const positional: string[] = [];
for (const a of rest) {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
  if (m) flags.set(m[1], m[2] ?? 'true');
  else positional.push(a);
}

function profileArgs(list: string[]): string[] {
  return list.flatMap((p) => ['--profile', p]);
}

function docker(args: string[]): Promise<number> {
  const full = [...BASE, ...args];
  console.log(`$ docker ${full.map((x) => (x.includes(' ') ? JSON.stringify(x) : x)).join(' ')}`);
  return new Promise((ok, fail) => {
    const child = spawn('docker', full, { stdio: 'inherit', shell: false, cwd: ROOT });
    child.on('error', fail);
    child.on('exit', (code) => ok(code ?? 1));
  });
}

async function timed(label: string, fn: () => Promise<number>): Promise<number> {
  const t0 = performance.now();
  const code = await fn();
  console.log(`[stack] ${label} exit=${code} in ${((performance.now() - t0) / 1000).toFixed(1)}s`);
  return code;
}

async function confirm(question: string): Promise<boolean> {
  if (flags.has('yes') || process.env.CI) return true;
  if (!process.stdin.isTTY) {
    console.error('[stack] destructive command without TTY: pass --yes');
    return false;
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(`${question} [y/N] `);
  rl.close();
  return /^y(es)?$/i.test(answer.trim());
}

const profiles = (flags.get('profile') ?? 'core').split(',').filter(Boolean);
let code = 0;
switch (cmd) {
  case 'up':
    code = await timed(`up --profile ${profiles.join(',')}`, () =>
      docker([...profileArgs(profiles), 'up', '-d', '--wait', '--wait-timeout', flags.get('timeout') ?? '180']));
    if (code === 0) {
      const p = (k: string, d: string) => process.env[k] ?? d;
      console.log(`[stack] postgres  localhost:${p('PF_PG_PORT', '61832')}`);
      console.log(`[stack] valkey    localhost:${p('PF_VALKEY_PORT', '61837')}`);
      if (profiles.includes('core')) console.log(`[stack] api       http://localhost:${p('PF_API_PORT', '61880')}/health/ready`);
    }
    break;
  case 'down':
    // all profiles so that nothing of this project is left behind; volumes are kept
    code = await timed('down', () => docker([...profileArgs(ALL_PROFILES), 'down', '--remove-orphans']));
    break;
  case 'reset':
    if (!(await confirm(`Reset DESTROYS volumes of project ${PROJECT}. Continue?`))) {
      code = 2;
      break;
    }
    code = await timed('down -v', () => docker([...profileArgs(ALL_PROFILES), 'down', '-v', '--remove-orphans']));
    if (code === 0)
      code = await timed(`up --profile ${profiles.join(',')}`, () =>
        docker([...profileArgs(profiles), 'up', '-d', '--wait', '--wait-timeout', '180']));
    break;
  case 'logs': {
    const args = [...profileArgs(ALL_PROFILES), 'logs', '--timestamps'];
    if (!flags.has('no-follow')) args.push('-f');
    if (flags.has('since')) args.push('--since', flags.get('since')!);
    if (flags.has('tail')) args.push('--tail', flags.get('tail')!);
    code = await docker([...args, ...positional]);
    break;
  }
  case 'ps':
    code = await docker([...profileArgs(ALL_PROFILES), 'ps', '-a', '--format', 'table {{.Service}}\t{{.State}}\t{{.Status}}\t{{.Ports}}']);
    break;
  default:
    console.log('usage: stack.ts up|down|reset|logs|ps [--profile=core,seed] [--yes]');
    code = cmd === 'help' ? 0 : 64;
}
process.exit(code);
