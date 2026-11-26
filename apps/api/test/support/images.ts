/** Imágenes de dependencias para Testcontainers: mismas que el stack Compose (paridad, docs/19 §0.6). */
export const POSTGRES_IMAGE =
  'postgres:18.6-trixie@sha256:5a5a84b19854a9ffaa54082c166ff4ec27473a361e496e5ea167f298f2da9722';
/** SeaweedFS fijado por versión y digest (SPIKE-07 / ADR-0009). */
export const SEAWEEDFS_IMAGE =
  'chrislusf/seaweedfs:4.54@sha256:4b42c212543a0acd4c0e675215ecdcaf62a186ef98def76c7e12701871222d15';
/** Mailpit (servidor SMTP de pruebas): la misma imagen fijada de Compose; captura los emails sin salir a internet. */
export const MAILPIT_IMAGE =
  'axllent/mailpit:v1.33.1@sha256:aef2aacc11f075ec0fb6874275ee4a421e688e11a96ebb296134d1735c7761ce';
