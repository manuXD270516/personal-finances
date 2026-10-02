// SPIKE-07 — definición de backends bajo prueba (credenciales de prueba, solo spike).
export type BackendName = 'seaweedfs' | 'garage' | 'rustfs';

export interface Backend {
  name: BackendName;
  service: string; // servicio compose
  endpoint: string; // endpoint visto desde el host / navegador
  accessKeyId: string;
  secretAccessKey: string;
  image: string;
  license: string;
}

export const BACKENDS: Record<BackendName, Backend> = {
  seaweedfs: {
    name: 'seaweedfs',
    service: 'seaweedfs',
    endpoint: 'http://localhost:61733',
    accessKeyId: 'pfosdevseaweedkey',
    secretAccessKey: 'pfos-dev-seaweed-secret-0123456789',
    image: 'chrislusf/seaweedfs:4.48',
    license: 'Apache-2.0',
  },
  garage: {
    name: 'garage',
    service: 'garage',
    endpoint: 'http://localhost:61790',
    accessKeyId: 'GK0123456789abcdef01234567',
    secretAccessKey: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    image: 'dxflrs/garage:v2.4.1',
    license: 'AGPL-3.0',
  },
  rustfs: {
    name: 'rustfs',
    service: 'rustfs',
    endpoint: 'http://localhost:61720',
    accessKeyId: 'pfosdevrustfskey',
    secretAccessKey: 'pfos-dev-rustfs-secret-0123456789',
    image: 'rustfs/rustfs:1.0.0',
    license: 'Apache-2.0',
  },
};

export const BUCKET = 'pfos-documents';
export const BUCKETS = ['pfos-documents', 'pfos-imports'];
export const ALLOWED_ORIGIN = 'http://localhost:61600';
export const DENIED_ORIGIN = 'http://evil.localhost:61601';
