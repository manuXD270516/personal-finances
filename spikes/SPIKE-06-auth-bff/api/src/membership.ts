// Simula iam.workspace_membership (ADR-0010: el IdP autentica, PFOS autoriza).
// En el producto: consulta a PostgreSQL por request (sin cache entre requests) + RLS.
export type Role = 'OWNER' | 'EDITOR' | 'VIEWER';
export const RANK: Record<Role, number> = { VIEWER: 1, EDITOR: 2, OWNER: 3 };

export const WS_DEMO = '01999a7c-0000-7000-8000-00000000d3e0';
export const WS_OTHER = '01999a7c-0000-7000-8000-0000000000ff';

const memberships = new Map<string, Role>([
  [`${WS_DEMO}:0b4f1c1e-0000-4000-8000-000000000001`, 'OWNER'], // owner
  [`${WS_DEMO}:0b4f1c1e-0000-4000-8000-000000000002`, 'EDITOR'], // editor
  [`${WS_DEMO}:0b4f1c1e-0000-4000-8000-000000000003`, 'VIEWER'], // viewer
  [`${WS_OTHER}:0b4f1c1e-0000-4000-8000-000000000004`, 'OWNER'], // outsider: dueño de OTRO workspace
]);

export const findRole = (workspaceId: string, sub: string): Role | undefined =>
  memberships.get(`${workspaceId}:${sub}`);
