// SPIKE-04: demuestra que cada regla de dependency-cruiser FALLA con su fixture y PASA al quitarlo.
// Uso: node scripts/prove-arch-rules.mjs   (desde la raíz del spike)
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const FIX = join(ROOT, 'fixtures/arch-violations');
const DEPCRUISE = join(ROOT, 'node_modules/dependency-cruiser/bin/dependency-cruiser.mjs');

const cases = [
  { rule: 'domain-no-infra', files: [['domain-no-infra.ts.txt', 'packages/contexts/ledger/src/domain/__violation.ts']] },
  { rule: 'domain-no-framework', files: [['domain-no-framework.ts.txt', 'packages/contexts/ledger/src/domain/__violation.ts']] },
  { rule: 'domain-only-shared-kernel', files: [['domain-only-shared-kernel.ts.txt', 'packages/contexts/ledger/src/domain/__violation.ts']] },
  { rule: 'application-no-infra', files: [['application-no-infra.ts.txt', 'packages/contexts/accounts/src/application/__violation.ts']] },
  { rule: 'no-cross-context-internals', files: [['no-cross-context-internals.ts.txt', 'packages/contexts/accounts/src/infrastructure/__violation.ts']] },
  { rule: 'not-to-unresolvable', note: 'deep import @pf/ledger/src/... (bloqueado por exports)', files: [['deep-import-blocked-by-exports.ts.txt', 'packages/contexts/accounts/src/infrastructure/__violation.ts']] },
  {
    rule: 'no-circular',
    files: [
      ['no-circular-a.ts.txt', 'packages/contexts/accounts/src/contracts/__violation_cycle_a.ts'],
      ['no-circular-b.ts.txt', 'packages/contexts/ledger/src/contracts/__violation_cycle_b.ts'],
    ],
  },
  { rule: 'composition-root-only-public-entrypoints', files: [['composition-root-only-public-entrypoints.ts.txt', 'apps/api/src/__violation.ts']] },
  { rule: 'shared-kernel-pure', files: [['shared-kernel-pure.ts.txt', 'packages/shared-kernel/src/__violation.ts']] },
];

function cruise() {
  // Reporter `err` (el de CI): exit code = nº de violaciones de severidad error.
  const r = spawnSync(process.execPath, [DEPCRUISE, 'packages', 'apps', '--config', '.dependency-cruiser.cjs', '--output-type', 'err'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const text = (r.stdout + r.stderr).replace(/\x1b\[[0-9;]*m/g, '');
  const v = [...text.matchAll(/^\s*error (\S+): (.+)$/gm)].map((m) => `${m[1]}: ${m[2]}`);
  return { exit: r.status, rules: [...new Set(v.map((x) => x.split(':')[0]))], violations: v };
}

const log = [];
const out = (s) => {
  console.log(s);
  log.push(s);
};

const base = cruise();
out(`Baseline sin fixtures: exit=${base.exit} violaciones=${base.violations.length}`);
if (base.exit !== 0) process.exit(1);

let ok = true;
out('');
out('| Regla | Con fixture (exit / reglas disparadas) | Sin fixture (exit) | Resultado |');
out('|---|---|---|---|');
const details = [];
for (const c of cases) {
  const placed = c.files.map(([src, dest]) => {
    const abs = join(ROOT, dest);
    mkdirSync(dirname(abs), { recursive: true });
    copyFileSync(join(FIX, src), abs);
    return abs;
  });
  const bad = cruise();
  for (const p of placed) rmSync(p);
  const good = cruise();
  const pass = bad.exit !== 0 && bad.rules.includes(c.rule) && good.exit === 0;
  ok &&= pass;
  out(`| \`${c.rule}\`${c.note ? ` (${c.note})` : ''} | ${bad.exit} / ${bad.rules.join(', ')} | ${good.exit} | ${pass ? 'OK' : 'FALLO'} |`);
  details.push(`## ${c.rule}`, ...bad.violations.map((v) => `  error ${v}`));
}

// Segundo nivel de enforcement del deep import: TypeScript y Node.
const deepSrc = join(FIX, 'deep-import-blocked-by-exports.ts.txt');
const deepDst = join(ROOT, 'packages/contexts/accounts/src/infrastructure/__violation.ts');
copyFileSync(deepSrc, deepDst);
const tsc = spawnSync(process.execPath, [join(ROOT, 'packages/contexts/accounts/node_modules/typescript/bin/tsc'), '-p', 'tsconfig.json'], {
  cwd: join(ROOT, 'packages/contexts/accounts'),
  encoding: 'utf8',
});
rmSync(deepDst);
const node = spawnSync(process.execPath, ['--input-type=module', '-e', "await import('@pf/ledger/src/domain/journal-entry.js')"], {
  cwd: join(ROOT, 'packages/contexts/accounts'),
  encoding: 'utf8',
});
out('');
out(`tsc (accounts) con deep import: exit=${tsc.status} → ${(tsc.stdout + tsc.stderr).trim().split('\n')[0]}`);
out(`node import('@pf/ledger/src/domain/journal-entry.js'): exit=${node.status} → ${(node.stderr.match(/ERR_[A-Z_]+/) ?? ['?'])[0]}`);

out('');
out('Detalle de violaciones reportadas por dependency-cruiser:');
details.forEach(out);
mkdirSync(join(ROOT, 'evidence'), { recursive: true });
writeFileSync(join(ROOT, 'evidence/arch-prove.txt'), log.join('\n') + '\n');
out('');
out(ok ? 'TODAS LAS REGLAS PROBADAS: fallan con fixture y pasan sin él.' : 'ALGUNA REGLA NO SE COMPORTÓ COMO SE ESPERABA');
process.exit(ok ? 0 : 1);
