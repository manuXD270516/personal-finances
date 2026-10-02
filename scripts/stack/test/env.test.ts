import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseArgs, listOption, option } from '../src/lib/args.js';
import { interpolate, interpolateEnv, parseEnvLines } from '../src/lib/dotenv.js';
import { GENERATE_MARKER, rawValues, renderEnv } from '../src/lib/env-template.js';
import { ENV_EXAMPLE } from '../src/lib/paths.js';
import { parseExcludedRanges } from '../src/lib/ports.js';

const example = readFileSync(ENV_EXAMPLE, 'utf8');

describe('.env.example y pnpm setup:env (docs/19 §0.3)', () => {
  it('.env.example no contiene secretos: toda variable PF_DEV_* es el marcador __generate__', () => {
    const lines = parseEnvLines(example).filter((l) => l.key);
    const devSecrets = lines.filter((l) => l.key!.startsWith('PF_DEV_'));
    expect(devSecrets.length).toBeGreaterThanOrEqual(10);
    for (const l of devSecrets) expect(l.value, l.key).toBe(GENERATE_MARKER);
    // Ninguna otra variable con nombre de secreto lleva un valor literal.
    for (const l of lines.filter(
      (x) => /(PASSWORD|SECRET|_KEY)$/.test(x.key!) && !x.key!.startsWith('PF_DEV_'),
    )) {
      expect(l.value, l.key).toMatch(/^\$\{PF_DEV_[A-Z0-9_]+\}$/);
    }
  });

  it('puertos de host PF_* con defaults "2 + canónico" publicados en 127.0.0.1', () => {
    const env = interpolateEnv(parseEnvLines(example));
    expect(env).toMatchObject({
      PF_BIND_ADDR: '127.0.0.1',
      PF_POSTGRES_PORT: '25432',
      PF_OBJECT_STORAGE_PORT: '29000',
      PF_KEYCLOAK_PORT: '28081',
      PF_API_PORT: '28080',
      PF_WEB_PORT: '23000',
      PF_MAILPIT_UI_PORT: '28025',
      PF_MAILPIT_SMTP_PORT: '21025',
    });
  });

  it('genera los secretos que faltan, conserva los existentes y no repite valores', () => {
    const first = renderEnv(example);
    expect(first.text).not.toMatch(new RegExp(`=${GENERATE_MARKER}$`, 'm'));
    const values = rawValues(first.text);
    const secrets = first.generated.map((k) => values.get(k)!);
    expect(new Set(secrets).size).toBe(secrets.length);
    for (const s of secrets) expect(s).toMatch(/^[A-Za-z0-9_-]{16,}$/);

    const again = renderEnv(example, values);
    expect(again.generated).toEqual([]);
    expect(again.text).toBe(first.text);

    const local = new Map([...values, ['MY_LOCAL_FLAG', '1']]);
    expect(renderEnv(example, local).text).toContain('MY_LOCAL_FLAG=1');
  });

  it('el .env generado resuelve las URLs del modo A a partir de los puertos PF_*', () => {
    const env = interpolateEnv(parseEnvLines(renderEnv(example).text));
    expect(env['DATABASE_URL']).toMatch(
      /^postgres:\/\/pf_app:[A-Za-z0-9_-]+@127\.0\.0\.1:25432\/pfos\?sslmode=disable$/,
    );
    expect(env['OBJECT_STORAGE_ENDPOINT']).toBe('http://127.0.0.1:29000');
    expect(env['OBJECT_STORAGE_ACCESS_KEY']).toBe(env['PF_DEV_S3_ACCESS_KEY']);
    expect(env['API_PORT']).toBe('28080');
  });
});

describe('dotenv con semántica de Compose', () => {
  it('interpola ${VAR}, ${VAR:-def}, ${VAR:?msg} y $$; el entorno del proceso tiene prioridad', () => {
    const env = interpolateEnv(
      parseEnvLines('A=1\nB=${A}-x\nC=${MISSING:-def}\nD=$$literal\nE="q # no comment"\nF=v # c'),
      {
        A: '9',
      },
    );
    expect(env).toEqual({ A: '9', B: '9-x', C: 'def', D: '$literal', E: 'q # no comment', F: 'v' });
    expect(() => interpolate('${NOPE:?run setup}', () => undefined)).toThrow(/NOPE run setup/);
  });
});

describe('argumentos de los scripts (pnpm reenvía `--`)', () => {
  it('acepta --k v, --k=v, repetidos y el separador --', () => {
    const args = parseArgs(
      ['--', '--profile', 'core', '--profile=observability', '--yes', 'finance-api', '--tail=5'],
      ['profile'],
    );
    expect(listOption(args, 'profile')).toEqual(['core', 'observability']);
    expect(option(args, 'tail')).toBe('5');
    expect(args.flags.has('yes')).toBe(true);
    expect(args.positionals).toEqual(['finance-api']);
  });

  it('interpreta los rangos excluidos de netsh (Windows)', () => {
    const text =
      'Start Port    End Port\n----------    --------\n     50000       50059\n     64518       65137     *\n';
    expect(parseExcludedRanges(text)).toEqual([
      { start: 50000, end: 50059 },
      { start: 64518, end: 65137 },
    ]);
  });
});
