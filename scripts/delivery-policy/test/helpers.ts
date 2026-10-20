import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import JSON5 from 'json5';
import { parse as parseYaml } from 'yaml';

/** Raíz del repositorio (este archivo está en scripts/delivery-policy/test). */
export const ROOT = new URL('../../../', import.meta.url).pathname;

export const readText = (relative: string): string => readFileSync(join(ROOT, relative), 'utf8');

export interface PackageRule {
  description?: string;
  matchManagers?: string[];
  matchUpdateTypes?: string[];
  matchDepTypes?: string[];
  matchDepNames?: string[];
  matchFileNames?: string[];
  groupName?: string | null;
  automerge?: boolean;
  minimumReleaseAge?: string | null;
  [key: string]: unknown;
}

export interface CustomManager {
  customType: string;
  managerFilePatterns: string[];
  matchStrings: string[];
  datasourceTemplate?: string;
  [key: string]: unknown;
}

export interface RenovateConfig {
  extends: string[];
  timezone: string;
  schedule: string[];
  prConcurrentLimit: number;
  minimumReleaseAge: string;
  internalChecksFilter: string;
  rebaseWhen: string;
  platformAutomerge: boolean;
  automerge: boolean;
  labels: string[];
  ignorePaths: string[];
  enabledManagers: string[];
  customManagers: CustomManager[];
  packageRules: PackageRule[];
  vulnerabilityAlerts: Record<string, unknown> & {
    schedule: string[];
    labels: string[];
    automerge: boolean;
    minimumReleaseAge: string;
  };
  [key: string]: unknown;
}

export const loadRenovate = (): RenovateConfig => JSON5.parse(readText('renovate.json5')) as RenovateConfig;

/** `"3 days"` -> 3; solo admite días u horas (suficiente para la política). */
export function durationInDays(value: string): number {
  const match = /^(\d+)\s*(day|days|hour|hours)$/.exec(value.trim());
  if (!match) throw new Error(`duración no soportada: ${value}`);
  const amount = Number(match[1]);
  return match[2]!.startsWith('day') ? amount : amount / 24;
}

/** Antigüedad mínima efectiva de pnpm en días: la de pnpm-workspace.yaml (minutos) o el valor por defecto de pnpm (1 día). */
export function pnpmMinimumReleaseAgeDays(): number {
  const workspace = parseYaml(readText('pnpm-workspace.yaml')) as { minimumReleaseAge?: number };
  const minutes = workspace.minimumReleaseAge ?? 1440;
  return minutes / 1440;
}

/** Recorre el objeto entero y devuelve (ruta, clave, valor) de cada propiedad. */
export function* walk(value: unknown, path = ''): Generator<{ path: string; key: string; value: unknown }> {
  if (Array.isArray(value)) {
    for (const [i, item] of value.entries()) yield* walk(item, `${path}[${i}]`);
  } else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      yield { path: `${path}.${key}`, key, value: child };
      yield* walk(child, `${path}.${key}`);
    }
  }
}

/** Archivos de workflow y acciones compuestas del repositorio. */
export function workflowFiles(): string[] {
  const files: string[] = [];
  for (const file of readdirSync(join(ROOT, '.github/workflows'))) {
    if (file.endsWith('.yml') || file.endsWith('.yaml')) files.push(`.github/workflows/${file}`);
  }
  for (const dir of readdirSync(join(ROOT, '.github/actions')))
    files.push(`.github/actions/${dir}/action.yml`);
  return files;
}

export interface Step {
  name?: string;
  if?: string;
  'continue-on-error'?: boolean | string;
  run?: string;
  uses?: string;
  env?: Record<string, string>;
}

export interface Job {
  'continue-on-error'?: boolean | string;
  permissions?: Record<string, string>;
  steps?: Step[];
}

export interface Workflow {
  permissions?: Record<string, string>;
  jobs: Record<string, Job>;
}

export const loadWorkflow = (relative: string): Workflow => parseYaml(readText(relative)) as Workflow;
