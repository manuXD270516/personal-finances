/**
 * Declaración de una SECCIÓN de portabilidad (openspec add-workspace-export, design decisión 2 y § "Cobertura de
 * tablas"): cada contexto declara, como dato puro en su `contracts`, qué tablas de negocio con `workspace_id` le
 * pertenecen y cómo viajan en el archivo `pfos-export`; IDENTITY (orquestador) las ejecuta con un adaptador genérico y el
 * test de cobertura exige que TODA tabla de `platform.workspace_scoped_table` tenga una sección o una exclusión
 * declarada. Sin lógica: no depende de nada.
 *
 * Una sección = una tabla = un archivo `json/<name>.jsonl` (un registro por línea, claves = columnas, validable contra
 * `contracts/export/v1/<name>.schema.json`). Montos y tasas viajan como texto decimal exacto; instantes ISO-8601 UTC.
 */
export interface PortabilitySection {
  /** Nombre del archivo y del esquema (`transactions` ⇒ `json/transactions.jsonl`). kebab-case. */
  readonly name: string;
  /** Contexto dueño de la tabla (`accounts`, `transactions`…). */
  readonly context: string;
  /** `schema.tabla`. */
  readonly table: string;
  /**
   * Orden de exportación e importación (menor primero): las dependencias de FK van antes. Reservado por rangos:
   * 100 workspace · 200 fx · 300 classification · 400 accounts · 500 ledger · 600 transactions · 700 planning ·
   * 800 notifications · 900 audit · 990 cierres de periodo del ledger (siempre al final: el trigger PF004 rechazaría
   * asientos en meses cerrados).
   */
  readonly order: number;
  /** Columna que acota por workspace (por defecto `workspace_id`; la sección `workspace` usa `id`). */
  readonly workspaceColumn?: string;
  /** Columnas de orden determinista (clave primaria o equivalente). */
  readonly orderBy: readonly string[];
  /** Columnas que NO viajan (secretos, hashes de IP, claves de idempotencia, derivados). Al importar toman su DEFAULT. */
  readonly omit?: readonly string[];
  /** Columna monetaria → expresión SQL (alias `t`) de la moneda: el texto se escribe con la escala de esa moneda. */
  readonly money?: Readonly<Record<string, string>>;
  /** Columnas que identifican a la entidad y siembran el mapa de ids (por defecto `id` si existe). */
  readonly idColumns?: readonly string[];
  /** Columnas de texto con UUID embebidos que se reescriben al remapear (p. ej. `ledger_account.code`). */
  readonly textRefs?: readonly string[];
  /** Columnas que apuntan a la propia tabla: se insertan en orden topológico (padres antes que hijos). */
  readonly selfRefs?: readonly string[];
  /** Filtro adicional al exportar, con alias `t` (p. ej. `t.workspace_id IS NOT NULL`). */
  readonly where?: string;
  /**
   * Columna de usuario: solo se importan las filas del usuario que importa (las preferencias de otros miembros no
   * pertenecen al workspace restaurado, donde el importador es el único OWNER).
   */
  readonly importerColumn?: string;
  /** Gancho de importación registrado por nombre en el composition root (p. ej. recalcular `content_sha256`). */
  readonly importHook?: string;
}

/** Tabla de negocio con `workspace_id` que se excluye a propósito del export (técnica o derivada), con su motivo. */
export interface PortabilityExclusion {
  readonly table: string;
  readonly reason: string;
}
