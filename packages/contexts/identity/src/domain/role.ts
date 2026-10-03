/** Roles de un workspace (docs/12 §4). Orden: VIEWER < EDITOR < OWNER. */
export const ROLES = ['VIEWER', 'EDITOR', 'OWNER'] as const;
export type Role = (typeof ROLES)[number];

export const isRole = (value: unknown): value is Role => (ROLES as readonly unknown[]).includes(value);

/** Permisos de la tabla de docs/12 §4. */
export const PERMISSIONS = [
  'finance:read',
  'finance:write',
  'period:reopen',
  'import:revert',
  'connection:manage',
  'audit:read',
  'workspace:admin',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const MIN_ROLE: Readonly<Record<Permission, Role>> = {
  'finance:read': 'VIEWER',
  'finance:write': 'EDITOR',
  'import:revert': 'EDITOR',
  'period:reopen': 'OWNER',
  'connection:manage': 'OWNER',
  'audit:read': 'OWNER',
  'workspace:admin': 'OWNER',
};

/** `true` si `role` es igual o superior a `required`. */
export const roleAtLeast = (role: Role, required: Role): boolean =>
  ROLES.indexOf(role) >= ROLES.indexOf(required);

/** Función pura de la tabla de permisos (design §1). */
export const roleGrants = (role: Role, permission: Permission): boolean =>
  roleAtLeast(role, MIN_ROLE[permission]);

/** Rol mínimo que concede un permiso. */
export const minimumRoleFor = (permission: Permission): Role => MIN_ROLE[permission];
