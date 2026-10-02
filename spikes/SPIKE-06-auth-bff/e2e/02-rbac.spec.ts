import { test, expect } from '@playwright/test';
import { bff, evidence, newUserPage, WS_DEMO, type User } from './helpers';

const ops = [
  { op: 'GET accounts (VIEWER)', method: 'GET', path: `/api/bff/workspaces/${WS_DEMO}/accounts` },
  { op: 'POST transactions (EDITOR)', method: 'POST', path: `/api/bff/workspaces/${WS_DEMO}/transactions`, body: { description: 'rbac', amount: '1.00' } },
  { op: 'POST periods/reopen (OWNER)', method: 'POST', path: `/api/bff/workspaces/${WS_DEMO}/periods/2026-09/reopen`, body: {} },
] as const;

const expected: Record<User, number[]> = {
  owner: [200, 201, 200],
  editor: [200, 201, 403],
  viewer: [200, 403, 403],
  outsider: [403, 403, 403], // miembro de OTRO workspace
};

test('matriz rol × operación a través del BFF (VIEWER recibe 403 en mutación)', async ({ browser }) => {
  const matrix: Record<string, Record<string, string>> = {};
  for (const user of Object.keys(expected) as User[]) {
    const { context, page } = await newUserPage(browser, user);
    matrix[user] = {};
    for (const [i, o] of ops.entries()) {
      const r = await bff(page, o.method, o.path, { body: 'body' in o ? o.body : undefined });
      matrix[user][o.op] = `${r.status} ${r.status >= 400 ? r.body?.code : ''}`.trim();
      expect.soft(r.status, `${user} ${o.op}`).toBe(expected[user][i]);
    }
    await context.close();
  }
  evidence('02-rbac-matrix', matrix);
});
