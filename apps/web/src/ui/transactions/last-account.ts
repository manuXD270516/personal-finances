/**
 * Cuenta recordada del alta rápida (change `add-quick-capture`, decisión 6 y D510): la última cuenta usada se guarda en
 * `localStorage` del dispositivo, por usuario y workspace, sin tocar `PATCH /me` (que subiría la versión del perfil y
 * auditaría una comodidad del dispositivo). El valor es solo el id de la cuenta. Toda lectura y escritura va en
 * `try/catch`: en navegación privada o con el almacenamiento bloqueado el alta funciona igual, sin recordar nada.
 */

/** Lo mínimo que se usa de `Storage`; permite probar con un almacenamiento que lanza excepciones. */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const lastAccountKey = (userId: string, workspaceId: string): string =>
  `pfos:last-account:v1:${userId}:${workspaceId}`;

function defaultStorage(): KeyValueStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** Cuenta recordada del usuario en el workspace, o `null` si no hay, no se puede leer o el valor está vacío. */
export function readLastAccount(
  userId: string,
  workspaceId: string,
  storage: KeyValueStorage | null = defaultStorage(),
): string | null {
  try {
    const value = storage?.getItem(lastAccountKey(userId, workspaceId));
    return value ? value : null;
  } catch {
    return null;
  }
}

/** Recuerda la cuenta; escribe solo si cambió. Nunca lanza. */
export function writeLastAccount(
  userId: string,
  workspaceId: string,
  accountId: string,
  storage: KeyValueStorage | null = defaultStorage(),
): void {
  try {
    if (!storage || !accountId) return;
    const key = lastAccountKey(userId, workspaceId);
    if (storage.getItem(key) === accountId) return;
    storage.setItem(key, accountId);
  } catch {
    // Sin almacenamiento disponible: se sigue sin recordar.
  }
}

/**
 * Cuenta inicial del alta, en este orden: (1) la del enlace (`?cuenta=`); (2) la recordada, si está entre las cuentas
 * activas del catálogo; (3) vacío. Una cuenta archivada, cerrada o de otro workspace no se preselecciona.
 */
export function initialAccount(input: {
  readonly linkAccountId: string | undefined;
  readonly remembered: string | null;
  readonly activeAccounts: readonly { readonly id: string }[];
}): string {
  if (input.linkAccountId) return input.linkAccountId;
  if (input.remembered && input.activeAccounts.some((a) => a.id === input.remembered))
    return input.remembered;
  return '';
}
