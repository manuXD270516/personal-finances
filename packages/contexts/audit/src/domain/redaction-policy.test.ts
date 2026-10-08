import { describe, expect, it } from 'vitest';
import { AuditError } from './audit-error.js';
import { RedactionPolicy } from './redaction-policy.js';

const policy = new RedactionPolicy({
  Account: { name: 'plain', accountNumberLast4: 'last4', openingBalance: 'money', archived: 'plain' },
});

describe('[TC-AUDIT-REDACTION-001] la auditoría excluye datos sensibles y conserva los montos', () => {
  it('el identificador de cuenta queda solo como sus últimos 4 caracteres', () => {
    const changes = policy.apply('Account', [
      { field: 'accountNumberLast4', before: null, after: 'DEMO-000123456789' },
    ]);
    expect(changes).toEqual([{ field: 'accountNumberLast4', before: null, after: '6789' }]);
    expect(JSON.stringify(changes)).not.toContain('DEMO-000123456789');
  });

  it('canario: tokens, cookies, secretos y campos no listados nunca se copian', () => {
    const changes = policy.apply('Account', [
      { field: 'name', before: 'Bank A', after: 'Bank A Sueldo' },
      { field: 'accessToken', before: null, after: 'CANARY-TOKEN-123' },
      { field: 'cookie', before: null, after: '__Host-pfos_sid=CANARY-TOKEN-123' },
      { field: 'clientSecret', before: null, after: 'CANARY-TOKEN-123' },
      { field: 'newUnreviewedField', before: null, after: 'CANARY-TOKEN-123' },
    ]);
    expect(changes.map((c) => c.field)).toEqual(['name']);
    expect(JSON.stringify(changes)).not.toContain('CANARY');
    // Un agregado sin política no aporta campos.
    expect(policy.apply('Unknown', [{ field: 'name', before: 'a', after: 'b' }])).toEqual([]);
  });

  it('el monto de apertura se conserva exacto: 100.000000 USDT', () => {
    expect(
      policy.apply('Account', [
        { field: 'openingBalance', before: null, after: { amount: '100.000000', currency: 'USDT' } },
      ]),
    ).toEqual([{ field: 'openingBalance', before: null, after: { amount: '100.000000', currency: 'USDT' } }]);
  });

  it('un monto como number o un campo enmascarado no string se rechazan; las políticas no se redeclaran', () => {
    expect(() => policy.apply('Account', [{ field: 'openingBalance', before: null, after: 100 }])).toThrow(
      AuditError,
    );
    expect(() =>
      policy.apply('Account', [{ field: 'accountNumberLast4', before: null, after: 123456789 }]),
    ).toThrow(AuditError);
    expect(() => policy.with({ Account: { name: 'plain' } })).toThrow(AuditError);
    expect(() => new RedactionPolicy({ X: { a: 'copy' as never } })).toThrow(AuditError);
    expect(
      policy
        .with({ Workspace: { name: 'plain' } })
        .apply('Workspace', [{ field: 'name', before: 'a', after: 'b' }]),
    ).toHaveLength(1);
  });
});

describe('[TC-CLASSIFICATION-CUSTOMFIELD-007] campos dinámicos con comodín de prefijo (add-custom-fields)', () => {
  const dynamic = new RedactionPolicy({ Transaction: { amount: 'plain', 'customFields.*': 'plain' } });

  it('customFields.<clave> usa la regla del comodín; el prefijo desnudo o desconocido se omite', () => {
    const changes = dynamic.apply('Transaction', [
      { field: 'customFields.centro_costo', before: 'casa', after: 'oficina' },
      { field: 'customFields', before: 'x', after: 'y' },
      { field: 'otros.centro_costo', before: 'x', after: 'y' },
    ]);
    expect(changes).toEqual([{ field: 'customFields.centro_costo', before: 'casa', after: 'oficina' }]);
  });
});
