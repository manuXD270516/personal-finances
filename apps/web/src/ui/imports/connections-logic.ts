/**
 * Lógica pura de las conexiones con proveedores (openspec add-banking-providers, tarea 7.1; contrato
 * `finance-api.v1.yaml`, operaciones de conexiones). Los montos y las credenciales NO pasan por aquí: la UI solo ve la
 * huella enmascarada y el campo del secreto es `writeOnly` (no se vuelve a mostrar).
 */

export type ConnectionStatus =
  'PENDING_VERIFICATION' | 'ACTIVE' | 'NEEDS_ATTENTION' | 'REJECTED' | 'REVOKED' | 'NEEDS_CREDENTIAL';

export interface BankingProviderView {
  readonly id: string;
  readonly kind: string;
  readonly displayName: string;
  readonly credentialMode: 'NONE' | 'API_KEY_SECRET' | 'DELEGATED_TOKEN' | string;
  readonly capabilities: readonly string[];
  readonly availability: 'AVAILABLE' | 'PENDING_VERIFICATION' | 'UNAVAILABLE' | string;
  readonly attribution: string | null;
}

export interface AssetMappingView {
  readonly asset: string;
  readonly accountId: string;
}

export interface ConnectionView {
  readonly id: string;
  readonly providerId: string;
  readonly name: string;
  readonly status: ConnectionStatus;
  readonly assetMappings: readonly AssetMappingView[];
  readonly credential: {
    readonly fingerprint: string;
    readonly kid: string;
    readonly verifiedAt: string | null;
    readonly permissions: {
      readonly read: boolean;
      readonly trade: boolean;
      readonly withdraw: boolean;
      readonly transfer: boolean;
    } | null;
  } | null;
  readonly lastError: { readonly code: string } | null;
  readonly syncCursor: string | null;
  readonly lastSyncAt: string | null;
  readonly retryNotBefore: string | null;
  readonly syncInProgress: boolean;
  readonly version: number;
}

export const connectionsPath = (base: string): string => `${base}/imports/connections`;
export const connectionPath = (base: string, id: string): string => `${connectionsPath(base)}/${id}`;
export const providersPath = (base: string): string => `${base}/imports/providers`;

/** Los estados en los que el worker todavía trabaja: la pantalla consulta (polling con `ETag`). */
export const isVerifying = (status: ConnectionStatus): boolean => status === 'PENDING_VERIFICATION';

export const canSync = (c: ConnectionView, hasRemoteHistory: boolean): boolean =>
  hasRemoteHistory && c.status === 'ACTIVE' && !c.syncInProgress;

export const canRevoke = (c: ConnectionView): boolean => c.status !== 'REVOKED';

/** Reemplazar la credencial tiene sentido cuando la actual falló o falta. */
export const canReplaceCredential = (c: ConnectionView, hasCredential: boolean): boolean =>
  hasCredential && c.status !== 'REVOKED';

/** Un proveedor se ofrece para crear solo si está disponible (términos y formato verificados). */
export const selectableProviders = (all: readonly BankingProviderView[]): readonly BankingProviderView[] =>
  all.filter((p) => p.availability === 'AVAILABLE');

export interface ConnectionDraft {
  readonly providerId: string;
  readonly name: string;
  readonly mappings: readonly { readonly asset: string; readonly accountId: string }[];
  readonly keyId: string;
  readonly secret: string;
}

export type DraftErrors = Partial<Record<'provider' | 'name' | 'mappings' | 'keyId' | 'secret', true>>;

/** Validación local previa al envío (la API valida de nuevo): nombre, al menos un mapeo, sin activos repetidos. */
export function validateDraft(draft: ConnectionDraft, needsCredential: boolean): DraftErrors {
  const errors: { -readonly [K in keyof DraftErrors]: true } = {};
  if (draft.providerId === '') errors.provider = true;
  if (draft.name.trim().length < 1 || draft.name.trim().length > 80) errors.name = true;
  const complete = draft.mappings.filter((m) => m.asset.trim() !== '' && m.accountId !== '');
  const assets = complete.map((m) => m.asset.trim().toUpperCase());
  if (complete.length === 0 || new Set(assets).size !== assets.length) errors.mappings = true;
  if (needsCredential) {
    if (draft.keyId.trim().length < 4) errors.keyId = true;
    if (draft.secret.length < 1) errors.secret = true;
  }
  return errors;
}

export function createConnectionBody(draft: ConnectionDraft, needsCredential: boolean) {
  return {
    providerId: draft.providerId,
    name: draft.name.trim(),
    assetMappings: draft.mappings
      .filter((m) => m.asset.trim() !== '' && m.accountId !== '')
      .map((m) => ({ asset: m.asset.trim().toUpperCase(), accountId: m.accountId })),
    ...(needsCredential ? { credential: { keyId: draft.keyId.trim(), secret: draft.secret } } : {}),
  };
}

/** Clave del mensaje que explica el estado (qué hacer a continuación). */
export const statusHintKey = (c: ConnectionView): string => {
  if (c.status === 'NEEDS_ATTENTION') {
    return c.lastError?.code === 'IMPORT_CONNECTION_EXPIRED'
      ? 'hint.expired'
      : c.lastError?.code === 'CONNECTION_CREDENTIAL_NOT_READ_ONLY'
        ? 'hint.notReadOnly'
        : 'hint.attention';
  }
  if (c.status === 'REJECTED') return 'hint.rejected';
  if (c.status === 'NEEDS_CREDENTIAL') return 'hint.needsCredential';
  if (c.status === 'PENDING_VERIFICATION') return 'hint.verifying';
  if (c.status === 'REVOKED') return 'hint.revoked';
  return 'hint.active';
};
