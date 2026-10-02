/** Imágenes de dependencias para Testcontainers: mismas que el stack Compose (paridad, docs/19 §0.6). */
export const POSTGRES_IMAGE = 'postgres:18.6-trixie';
/** SeaweedFS fijado por versión y digest (SPIKE-07 / ADR-0009). */
export const SEAWEEDFS_IMAGE =
  'chrislusf/seaweedfs:4.48@sha256:4e61d15fd35994cb1e43e1e553dff106794841fd9a99ade2fc8c8bfce4d7872d';
