'use client';

import { WithWorkspace } from '../common/workspace';
import { CoveragePanel } from './InstitutionCatalogPanel';

/** Configuración → Cobertura de soporte de entidades (FR-ACCOUNTS-012). */
export function CoverageSettingsPanel() {
  return <WithWorkspace>{(ctx) => <CoveragePanel ctx={ctx} />}</WithWorkspace>;
}
