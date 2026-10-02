import { APP_VARIABLES, VARIABLES, type AppName, type VariableDoc, type VariableName } from './variables.js';

const APPS = Object.keys(APP_VARIABLES) as AppName[];

const escape = (s: string) => s.replace(/\|/g, '\\|');

function requirement(doc: VariableDoc): string {
  if (doc.default !== undefined) return 'no';
  if (doc.requiredWhen) return `si ${doc.requiredWhen}`;
  if (doc.optional) return 'no';
  return '**sí**';
}

/** Genera `docs/config-reference.md` desde el registro de variables (fuente única). Determinista. */
export function renderConfigReference(): string {
  const names = Object.keys(VARIABLES) as VariableName[];
  const groups = [...new Set(names.map((n) => VARIABLES[n].doc.group))];
  const lines: string[] = [
    '# Referencia de configuración (runtime)',
    '',
    '<!-- GENERADO por `pnpm config:docs` desde packages/platform/src/config/variables.ts. NO EDITAR A MANO. -->',
    '<!-- CI ejecuta `pnpm config:docs:check` y falla si este archivo está desactualizado. -->',
    '',
    '> Contrato único de configuración (docs/19 §0.3). Cada proceso valida al arrancar SOLO las variables que usa;',
    '> si falta o es inválida alguna, termina con código 78 (`EX_CONFIG`) listando todas las variables con problemas',
    '> (nunca sus valores). Las variables `PF_*` (puertos y plataforma local) las leen solo Compose y `scripts/*.ts`',
    '> y no forman parte de esta referencia. Las `OTEL_*` estándar no listadas aquí las lee directamente el SDK de',
    '> OpenTelemetry.',
    '',
    '## Variables por proceso',
    '',
    '| Proceso | Variables |',
    '|---|---|',
    ...APPS.map((app) => `| \`${app}\` | ${APP_VARIABLES[app].map((n) => `\`${n}\``).join(', ')} |`),
    '',
  ];
  for (const group of groups) {
    lines.push(
      `## ${group}`,
      '',
      '| Variable | Obligatoria | Default | Secreto | Procesos | Descripción | Ejemplo (modo A) |',
      '|---|---|---|---|---|---|---|',
    );
    for (const name of names.filter((n) => VARIABLES[n].doc.group === group)) {
      const doc: VariableDoc = VARIABLES[name].doc;
      const apps = APPS.filter((a) => (APP_VARIABLES[a] as readonly string[]).includes(name));
      lines.push(
        `| \`${name}\` | ${requirement(doc)} | ${doc.default !== undefined ? `\`${doc.default}\`` : '—'} | ${
          doc.secret ? 'sí' : 'no'
        } | ${apps.map((a) => `\`${a}\``).join(', ')} | ${escape(doc.description)} | ${
          doc.example ? `\`${escape(doc.example)}\`` : '—'
        } |`,
      );
    }
    lines.push('');
  }
  return lines.join('\n');
}
