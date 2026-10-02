// Mide arranque de Keycloak (start-dev + import del realm) y memoria (docker stats).
// Uso: node scripts/measure-keycloak.mjs [--runs 3] [--keep]
// Solo toca el proyecto compose pf-spike-06.
import { execSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
process.loadEnvFile('.env');
const runs = Number(process.argv[process.argv.indexOf('--runs') + 1]) || 3;
const keep = process.argv.includes('--keep');
const limited = process.argv.includes('--fargate-like');
const P = 'docker compose -p pf-spike-06 --env-file .env' + (limited ? ' -f compose.yaml -f compose.fargate-like.yaml' : '');
const outName = limited ? `evidence/keycloak-startup-fargate-like-${process.env.KC_MEM_LIMIT ?? '1g'}.json` : 'evidence/keycloak-startup.json';
const sh = (c) => execSync(c, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const wellKnown = `${process.env.OIDC_ISSUER}/.well-known/openid-configuration`;
const stats = () => {
  const id = sh(`${P} ps -q keycloak`);
  return sh(`docker stats --no-stream --format "{{.MemUsage}}|{{.CPUPerc}}" ${id}`);
};
const results = [];
for (let i = 1; i <= runs; i++) {
  sh(`${P} rm -sf keycloak`);
  const t0 = Date.now();
  sh(`${P} up -d keycloak`);
  let ready = 0;
  while (!ready) {
    try { const r = await fetch(wellKnown); if (r.ok) ready = Date.now(); } catch {}
    if (!ready) await sleep(250);
    if (Date.now() - t0 > 180_000) throw new Error('timeout esperando Keycloak');
  }
  const logs = sh(`${P} logs keycloak`);
  const started = /started in ([\d.]+)s/.exec(logs)?.[1];
  const memReady = stats();
  await sleep(30_000);
  const memIdle30s = stats();
  results.push({ run: i, readyMs: ready - t0, keycloakLogStartedS: started && Number(started), memAtReady: memReady, memIdle30s });
  console.log(results.at(-1));
}
mkdirSync('evidence', { recursive: true });
writeFileSync(outName, JSON.stringify({ image: 'quay.io/keycloak/keycloak:26.8.0', mode: 'start-dev --import-realm', limits: limited ? { cpus: 0.5, mem: process.env.KC_MEM_LIMIT ?? '1g' } : 'none', date: new Date().toISOString(), results }, null, 2));
if (!keep) console.log('(deja el contenedor corriendo; down con pnpm deps:down)');
