// SPIKE-08 — SIGTERM matrix: stop each service, time it, read exit code and check the handler log.
// Usage: pnpm tsx scripts/measure-signals.ts
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = ['compose', '-p', 'pf-spike-08', '-f', resolve(ROOT, 'signals/compose.signals.yaml'), '--profile', 'signals'];
const sh = (args: string[]) => {
  const r = spawnSync('docker', args, { cwd: ROOT, encoding: 'utf8', shell: false });
  return { code: r.status ?? 1, out: (r.stdout ?? '') + (r.stderr ?? '') };
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const services = [
  'sig-node-pid1-handler', 'sig-node-pid1-nohandler', 'sig-tini-handler', 'sig-tini-nohandler',
  'sig-shell-wrapper', 'sig-shell-wrapper-tini', 'sig-npm-start',
];
sh([...BASE, 'build']);
const upR = sh([...BASE, 'up', '-d', ...services, 'zombie-no-init', 'zombie-tini']);
if (upR.code !== 0) throw new Error(upR.out);
await sleep(6000);

const rows: string[] = [];
const evidence: string[] = [];
for (const svc of services) {
  const container = `pf-spike-08-${svc}-1`;
  const pid1 = sh(['exec', container, 'cat', '/proc/1/cmdline']).out.replace(/\0/g, ' ').trim();
  const t0 = performance.now();
  sh([...BASE, 'stop', svc]);
  const ms = Math.round(performance.now() - t0);
  const exit = sh(['inspect', container, '--format', '{{.State.ExitCode}}']).out.trim();
  const logs = sh(['logs', container]).out;
  const handler = logs.includes('SHUTDOWN_HANDLER_DONE') ? 'yes (drained)' : logs.includes('SHUTDOWN_HANDLER_START') ? 'started' : 'no';
  rows.push(`| ${svc} | \`${pid1}\` | ${handler} | ${exit} | ${ms} |`);
  evidence.push(`### ${svc} (PID1: ${pid1}) stop=${ms}ms exit=${exit}\n${logs.trim()}\n`);
  console.log(svc, pid1, handler, exit, ms);
}

// zombies after ~20 s of spawning orphans
await sleep(15000);
for (const z of ['zombie-no-init', 'zombie-tini']) {
  const ps = sh(['exec', `pf-spike-08-${z}-1`, 'ps', '-o', 'pid,ppid,stat,comm']).out;
  const zombies = ps.split('\n').filter((l) => /\sZ\s/.test(l)).length;
  rows.push(`| ${z} | zombies (stat Z) after ~20 s | — | — | ${zombies} zombies |`);
  evidence.push(`### ${z}: ${zombies} zombies\n${ps.split('\n').slice(0, 12).join('\n')}\n...`);
  console.log(z, 'zombies', zombies);
}
sh([...BASE, 'down']);

const table = ['| Servicio | PID 1 | Handler ejecutado | Exit code | Tiempo de stop (ms) |', '|---|---|---|---|---|', ...rows].join('\n');
writeFileSync(resolve(ROOT, 'results/05-signals.md'), `${table}\n\n## Logs\n\n\`\`\`text\n${evidence.join('\n')}\n\`\`\`\n`);
console.log(table);
