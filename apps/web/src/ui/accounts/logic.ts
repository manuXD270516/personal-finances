import type { Account, AccountLiquidity, AccountStatus, AccountType, Institution } from '../common/types';

/** Tipos de pasivo (docs/31 D3): el resto son activos. */
const LIABILITY_TYPES: ReadonlySet<AccountType> = new Set(['CREDIT_CARD', 'LOAN', 'MANUAL_LIABILITY']);

export const natureOf = (type: AccountType): 'ASSET' | 'LIABILITY' =>
  LIABILITY_TYPES.has(type) ? 'LIABILITY' : 'ASSET';

/**
 * Liquidez por defecto según el tipo (docs/31 D5, TC-ACCOUNTS-LIQUIDITY-001): solo LIQUID cuenta como dinero
 * disponible. La UI la propone al elegir el tipo hasta que el usuario la cambia; la API aplica el mismo default.
 */
export function defaultLiquidity(type: AccountType): AccountLiquidity {
  switch (type) {
    case 'BANK':
    case 'CASH':
    case 'DIGITAL_WALLET':
    case 'CRYPTO_WALLET':
    case 'SAVINGS':
      return 'LIQUID';
    case 'INVESTMENT':
      return 'SEMI_LIQUID';
    default:
      return 'ILLIQUID';
  }
}

/**
 * Recorte del identificador (FR-ACCOUNTS-002, TC-ACCOUNTS-MASK-001): de "DEMO-000123456789" solo se conservan los
 * últimos 4 caracteres alfanuméricos ("6789"); el valor completo nunca sale del navegador. `null` si hay menos de 4.
 */
export function lastFourOf(raw: string): string | null {
  const alnum = raw.replace(/[^A-Za-z0-9]/g, '');
  return alnum.length >= 4 ? alnum.slice(-4) : null;
}

export const maskedIdentifier = (last4: string | null | undefined): string | null =>
  last4 ? `•••• ${last4}` : null;

export type AccountGroupBy = 'type' | 'institution' | 'none';

export interface AccountGroup {
  readonly key: string;
  readonly label: string;
  readonly accounts: readonly Account[];
}

/** Agrupa (por tipo o institución) conservando el orden manual de la API dentro de cada grupo. */
export function groupAccounts(
  accounts: readonly Account[],
  by: AccountGroupBy,
  labels: {
    readonly type: (t: AccountType) => string;
    readonly institutions: ReadonlyMap<string, Institution>;
    readonly noInstitution: string;
    readonly all: string;
  },
): AccountGroup[] {
  if (by === 'none') return accounts.length ? [{ key: 'all', label: labels.all, accounts }] : [];
  const groups = new Map<string, { label: string; accounts: Account[] }>();
  for (const a of accounts) {
    const key = by === 'type' ? a.type : (a.institutionId ?? 'none');
    const label =
      by === 'type'
        ? labels.type(a.type)
        : a.institutionId
          ? (labels.institutions.get(a.institutionId)?.name ?? labels.noInstitution)
          : labels.noInstitution;
    const g = groups.get(key) ?? { label, accounts: [] };
    g.accounts.push(a);
    groups.set(key, g);
  }
  return [...groups.entries()].map(([key, g]) => ({ key, label: g.label, accounts: g.accounts }));
}

export interface AccountFilters {
  readonly type: AccountType | '';
  readonly currency: string;
  readonly status: AccountStatus | '';
  readonly institutionId: string;
  readonly includeArchived: boolean;
}

export const EMPTY_ACCOUNT_FILTERS: AccountFilters = {
  type: '',
  currency: '',
  status: '',
  institutionId: '',
  includeArchived: false,
};

/**
 * Query de `listAccounts`: por defecto la API devuelve ACTIVE y CLOSED (archivadas ocultas); "mostrar archivadas"
 * agrega `includeArchived=true`.
 */
export function accountsQuery(f: AccountFilters): URLSearchParams {
  const q = new URLSearchParams();
  if (f.type) q.append('type', f.type);
  if (f.currency) q.append('currency', f.currency);
  if (f.status) q.append('status', f.status);
  if (f.institutionId) q.set('institutionId', f.institutionId);
  if (f.includeArchived) q.set('includeArchived', 'true');
  q.set('limit', '200');
  return q;
}
