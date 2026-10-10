import { describe, expect, it } from 'vitest';
import { contentTypeAllowed, csrfTokenFor, csrfTokenValid, originAllowed } from './csrf';

const APP = 'http://localhost:23000';
const req = (method: string, headers: Record<string, string> = {}) =>
  new Request(`${APP}/api/bff/v1/workspaces`, { method, headers });

describe('protección CSRF del BFF', () => {
  it('[TC-IDENTITY-SESSION-002] Origin ajeno o ausente sin Sec-Fetch-Site same-origin se rechaza en mutaciones', () => {
    expect(originAllowed(req('POST', { origin: APP }), APP)).toBe(true);
    expect(originAllowed(req('POST', { origin: 'https://evil.example' }), APP)).toBe(false);
    expect(originAllowed(req('POST'), APP)).toBe(false);
    expect(originAllowed(req('POST', { 'sec-fetch-site': 'same-origin' }), APP)).toBe(true);
    expect(originAllowed(req('POST', { 'sec-fetch-site': 'cross-site' }), APP)).toBe(false);
    expect(originAllowed(req('GET', { origin: 'https://evil.example' }), APP)).toBe(true);
  });

  it('[TC-IDENTITY-SESSION-002] el token es HMAC(csrfSecret, sid): ausente, de otra sesión o alterado se rechaza', () => {
    const token = csrfTokenFor('sid-1', 'secret-1');
    expect(csrfTokenValid(req('POST', { 'x-csrf-token': token }), 'sid-1', 'secret-1')).toBe(true);
    expect(csrfTokenValid(req('POST'), 'sid-1', 'secret-1')).toBe(false);
    expect(csrfTokenValid(req('POST', { 'x-csrf-token': token }), 'sid-2', 'secret-1')).toBe(false);
    expect(csrfTokenValid(req('POST', { 'x-csrf-token': `${token}x` }), 'sid-1', 'secret-1')).toBe(false);
    expect(csrfTokenValid(req('GET'), 'sid-1', 'secret-1')).toBe(true);
  });

  it('las mutaciones con cuerpo solo aceptan JSON (un formulario ajeno no puede enviarlo sin preflight)', () => {
    expect(contentTypeAllowed(req('POST', { 'content-type': 'application/json; charset=utf-8' }))).toBe(true);
    expect(contentTypeAllowed(req('PATCH', { 'content-type': 'application/merge-patch+json' }))).toBe(true);
    expect(contentTypeAllowed(req('POST', { 'content-type': 'text/plain' }))).toBe(false);
    expect(contentTypeAllowed(req('POST', { 'content-type': 'application/x-www-form-urlencoded' }))).toBe(
      false,
    );
    expect(contentTypeAllowed(req('DELETE'))).toBe(true);
  });

  it('multipart solo se admite en la subida del import del workspace', () => {
    const mp = { 'content-type': 'multipart/form-data; boundary=x' };
    const at = (path: string) => new Request(`https://app.test${path}`, { method: 'POST', headers: mp });
    expect(contentTypeAllowed(at('/api/bff/v1/workspace-imports'))).toBe(true);
    // add-basic-csv-import: el extracto CSV de una cuenta del workspace.
    const W = '0199a000-0000-7000-8000-00000000a001';
    expect(contentTypeAllowed(at(`/api/bff/v1/workspaces/${W}/imports`))).toBe(true);
    expect(contentTypeAllowed(at(`/api/bff/v1/workspaces/${W}/imports/${W}/mapping`))).toBe(false);
    expect(contentTypeAllowed(at(`/api/bff/v1/workspaces/${W}/accounts`))).toBe(false);
    expect(contentTypeAllowed(at('/api/bff/v1/workspaces'))).toBe(false);
  });
});
