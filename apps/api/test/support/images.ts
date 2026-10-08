/** Imágenes de dependencias para Testcontainers: mismas que el stack Compose (paridad, docs/19 §0.6). */
export const POSTGRES_IMAGE =
  'postgres:18.6-trixie@sha256:5a5a84b19854a9ffaa54082c166ff4ec27473a361e496e5ea167f298f2da9722';
/** SeaweedFS fijado por versión y digest (SPIKE-07 / ADR-0009). */
export const SEAWEEDFS_IMAGE =
  'chrislusf/seaweedfs:4.48@sha256:4e61d15fd35994cb1e43e1e553dff106794841fd9a99ade2fc8c8bfce4d7872d';
/** Mailpit (servidor SMTP de pruebas): la misma imagen fijada de Compose; captura los emails sin salir a internet. */
export const MAILPIT_IMAGE =
  'axllent/mailpit:v1.27.7@sha256:cae83a33cd9b9598e4acb210be673dda7e741d5271ed4045310ab456950a136a';
