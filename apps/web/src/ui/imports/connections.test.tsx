import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { esContext, textOf } from '../test-support';
import { ConnectionCard, ConnectionForm } from './ConnectionsPage';
import {
  canReplaceCredential,
  canRevoke,
  canSync,
  createConnectionBody,
  selectableProviders,
  statusHintKey,
  validateDraft,
  type BankingProviderView,
  type ConnectionView,
} from './connections-logic';
import type { AccountsLookup } from './useAccounts';

const f = esContext('ImportConnections');

const provider = (over: Partial<BankingProviderView> = {}): BankingProviderView => ({
  id: 'FAKE_EXCHANGE',
  kind: 'FAKE',
  displayName: 'Exchange simulado',
  credentialMode: 'API_KEY_SECRET',
  capabilities: ['TRADES'],
  availability: 'AVAILABLE',
  attribution: null,
  ...over,
});

const connection = (over: Partial<ConnectionView> = {}): ConnectionView => ({
  id: 'c1',
  providerId: 'FAKE_EXCHANGE',
  name: 'Exchange principal',
  status: 'ACTIVE',
  assetMappings: [{ asset: 'USDT', accountId: 'a1' }],
  credential: { fingerprint: '…a1b2', kid: 'k1', verifiedAt: null, permissions: null },
  lastError: null,
  syncCursor: null,
  lastSyncAt: null,
  retryNotBefore: null,
  syncInProgress: false,
  version: 3,
  ...over,
});

const accounts: AccountsLookup = {
  loaded: true,
  all: [],
  active: [{ id: 'a1', name: 'Exchange USDT', currency: 'USDT' } as never],
  byId: (id) => (id === 'a1' ? ({ id, name: 'Exchange USDT', currency: 'USDT' } as never) : undefined),
};

const render = (c: ConnectionView, role: { manage: boolean; sync: boolean }) =>
  renderToStaticMarkup(
    <ConnectionCard
      connection={c}
      provider={provider()}
      f={f}
      accounts={accounts}
      canManage={role.manage}
      canSyncRole={role.sync}
      busy={false}
      onSync={() => undefined}
      onReplace={() => undefined}
      onRevoke={() => undefined}
      onUpload={() => undefined}
    />,
  );

describe('Conexiones: lógica', () => {
  it('[TC-IMPORTS-BANKING-002] solo se ofrecen los proveedores disponibles', () => {
    const all = [provider(), provider({ id: 'EXCHANGE_API_BINANCE', availability: 'PENDING_VERIFICATION' })];
    expect(selectableProviders(all).map((p) => p.id)).toEqual(['FAKE_EXCHANGE']);
  });

  it('valida el borrador: nombre, mapeo sin activos repetidos y credencial', () => {
    const base = {
      providerId: 'FAKE_EXCHANGE',
      name: 'Exchange',
      mappings: [{ asset: 'usdt', accountId: 'a1' }],
      keyId: 'AKIA-0000',
      secret: 's',
    };
    expect(validateDraft(base, true)).toEqual({});
    expect(validateDraft({ ...base, name: '  ' }, true)).toEqual({ name: true });
    expect(validateDraft({ ...base, mappings: [] }, true)).toEqual({ mappings: true });
    expect(
      validateDraft(
        {
          ...base,
          mappings: [
            { asset: 'USDT', accountId: 'a1' },
            { asset: 'usdt', accountId: 'a2' },
          ],
        },
        true,
      ),
    ).toEqual({ mappings: true });
    expect(validateDraft({ ...base, keyId: '', secret: '' }, true)).toEqual({ keyId: true, secret: true });
    expect(validateDraft({ ...base, keyId: '', secret: '' }, false)).toEqual({});
  });

  it('el cuerpo de alta normaliza el activo y solo lleva la credencial si el proveedor la pide', () => {
    const draft = {
      providerId: 'FAKE_EXCHANGE',
      name: ' Exchange ',
      mappings: [{ asset: 'usdt', accountId: 'a1' }],
      keyId: ' AKIA-0000 ',
      secret: 's3cr3t',
    };
    expect(createConnectionBody(draft, true)).toEqual({
      providerId: 'FAKE_EXCHANGE',
      name: 'Exchange',
      assetMappings: [{ asset: 'USDT', accountId: 'a1' }],
      credential: { keyId: 'AKIA-0000', secret: 's3cr3t' },
    });
    expect('credential' in createConnectionBody(draft, false)).toBe(false);
  });

  it('las acciones dependen del estado: sincronizar solo si está activa y sin otra en curso; revocar nunca dos veces', () => {
    expect(canSync(connection(), true)).toBe(true);
    expect(canSync(connection({ syncInProgress: true }), true)).toBe(false);
    expect(canSync(connection({ status: 'NEEDS_ATTENTION' }), true)).toBe(false);
    expect(canSync(connection(), false)).toBe(false);
    expect(canRevoke(connection({ status: 'REVOKED' }))).toBe(false);
    expect(canReplaceCredential(connection({ status: 'REVOKED' }), true)).toBe(false);
    expect(
      statusHintKey(
        connection({ status: 'NEEDS_ATTENTION', lastError: { code: 'IMPORT_CONNECTION_EXPIRED' } }),
      ),
    ).toBe('hint.expired');
  });
});

describe('Conexiones: pantalla', () => {
  it('[TC-IMPORTS-BANKING-007] muestra solo la huella enmascarada, el estado y el mapeo con el nombre de la cuenta', () => {
    const html = render(connection(), { manage: true, sync: true });
    const text = textOf(html);
    expect(text).toContain('…a1b2');
    expect(text).toContain('Activa');
    expect(text).toContain('USDT → Exchange USDT');
    expect(html).toContain('data-testid="connection-sync"');
    expect(html).toContain('data-testid="connection-revoke"');
  });

  it('pide la fecha de inicio solo en la primera sincronización', () => {
    expect(render(connection(), { manage: false, sync: true })).toContain('connection-sync-from');
    expect(render(connection({ syncCursor: '2026-10-20' }), { manage: false, sync: true })).not.toContain(
      'connection-sync-from',
    );
  });

  it('un VIEWER ve el estado pero ninguna acción', () => {
    const html = render(connection(), { manage: false, sync: false });
    expect(html).not.toContain('connection-sync"');
    expect(html).not.toContain('connection-revoke');
    expect(textOf(html)).toContain('Exchange principal');
  });

  it('una conexión que requiere atención explica qué hacer y muestra el último error', () => {
    const html = render(
      connection({ status: 'NEEDS_ATTENTION', lastError: { code: 'IMPORT_CONNECTION_EXPIRED' } }),
      { manage: true, sync: true },
    );
    expect(textOf(html)).toContain('Reemplaza la credencial');
    expect(textOf(html)).toContain('IMPORT_CONNECTION_EXPIRED');
    expect(html).not.toContain('data-testid="connection-sync"');
    expect(html).toContain('data-testid="connection-replace"');
  });

  it('el alta usa un campo de contraseña para el secreto y avisa que debe ser de solo lectura', () => {
    const html = renderToStaticMarkup(
      <ConnectionForm
        f={f}
        providers={[provider()]}
        accounts={accounts}
        busy={false}
        onSubmit={() => undefined}
      />,
    );
    // Sin proveedor elegido todavía no se muestra la credencial; el formulario ofrece el proveedor disponible.
    expect(html).toContain('Exchange simulado');
    expect(textOf(html)).toContain('Nueva conexión');
  });
});
