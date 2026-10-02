// pnpm check:hosts [-- <raíz>] — falla si el código de aplicación o las definiciones de contenedores contienen
// `localhost`/`127.0.0.1` fijos (TC-PLATFORM-STACK-005). Las direcciones se leen del `.env` / esquema de config.
import { resolve } from 'node:path';
import { log, runMain, warn } from './lib/cli.js';
import { scanRepository } from './lib/hosts-check.js';
import { ROOT } from './lib/paths.js';

runMain(async () => {
  const root = resolve(process.argv.slice(2).find((a) => a !== '--') ?? ROOT);
  const findings = scanRepository(root);
  for (const f of findings) warn(`${f.file}:${f.line}: host fijo → ${f.text}`);
  if (findings.length > 0) {
    warn(
      `${findings.length} ocurrencia(s) de localhost/127.0.0.1 fijas (usa configuración o marca pf-allow-loopback)`,
    );
    return 1;
  }
  log('sin localhost/127.0.0.1 fijos en apps/, packages/, docker/ ni deploy/compose/');
  return 0;
});
