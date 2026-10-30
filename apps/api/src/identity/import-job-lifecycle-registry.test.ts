import { describe, expect, it } from 'vitest';
import { AUDIT_POLICIES, LIFECYCLE_MACHINES } from './identity-wiring.js';

describe('Registro de la máquina ImportJob (add-import-pipeline, D151)', () => {
  it('[TC-IMPORTS-PIPELINE-070] la máquina ImportJob está registrada para el recorrido', () => {
    const machine = LIFECYCLE_MACHINES.find((m) => m.aggregateType === 'ImportJob');
    expect(machine).toBeDefined();
    expect(machine?.states.map((s) => s.code)).toContain('PARTIALLY_ROLLED_BACK');
  });

  it('la política de auditoría de IMPORTS cubre job, perfil y fila sin datos de filas', () => {
    const policy = AUDIT_POLICIES.find((p) => 'ImportJob' in p) as Record<string, Record<string, string>>;
    expect(Object.keys(policy)).toEqual(expect.arrayContaining(['ImportJob', 'ImportProfile', 'ImportRow']));
    const fields = Object.values(policy).flatMap((f) => Object.keys(f));
    for (const forbidden of ['description', 'amount', 'raw', 'cells'])
      expect(fields).not.toContain(forbidden);
  });
});
