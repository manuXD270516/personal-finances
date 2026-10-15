import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { ApiContract } from '@pf/platform/api';
import { FixedClock, Instant } from '@pf/shared-kernel';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { resolveContractPath } from '../../src/api/api-conventions.js';
import { createApiRuntime, type ApiRuntime } from '../../src/api/create-api-runtime.js';
import { connect, inTx } from '../support/db.js';
import { apiConfig, baseEnv, capturingLogger } from '../support/harness.js';

// Catálogo de referencia de instituciones y adopción por HTTP contra PostgreSQL real (openspec
// add-exchange-house-rate-providers, tareas 5.1 y 5.2): catálogo FICTICIO de pruebas (`reference/institutions/demo`),
// roles, 422 sin crear nada, conflictos NAME_TAKEN, vínculos explícitos, idempotencia, auditoría y estado frente al
// registro. La ruta del catálogo sale de ACCOUNTS_INSTITUTION_CATALOG_DIR (no está fija en el código).
const deps = inject('deps');
const ISSUER = 'https://idp.test/realms/pfos';
const AUDIENCE = 'finance-api';
const DEMO_DIR = fileURLToPath(new URL('../../reference/institutions/demo', import.meta.url));

interface Reply {
  status: number;
  headers: Headers;
  body: Record<string, unknown>;
}
interface Entry {
  code: string;
  name: string;
  category: string;
  kind: string;
  adoptable: boolean;
  listingStatus: string;
  delistedSince: string | null;
  adoptedInstitutionId: string | null;
  support: {
    rates: { status: string; reason: string | null; providerIds: string[] };
    statementImport: { status: string; reason: string | null };
  };
}
interface Institution {
  id: string;
  name: string;
  kind: string;
  countryCode: string | null;
  version: number;
  catalogRef?: {
    country: string;
    code: string;
    catalogVersion: string;
    listingStatus: string | null;
    delistedSince: string | null;
    support: { rates: { status: string } } | null;
  };
}

type Key = Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];
let signingKey: Key;
let runtime: ApiRuntime;
let baseUrl: string;
const clock = new FixedClock(Instant.parse('2026-10-15T14:00:00Z'));
let cachedContract: ApiContract | undefined;
const contract = () => (cachedContract ??= ApiContract.fromFile(resolveContractPath()));

async function tokenFor(sub: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    iss: ISSUER,
    aud: AUDIENCE,
    sub,
    iat: now - 5,
    exp: now + 300,
    typ: 'Bearer',
    scope: 'openid pfos.api',
    email: `${sub}@pfos.test`,
    email_verified: true,
    name: sub,
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-1', typ: 'JWT' })
    .sign(signingKey);
}

async function call(
  method: string,
  path: string,
  options: { token?: string; body?: unknown; headers?: Record<string, string>; contentType?: string } = {},
): Promise<Reply> {
  const headers: Record<string, string> = { ...options.headers };
  if (options.token) headers['authorization'] = `Bearer ${options.token}`;
  let payload: string | undefined;
  if (options.body !== undefined) {
    payload = JSON.stringify(options.body);
    headers['content-type'] = options.contentType ?? 'application/json';
  }
  const res = await fetch(`${baseUrl}${path}`, { method, headers, ...(payload ? { body: payload } : {}) });
  const text = await res.text();
  return {
    status: res.status,
    headers: res.headers,
    body: text ? (JSON.parse(text) as Record<string, unknown>) : {},
  };
}

const expectProblem = (r: Reply, status: number, code: string) => {
  expect(r.status, JSON.stringify(r.body)).toBe(status);
  expect(r.headers.get('content-type')).toContain('application/problem+json');
  expect(r.body['code']).toBe(code);
};

async function user(sub: string) {
  const token = await tokenFor(sub);
  const me = await call('GET', '/api/v1/me', { token });
  expect(me.status).toBe(200);
  const memberships = me.body['memberships'] as { workspaceId: string }[];
  return { token, id: me.body['id'] as string, ws: memberships[0]!.workspaceId };
}
type User = Awaited<ReturnType<typeof user>>;

const catalogPath = (u: User, query = 'country=BO') =>
  `/api/v1/workspaces/${u.ws}/institution-catalog?${query}`;
const adopt = (u: User, body: Record<string, unknown>, key?: string) =>
  call('POST', `/api/v1/workspaces/${u.ws}/institutions/adopt`, {
    token: u.token,
    body,
    ...(key ? { headers: { 'idempotency-key': key } } : {}),
  });
const institutionsOf = async (u: User) =>
  (
    await call('GET', `/api/v1/workspaces/${u.ws}/institutions?includeArchived=true&limit=200`, {
      token: u.token,
    })
  ).body['data'] as Institution[];
const catalogEntries = async (u: User, query?: string) =>
  (await call('GET', catalogPath(u, query), { token: u.token })).body['entries'] as Entry[];

async function asUser<T>(u: User, fn: (c: Client) => Promise<T>, commit = false): Promise<T> {
  const app = await connect(deps.databaseUrl);
  try {
    return await inTx(app, { userId: u.id, workspaceId: u.ws }, () => fn(app), commit);
  } finally {
    await app.end();
  }
}

const auditsOf = (u: User, action: string) =>
  asUser(
    u,
    async (c) =>
      (
        await c.query<{ aggregate_type: string; changes: { field: string; after: unknown }[] }>(
          'SELECT aggregate_type, changes FROM audit.audit_log WHERE workspace_id = $1 AND action = $2 ORDER BY occurred_at, id',
          [u.ws, action],
        )
      ).rows,
  );

let editor: User;
let viewer: User;
let loner: User;

async function member(owner: User, label: string, role: 'VIEWER' | 'EDITOR'): Promise<User> {
  const u = await user(`kc-cat-${label}-${randomUUID()}`);
  const app = await connect(deps.databaseUrl);
  try {
    await inTx(
      app,
      { userId: owner.id, workspaceId: owner.ws },
      () =>
        app.query(
          `INSERT INTO iam.workspace_membership (workspace_id, user_id, role, status) VALUES ($1, $2, $3, 'ACTIVE')`,
          [owner.ws, u.id, role],
        ),
      true,
    );
  } finally {
    await app.end();
  }
  return { ...u, ws: owner.ws };
}

beforeAll(async () => {
  const pair = await generateKeyPair('RS256', { extractable: true });
  signingKey = pair.privateKey;
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'test-1', alg: 'RS256', use: 'sig' };
  runtime = await createApiRuntime(
    apiConfig(baseEnv(deps, { ACCOUNTS_INSTITUTION_CATALOG_DIR: DEMO_DIR })),
    capturingLogger('finance-api', 'api').logger,
    {
      clock,
      identity: {
        jwt: { issuer: ISSUER, audience: AUDIENCE, requiredScope: 'pfos.api', jwks: { keys: [jwk] } },
      },
    },
  );
  baseUrl = await runtime.listen(0, '127.0.0.1');
  editor = await user(`kc-cat-editor-${randomUUID()}`);
  loner = await user(`kc-cat-loner-${randomUUID()}`);
  viewer = await member(editor, 'viewer', 'VIEWER');
});

afterAll(async () => {
  await runtime?.close();
});

describe('catálogo de referencia de instituciones', () => {
  it('[TC-ACCOUNTS-INSTCATALOG-001] un VIEWER consulta el catálogo ficticio con fuente, fecha de corte, versión y estado por entrada', async () => {
    const res = await call('GET', catalogPath(viewer), { token: viewer.token });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(contract().validateResponse('getInstitutionCatalog', 200, res.body)).toEqual([]);
    expect(res.body).toMatchObject({ country: 'BO', catalogVersion: '2026-09-30', fictitious: true });
    expect(res.body['source']).toMatchObject({ cutoffDate: '2026-09-30' });
    expect(String((res.body['source'] as { name: string }).name)).toContain('FICTICIO');
    const entries = res.body['entries'] as Entry[];
    // Las retiradas no se listan por defecto: 14 entradas de la semilla, 1 retirada.
    expect(entries).toHaveLength(13);
    expect(entries.every((e) => e.listingStatus === 'ACTIVE')).toBe(true);
    const bad = entries.find((e) => e.code === 'BAD');
    expect(bad).toMatchObject({
      name: 'Banco Andino Demo',
      category: 'MULTIPLE_BANK',
      kind: 'BANK',
      adoptable: true,
      adoptedInstitutionId: null,
    });
    expect(bad?.support.rates).toMatchObject({ status: 'IN_VERIFICATION', reason: null });
    expect(bad?.support.statementImport.status).toBe('PENDING_SAMPLE');
    const withDelisted = await catalogEntries(viewer, 'country=BO&includeDelisted=true');
    expect(withDelisted).toHaveLength(14);
    expect(withDelisted.find((e) => e.code === 'CAN')).toMatchObject({
      listingStatus: 'DELISTED',
      delistedSince: '2026-06-30',
    });
    // El catálogo no se mezcla con las instituciones del workspace, que sigue vacío.
    expect(await institutionsOf(viewer)).toEqual([]);
  });

  it('[TC-ACCOUNTS-INSTCATALOG-001] filtra por categoría (repetible) y por texto; sin país o con un país sin catálogo falla', async () => {
    const coops = await catalogEntries(viewer, 'country=BO&category=SAVINGS_COOP');
    expect(coops.map((e) => e.name).sort()).toEqual([
      'Cooperativa Altiplano Demo',
      'Cooperativa Illimani Demo',
    ]);
    const two = await catalogEntries(viewer, 'country=BO&category=SAVINGS_COOP&category=MOBILE_PAYMENT');
    expect(two.map((e) => e.code).sort()).toEqual(['BAL', 'BPD', 'CAD', 'CID']);
    expect((await catalogEntries(viewer, 'country=BO&q=pacha')).map((e) => e.code)).toEqual(['BPD']);
    expectProblem(
      await call('GET', catalogPath(viewer, 'country=AR'), { token: viewer.token }),
      404,
      'RESOURCE_NOT_FOUND',
    );
    expect((await call('GET', catalogPath(viewer, 'q=banco'), { token: viewer.token })).status).toBe(400);
    expect((await call('GET', catalogPath(viewer, 'country=Bolivia'), { token: viewer.token })).status).toBe(
      400,
    );
    expect((await call('GET', `/api/v1/workspaces/${editor.ws}/institution-catalog?country=BO`)).status).toBe(
      401,
    );
  });

  it('[TC-ACCOUNTS-INSTCATALOG-007] la cobertura del catálogo informa censo, resueltas y pendientes por dimensión y las NOT_ELIGIBLE con su razón', async () => {
    const res = await call('GET', catalogPath(viewer), { token: viewer.token });
    const coverage = res.body['coverage'] as {
      complete: boolean;
      censusCoveragePct: string;
      byCategory: { category: string; census: number; entries: number; censusCoveragePct: string }[];
      byDimension: {
        dimension: string;
        resolved: number;
        pending: number;
        resolvedPct: string;
        notEligible: { reason: string; count: number }[];
      }[];
    };
    expect(coverage.complete).toBe(false);
    expect(coverage.censusCoveragePct).toBe('100.00');
    expect(coverage.byCategory).toHaveLength(10);
    expect(coverage.byCategory.every((c) => c.censusCoveragePct === '100.00' && c.entries === c.census)).toBe(
      true,
    );
    const rates = coverage.byDimension.find((d) => d.dimension === 'rates')!;
    // 13 activas: pendientes = BAD (IN_VERIFICATION) y FQD (IN_VERIFICATION).
    expect([rates.resolved, rates.pending, rates.resolvedPct]).toEqual([11, 2, '84.62']);
    expect(rates.notEligible.map((n) => n.reason).sort()).toEqual([
      'NO_PUBLICATION',
      'OTHER',
      'REQUIRES_CREDENTIALS',
      'TERMS_PROHIBIT_AUTOMATION',
      'TERMS_UNAVAILABLE',
      'UNSTABLE_FORMAT',
    ]);
    expect(rates.notEligible.find((n) => n.reason === 'NO_PUBLICATION')?.count).toBe(2);
  });
});

describe('adopción desde el catálogo', () => {
  it('[TC-ACCOUNTS-INSTCATALOG-002] el EDITOR adopta dos entradas: instituciones normales vinculadas, una auditoría con los códigos, repetir no duplica y renombrar conserva el vínculo', async () => {
    const res = await adopt(editor, { country: 'BO', codes: ['BAD', 'BAL'] }, randomUUID());
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(contract().validateResponse('adoptCatalogInstitutions', 200, res.body)).toEqual([]);
    const adopted = res.body['adopted'] as Institution[];
    expect(
      adopted.map((i) => [i.name, i.kind, i.countryCode, i.catalogRef?.code, i.catalogRef?.catalogVersion]),
    ).toEqual([
      ['Banco Andino Demo', 'BANK', 'BO', 'BAD', '2026-09-30'],
      ['Billetera Altiplano Demo', 'WALLET_PROVIDER', 'BO', 'BAL', '2026-09-30'],
    ]);
    expect(adopted[0]?.catalogRef).toMatchObject({ listingStatus: 'ACTIVE', delistedSince: null });
    expect(adopted[0]?.catalogRef?.support?.rates.status).toBe('IN_VERIFICATION');
    expect(res.body['alreadyLinked']).toEqual([]);
    expect(res.body['conflicts']).toEqual([]);
    const audits = await auditsOf(editor, 'accounts.institutions.adopted');
    expect(audits).toHaveLength(1);
    expect(audits[0]?.aggregate_type).toBe('InstitutionAdoption');
    const codes = audits[0]?.changes.find((c) => c.field === 'codes')?.after as string;
    expect(JSON.parse(codes)).toEqual(['BAD', 'BAL']);

    const again = await adopt(editor, { country: 'BO', codes: ['BAD'] });
    expect(again.status).toBe(200);
    expect(again.body['adopted']).toEqual([]);
    expect((again.body['alreadyLinked'] as Institution[]).map((i) => i.catalogRef?.code)).toEqual(['BAD']);
    expect((await institutionsOf(editor)).filter((i) => i.catalogRef?.code === 'BAD')).toHaveLength(1);

    const bad = adopted[0]!;
    const renamed = await call('PATCH', `/api/v1/workspaces/${editor.ws}/institutions/${bad.id}`, {
      token: editor.token,
      body: { name: 'Mi banco' },
      contentType: 'application/merge-patch+json',
      headers: { 'if-match': `"${bad.version}"` },
    });
    expect(renamed.status, JSON.stringify(renamed.body)).toBe(200);
    expect(renamed.body['name']).toBe('Mi banco');
    expect((renamed.body['catalogRef'] as { code: string }).code).toBe('BAD');
    const entries = await catalogEntries(editor);
    expect(entries.find((e) => e.code === 'BAD')).toMatchObject({
      name: 'Banco Andino Demo',
      adoptedInstitutionId: bad.id,
    });
    // Idempotencia: el mismo Idempotency-Key reproduce la respuesta sin volver a adoptar.
    const key = randomUUID();
    const first = await adopt(editor, { country: 'BO', codes: ['BPD'] }, key);
    const replay = await adopt(editor, { country: 'BO', codes: ['BPD'] }, key);
    expect(replay.status).toBe(200);
    expect(replay.headers.get('idempotent-replayed')).toBe('true');
    expect(replay.body).toEqual(first.body);
  });

  it('[TC-ACCOUNTS-INSTCATALOG-003] un código desconocido es 422 INSTITUTION_CATALOG_ENTRY_UNKNOWN sin crear nada; el VIEWER recibe INSUFFICIENT_ROLE', async () => {
    const before = (await institutionsOf(editor)).length;
    const res = await adopt(editor, { country: 'BO', codes: ['BBD', 'ZZZ'] });
    expectProblem(res, 422, 'INSTITUTION_CATALOG_ENTRY_UNKNOWN');
    expect((await institutionsOf(editor)).length).toBe(before);
    expectProblem(await adopt(viewer, { country: 'BO', codes: ['BBD'] }), 403, 'INSUFFICIENT_ROLE');
    expect((await institutionsOf(editor)).length).toBe(before);
    // Validación de la solicitud: sin códigos, repetidos o con la forma incorrecta.
    expect((await adopt(editor, { country: 'BO', codes: [] })).status).toBe(400);
    expect((await adopt(editor, { country: 'BO', codes: ['BAD', 'BAD'] })).status).toBe(400);
    expect((await adopt(editor, { country: 'BO', codes: ['bad'] })).status).toBe(400);
    expect((await adopt(editor, { codes: ['BAD'] })).status).toBe(400);
    expectProblem(await adopt(editor, { country: 'AR', codes: ['BAD'] }), 404, 'RESOURCE_NOT_FOUND');
  });

  it('[TC-ACCOUNTS-INSTCATALOG-004] un nombre usado por una institución propia es conflicto NAME_TAKEN; con links se vincula la existente sin crear otra', async () => {
    const mine = await call('POST', `/api/v1/workspaces/${loner.ws}/institutions`, {
      token: loner.token,
      body: { name: 'Banco Andino Demo', kind: 'BANK' },
    });
    expect(mine.status).toBe(201);
    const res = await adopt(loner, { country: 'BO', codes: ['BAD', 'CID'] });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((res.body['adopted'] as Institution[]).map((i) => i.catalogRef?.code)).toEqual(['CID']);
    expect(res.body['conflicts']).toEqual([
      { code: 'BAD', reason: 'NAME_TAKEN', institutionId: mine.body['id'] },
    ]);
    const linked = await adopt(loner, {
      country: 'BO',
      codes: ['BAD'],
      links: [{ code: 'BAD', institutionId: mine.body['id'] }],
    });
    expect(linked.status, JSON.stringify(linked.body)).toBe(200);
    expect(linked.body['adopted']).toEqual([]);
    expect((linked.body['alreadyLinked'] as Institution[]).map((i) => [i.id, i.catalogRef?.code])).toEqual([
      [mine.body['id'], 'BAD'],
    ]);
    expect((await institutionsOf(loner)).filter((i) => i.name === 'Banco Andino Demo')).toHaveLength(1);
    // Un link hacia una institución inexistente o de otro workspace es 404 sin cambios.
    expectProblem(
      await adopt(loner, {
        country: 'BO',
        codes: ['BED'],
        links: [{ code: 'BED', institutionId: (await institutionsOf(editor))[0]!.id }],
      }),
      404,
      'RESOURCE_NOT_FOUND',
    );
  });

  it('[TC-ACCOUNTS-INSTCATALOG-005] una entrada retirada y una casa de cambio no se adoptan (400 VALIDATION_FAILED) y no se crea ninguna institución', async () => {
    const before = (await institutionsOf(viewer)).length;
    expectProblem(await adopt(editor, { country: 'BO', codes: ['BBD', 'CAN'] }), 400, 'VALIDATION_FAILED');
    expectProblem(await adopt(editor, { country: 'BO', codes: ['CCS'] }), 400, 'VALIDATION_FAILED');
    expect((await institutionsOf(viewer)).length).toBe(before);
  });

  it('[TC-ACCOUNTS-INSTCATALOG-005] [TC-IDENTITY-EXPORT-014] una institución vinculada a una entrada que luego se retiró sigue activa e informa desde cuándo; si la entrada ya no existe en el catálogo, listingStatus es null', async () => {
    const owner = await user(`kc-cat-delisted-${randomUUID()}`);
    // Se simulan una versión posterior del catálogo (CAN retirada) y un export importado de otra instalación (código ajeno).
    const ids = await asUser(
      owner,
      async (c) => {
        const out: string[] = [];
        for (const [name, code] of [
          ['Cooperativa Antigua Demo', 'CAN'],
          ['Entidad Ajena Demo', 'ZZZ'],
        ] as const) {
          const id = randomUUID();
          await c.query(
            `INSERT INTO accounts.institution (id, workspace_id, name, kind, country_code, catalog_country, catalog_code, catalog_version)
             VALUES ($1, $2, $3, 'BANK', 'BO', 'BO', $4, '2026-03-31')`,
            [id, owner.ws, name, code],
          );
          out.push(id);
        }
        return out;
      },
      true,
    );
    const list = await institutionsOf(owner);
    const delisted = list.find((i) => i.id === ids[0])!;
    expect(delisted.catalogRef).toMatchObject({
      code: 'CAN',
      catalogVersion: '2026-03-31',
      listingStatus: 'DELISTED',
      delistedSince: '2026-06-30',
    });
    const foreign = list.find((i) => i.id === ids[1])!;
    expect(foreign.catalogRef).toMatchObject({
      code: 'ZZZ',
      listingStatus: null,
      delistedSince: null,
      support: null,
    });
    expect(contract().validateResponse('getInstitution', 200, delisted)).toEqual([]);
    const one = await call('GET', `/api/v1/workspaces/${owner.ws}/institutions/${ids[1]}`, {
      token: owner.token,
    });
    expect(contract().validateResponse('getInstitution', 200, one.body)).toEqual([]);
    // La institución retirada conserva su cuenta y su saldo.
    const account = await call('POST', `/api/v1/workspaces/${owner.ws}/accounts`, {
      token: owner.token,
      body: {
        name: 'Bank A',
        type: 'BANK',
        currency: 'BOB',
        institutionId: ids[0],
        openingBalance: { amount: { amount: '1000.00', currency: 'BOB' }, date: '2026-01-01' },
      },
      headers: { 'idempotency-key': randomUUID() },
    });
    expect(account.status, JSON.stringify(account.body)).toBe(201);
    const inst = await call('GET', `/api/v1/workspaces/${owner.ws}/institutions/${ids[0]}`, {
      token: owner.token,
    });
    expect(inst.body['archivedAt']).toBeNull();
    expect((account.body['balance'] as { amount: string }).amount).toBe('1000.00');
  });

  it('el catálogo y las adopciones están aislados por workspace: el otro workspace no ve las instituciones adoptadas', async () => {
    const solo = await user(`kc-cat-solo-${randomUUID()}`);
    const entries = await catalogEntries(solo);
    expect(entries.every((e) => e.adoptedInstitutionId === null)).toBe(true);
    expect(await institutionsOf(solo)).toEqual([]);
  });
});
