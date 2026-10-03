// Copia los contratos (fuente de verdad en contracts/) junto al build de finance-api: la imagen (`pnpm deploy`) solo
// incluye `dist`, `db` y `contract`. La API valida cada petición contra el OpenAPI y cada evento de dominio contra
// los JSON Schemas de contracts/events antes de escribirlo en el outbox (openspec add-event-outbox).
import { copyFileSync, cpSync, mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const contracts = new URL('../../../contracts/', import.meta.url);
const targetDir = fileURLToPath(new URL('../contract/', import.meta.url));
mkdirSync(targetDir, { recursive: true });
copyFileSync(
  fileURLToPath(new URL('openapi/finance-api.v1.yaml', contracts)),
  `${targetDir}finance-api.v1.yaml`,
);
rmSync(`${targetDir}events`, { recursive: true, force: true });
cpSync(fileURLToPath(new URL('events/', contracts)), `${targetDir}events`, {
  recursive: true,
  filter: (src) => !src.endsWith('.md'),
});
