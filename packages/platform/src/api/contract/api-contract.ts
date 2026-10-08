import { readFileSync } from 'node:fs';
import { Ajv2020, type ErrorObject, type ValidateFunction } from 'ajv/dist/2020.js';
import addFormatsModule from 'ajv-formats';
import { parse as parseYaml } from 'yaml';
import type { ProblemField } from '../errors/problem.js';

// ajv-formats publica CommonJS con `module.exports = formatsPlugin` y `exports.default`.
const addFormats = ((addFormatsModule as unknown as { default?: unknown }).default ??
  addFormatsModule) as unknown as (ajv: Ajv2020) => Ajv2020;

const CONTRACT_ID = 'urn:pfos:finance-api';
const METHODS = ['get', 'put', 'post', 'delete', 'patch'] as const;
const JSON_MEDIA = /^application\/([a-z0-9.+-]+\+)?json$/;

type Json = Record<string, unknown>;

/** `nombre[clave]` o `nombre[clave][op]` (parámetros de consulta `style: deepObject`). */
const DEEP_OBJECT_KEY = /^([^[\]]+)\[([^[\]]+)\](?:\[([^[\]]+)\])?$/u;

export type ParameterLocation = 'path' | 'query' | 'header' | 'cookie';

export interface ContractParameter {
  readonly name: string;
  readonly in: ParameterLocation;
  readonly required: boolean;
  readonly explode: boolean;
  /** `style` del contrato (`form` por defecto; `deepObject` para `name[clave]=valor`, p. ej. `customField[centro_costo]`). */
  readonly style: string;
  /** `$ref` original (p. ej. `#/components/parameters/IdempotencyKey`), si el parámetro era una referencia. */
  readonly ref?: string;
  readonly schema: Json;
}

export interface DeprecationInfo {
  /** Fecha de anuncio (`x-deprecated-at`, YYYY-MM-DD). */
  readonly deprecatedAt?: string;
  /** Fecha de retiro (`x-sunset`, YYYY-MM-DD). */
  readonly sunset?: string;
  /** Aviso de deprecación (`x-deprecation-link`). */
  readonly link?: string;
}

export interface RequestInput {
  readonly params: Readonly<Record<string, unknown>>;
  readonly query: Readonly<Record<string, unknown>>;
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  readonly body: unknown;
  readonly contentType: string | undefined;
  readonly hasBody: boolean;
}

export interface ValidatedRequest {
  readonly params: Readonly<Record<string, unknown>>;
  readonly query: Readonly<Record<string, unknown>>;
  readonly headers: Readonly<Record<string, unknown>>;
  readonly body: unknown;
}

export type RequestValidation =
  | { readonly ok: true; readonly value: ValidatedRequest }
  | { readonly ok: false; readonly fields: readonly ProblemField[] };

export interface ContractOperation {
  readonly operationId: string;
  readonly method: string;
  /** Plantilla del contrato, sin prefijo de versión: `/workspaces/{workspaceId}`. */
  readonly path: string;
  /** Ruta Express con prefijo: `/api/v1/workspaces/:workspaceId`. */
  readonly routePath: string;
  readonly tags: readonly string[];
  readonly parameters: readonly ContractParameter[];
  readonly idempotency: 'required' | 'optional' | 'none';
  readonly requiresIfMatch: boolean;
  readonly supportsIfNoneMatch: boolean;
  readonly hasWorkspaceScope: boolean;
  /** `x-required-role` del contrato (`AUTHENTICATED`, `VIEWER`, `EDITOR`, `OWNER`); lo aplican los guards. */
  readonly requiredRole?: string;
  /** `x-isolation: SERIALIZABLE`: la transacción del comando se abre SERIALIZABLE con reintento (add-reconciliation). */
  readonly isolation?: 'SERIALIZABLE';
  readonly deprecation?: DeprecationInfo;
  readonly requestBody?: { readonly required: boolean; readonly mediaTypes: readonly string[] };
  validateRequest(input: RequestInput): RequestValidation;
}

export interface ApiContractOptions {
  /** Prefijo de versión de las rutas (por defecto `/api/v1`). */
  readonly basePath?: string;
}

const escapePointer = (s: string) => s.replaceAll('~', '~0').replaceAll('/', '~1');

/** Convierte errores de Ajv en `errors[]` con JSON Pointer (RFC 6901), sin ruido de ramas `oneOf`/`anyOf`. */
export function ajvErrorsToFields(
  errors: readonly ErrorObject[] | null | undefined,
  location: ProblemField['in'],
): ProblemField[] {
  const raw = (errors ?? [])
    .filter((e) => !['oneOf', 'anyOf', 'if', 'not'].includes(e.keyword))
    .map((e) => {
      let pointer = e.instancePath;
      if (e.keyword === 'required') pointer += `/${escapePointer(String(e.params['missingProperty']))}`;
      if (e.keyword === 'additionalProperties') {
        pointer += `/${escapePointer(String(e.params['additionalProperty']))}`;
      }
      const detail =
        e.keyword === 'additionalProperties'
          ? 'unknown property'
          : e.keyword === 'required'
            ? 'is required'
            : (e.message ?? 'is invalid');
      return { pointer, detail };
    });
  // Descarta errores de un ancestro cuando hay otro más específico (p. ej. la rama `null` de un `oneOf`).
  const kept = raw.filter(
    (e) => !raw.some((o) => o.pointer !== e.pointer && o.pointer.startsWith(`${e.pointer}/`)),
  );
  const seen = new Set<string>();
  const fields: ProblemField[] = [];
  for (const e of kept) {
    const id = `${e.pointer}\u0000${e.detail}`;
    if (seen.has(id)) continue;
    seen.add(id);
    fields.push({
      pointer: e.pointer,
      code: 'VALIDATION_FAILED',
      detail: e.detail,
      ...(location ? { in: location } : {}),
    });
  }
  return fields;
}

/**
 * Contrato OpenAPI cargado en memoria (fuente de verdad de la forma HTTP, docs/10 §1): índice de operaciones por
 * ruta Express y validadores Ajv 2020-12 compilados una vez al arranque. Validación de cuerpo sin coerción (un
 * `amount` numérico es un error); parámetros con coerción de tipos (`?limit=50`).
 */
export class ApiContract {
  private readonly byRoute = new Map<string, ContractOperation>();
  private readonly bodyAjv: Ajv2020;
  private readonly paramAjv: Ajv2020;
  readonly basePath: string;

  private constructor(
    readonly document: Json,
    options: ApiContractOptions,
  ) {
    this.basePath = (options.basePath ?? '/api/v1').replace(/\/$/, '');
    this.bodyAjv = ApiContract.createAjv(document, false);
    this.paramAjv = ApiContract.createAjv(document, 'array');
    for (const op of this.buildOperations()) this.byRoute.set(`${op.method} ${op.routePath}`, op);
  }

  /** Lee el YAML del contrato (p. ej. para componer fixtures de prueba sobre el contrato real). */
  static readDocument(path: string): Json {
    return parseYaml(readFileSync(path, 'utf8')) as Json;
  }

  static fromFile(path: string, options: ApiContractOptions = {}): ApiContract {
    return ApiContract.fromDocument(ApiContract.readDocument(path), options);
  }

  static fromDocument(document: Json, options: ApiContractOptions = {}): ApiContract {
    return new ApiContract(structuredClone(document), options);
  }

  private static createAjv(document: Json, coerceTypes: false | 'array'): Ajv2020 {
    const ajv = new Ajv2020({
      strict: false,
      allErrors: true,
      coerceTypes,
      useDefaults: false,
      validateSchema: false,
    });
    addFormats(ajv);
    ajv.addSchema({ ...document, $id: CONTRACT_ID });
    return ajv;
  }

  /** Operación cuyo `routePath` coincide con la ruta Express resuelta por Nest (`req.route.path`). */
  find(method: string, routePath: string): ContractOperation | undefined {
    const normalized = routePath.length > 1 ? routePath.replace(/\/$/, '') : routePath;
    return this.byRoute.get(`${method.toUpperCase()} ${normalized}`);
  }

  operations(): ContractOperation[] {
    return [...this.byRoute.values()];
  }

  /** Códigos de `components.schemas.ErrorCode` (catálogo abierto: `x-extensible-enum`, o `enum` por compatibilidad). */
  errorCodes(): string[] {
    const errorCode = this.resolvePointer('/components/schemas/ErrorCode') as Json | undefined;
    const branches = (errorCode?.['anyOf'] as Json[] | undefined) ?? [errorCode ?? {}];
    return branches.flatMap((b) => {
      const values = b['x-extensible-enum'] ?? b['enum'];
      return Array.isArray(values) ? (values as string[]) : [];
    });
  }

  /** Valida una respuesta contra el schema declarado (contract testing del lado proveedor, docs/10 §1.4). */
  validateResponse(
    operationId: string,
    status: number,
    body: unknown,
    mediaType = 'application/json',
  ): string[] {
    const op = this.operations().find((o) => o.operationId === operationId);
    if (!op) return [`operación desconocida ${operationId}`];
    const opPointer = `/paths/${escapePointer(op.path)}/${op.method.toLowerCase()}`;
    const responses = this.resolvePointer(`${opPointer}/responses`) as Json | undefined;
    const key = String(status) in (responses ?? {}) ? String(status) : 'default';
    let pointer = `${opPointer}/responses/${key}`;
    let response = responses?.[key] as Json | undefined;
    if (!response) return [`status ${status} no declarado en ${operationId}`];
    if (typeof response['$ref'] === 'string') {
      pointer = (response['$ref'] as string).slice(1);
      response = this.resolvePointer(pointer) as Json;
    }
    const content = response['content'] as Json | undefined;
    if (!content) return body === undefined || body === '' ? [] : [`status ${status} no declara cuerpo`];
    if (!(mediaType in content)) return [`media type ${mediaType} no declarado para ${status}`];
    const validate = this.bodyAjv.compile({
      $ref: `${CONTRACT_ID}#${pointer}/content/${escapePointer(mediaType)}/schema`,
    });
    return validate(body)
      ? []
      : ajvErrorsToFields(validate.errors, 'body').map((f) => `${f.pointer} ${f.detail}`);
  }

  private resolvePointer(pointer: string): unknown {
    let node: unknown = this.document;
    for (const raw of pointer.split('/').slice(1)) {
      const part = raw.replaceAll('~1', '/').replaceAll('~0', '~');
      if (typeof node !== 'object' || node === null) return undefined;
      node = (node as Json)[part];
    }
    return node;
  }

  private resolveParameter(raw: Json): ContractParameter {
    const ref = typeof raw['$ref'] === 'string' ? (raw['$ref'] as string) : undefined;
    const param = ref ? (this.resolvePointer(ref.slice(1)) as Json) : raw;
    const location = param['in'] as ParameterLocation;
    const style = param['style'] as string | undefined;
    return {
      name: String(param['name']),
      in: location,
      required: param['required'] === true || location === 'path',
      style: style ?? 'form',
      explode:
        typeof param['explode'] === 'boolean' ? (param['explode'] as boolean) : (style ?? 'form') === 'form',
      ...(ref ? { ref } : {}),
      schema: (param['schema'] as Json | undefined) ?? {},
    };
  }

  private buildOperations(): ContractOperation[] {
    const paths = (this.document['paths'] as Json | undefined) ?? {};
    const ops: ContractOperation[] = [];
    for (const [path, item] of Object.entries(paths)) {
      const pathItem = item as Json;
      const shared = ((pathItem['parameters'] as Json[] | undefined) ?? []).map((p) =>
        this.resolveParameter(p),
      );
      for (const method of METHODS) {
        const operation = pathItem[method] as Json | undefined;
        if (!operation) continue;
        const own = ((operation['parameters'] as Json[] | undefined) ?? []).map((p) =>
          this.resolveParameter(p),
        );
        const parameters = [
          ...shared.filter((s) => !own.some((o) => o.in === s.in && o.name === s.name)),
          ...own,
        ];
        ops.push(this.buildOperation(path, method, operation, parameters));
      }
    }
    return ops;
  }

  private buildOperation(
    path: string,
    method: string,
    operation: Json,
    parameters: ContractParameter[],
  ): ContractOperation {
    const opPointer = `/paths/${escapePointer(path)}/${method}`;
    const has = (ref: string) => parameters.some((p) => p.ref === `#/components/parameters/${ref}`);
    const headerParam = (name: string) =>
      parameters.find((p) => p.in === 'header' && p.name.toLowerCase() === name);
    const idempotencyParam = headerParam('idempotency-key');
    const requestBody = operation['requestBody'] as Json | undefined;
    const content = (requestBody?.['content'] as Json | undefined) ?? {};
    const mediaTypes = Object.keys(content);
    const jsonMedia = mediaTypes.find((m) => JSON_MEDIA.test(m));
    const bodyValidator = jsonMedia
      ? this.bodyAjv.compile({
          $ref: `${CONTRACT_ID}#${opPointer}/requestBody/content/${escapePointer(jsonMedia)}/schema`,
        })
      : undefined;
    const paramValidators = this.compileParameterValidators(opPointer, path, parameters);
    const deprecated = operation['deprecated'] === true;
    const deprecation: DeprecationInfo | undefined = deprecated
      ? {
          ...(typeof operation['x-deprecated-at'] === 'string'
            ? { deprecatedAt: operation['x-deprecated-at'] }
            : {}),
          ...(typeof operation['x-sunset'] === 'string' ? { sunset: operation['x-sunset'] } : {}),
          ...(typeof operation['x-deprecation-link'] === 'string'
            ? { link: operation['x-deprecation-link'] }
            : {}),
        }
      : undefined;
    const routePath = `${this.basePath}${path.replace(/\{([^}]+)\}/g, ':$1')}`;
    const headerNames = new Map(
      parameters.filter((p) => p.in === 'header').map((p) => [p.name.toLowerCase(), p.name]),
    );
    const headerPointer = (pointer: string) => `/${headerNames.get(pointer.slice(1)) ?? pointer.slice(1)}`;
    const explodeFalse = parameters.filter((p) => p.in === 'query' && !p.explode).map((p) => p.name);
    const deepObjects = new Set(
      parameters.filter((p) => p.in === 'query' && p.style === 'deepObject').map((p) => p.name),
    );

    return {
      operationId: String(operation['operationId']),
      method: method.toUpperCase(),
      path,
      routePath,
      tags: (operation['tags'] as string[] | undefined) ?? [],
      parameters,
      idempotency: idempotencyParam ? (idempotencyParam.required ? 'required' : 'optional') : 'none',
      requiresIfMatch: has('IfMatch') || headerParam('if-match')?.required === true,
      supportsIfNoneMatch: headerParam('if-none-match') !== undefined,
      hasWorkspaceScope: path.includes('{workspaceId}'),
      ...(typeof operation['x-required-role'] === 'string'
        ? { requiredRole: operation['x-required-role'] }
        : {}),
      ...(operation['x-isolation'] === 'SERIALIZABLE' ? { isolation: 'SERIALIZABLE' as const } : {}),
      ...(deprecation ? { deprecation } : {}),
      ...(requestBody ? { requestBody: { required: requestBody['required'] === true, mediaTypes } } : {}),
      validateRequest: (input) => {
        const fields: ProblemField[] = [];
        const query: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(input.query)) {
          // `style: deepObject`: el parser simple de Express deja la clave plana `name[clave]` / `name[clave][op]`.
          const nested = DEEP_OBJECT_KEY.exec(k);
          if (nested && deepObjects.has(nested[1] as string)) {
            const [, name, sub, op] = nested as unknown as [string, string, string, string | undefined];
            const bucket = (query[name] ??= {}) as Record<string, unknown>;
            if (op === undefined) bucket[sub] = v;
            else {
              const current = bucket[sub];
              bucket[sub] = { ...(typeof current === 'object' && current !== null ? current : {}), [op]: v };
            }
            continue;
          }
          query[k] = explodeFalse.includes(k) && typeof v === 'string' ? v.split(',') : v;
        }
        const params = { ...input.params };
        const headers: Record<string, unknown> = {};
        for (const p of parameters.filter((x) => x.in === 'header')) {
          const v = input.headers[p.name.toLowerCase()];
          if (v !== undefined) headers[p.name.toLowerCase()] = Array.isArray(v) ? v.join(', ') : v;
        }
        for (const [location, validate, value] of [
          ['path', paramValidators.path, params],
          ['query', paramValidators.query, query],
          ['header', paramValidators.header, headers],
        ] as const) {
          if (validate(value)) continue;
          const found = ajvErrorsToFields(validate.errors, location);
          // Headers: el puntero usa el nombre canónico del contrato (`/Idempotency-Key`), no el normalizado.
          fields.push(
            ...(location === 'header'
              ? found.map((f) => ({ ...f, pointer: headerPointer(f.pointer) }))
              : found),
          );
        }
        let body = input.body;
        if (requestBody) {
          if (!input.hasBody) {
            if (requestBody['required'] === true)
              fields.push({
                pointer: '',
                code: 'VALIDATION_FAILED',
                detail: 'request body is required',
                in: 'body',
              });
            body = undefined;
          } else if (
            !input.contentType ||
            !mediaTypes.some((m) => sameMedia(m, input.contentType as string))
          ) {
            fields.push({
              pointer: '',
              code: 'VALIDATION_FAILED',
              detail: `content type must be one of ${mediaTypes.join(', ')}`,
              in: 'body',
            });
          } else if (bodyValidator && !bodyValidator(body)) {
            fields.push(...ajvErrorsToFields(bodyValidator.errors, 'body'));
          }
        } else if (input.hasBody) {
          fields.push({
            pointer: '',
            code: 'VALIDATION_FAILED',
            detail: 'this operation does not accept a body',
            in: 'body',
          });
        }
        return fields.length > 0
          ? { ok: false, fields }
          : { ok: true, value: { params, query, headers, body } };
      },
    };
  }

  private compileParameterValidators(
    opPointer: string,
    path: string,
    parameters: readonly ContractParameter[],
  ): Record<'path' | 'query' | 'header', ValidateFunction> {
    const build = (location: 'path' | 'query' | 'header'): ValidateFunction => {
      const properties: Record<string, unknown> = {};
      const required: string[] = [];
      for (const p of parameters.filter((x) => x.in === location)) {
        const key = location === 'header' ? p.name.toLowerCase() : p.name;
        properties[key] = p.ref
          ? { $ref: `${CONTRACT_ID}#${p.ref.slice(1)}/schema` }
          : { $ref: `${CONTRACT_ID}#${this.parameterPointer(opPointer, path, p)}/schema` };
        if (p.required) required.push(key);
      }
      return this.paramAjv.compile({
        type: 'object',
        properties,
        required,
        // Query: parámetros desconocidos se rechazan (docs/10 §4). Headers: solo se validan los declarados.
        additionalProperties: location === 'query' ? false : true,
      });
    };
    return { path: build('path'), query: build('query'), header: build('header') };
  }

  /** Puntero al parámetro inline (en la operación o en el path item). */
  private parameterPointer(opPointer: string, path: string, param: ContractParameter): string {
    const lists = [`${opPointer}/parameters`, `/paths/${escapePointer(path)}/parameters`];
    for (const list of lists) {
      const items = (this.resolvePointer(list) as Json[] | undefined) ?? [];
      const index = items.findIndex((p) => p['name'] === param.name && p['in'] === param.in);
      if (index >= 0) return `${list}/${index}`;
    }
    throw new Error(`parámetro ${param.in}:${param.name} no encontrado en ${opPointer}`);
  }
}

const sameMedia = (declared: string, actual: string): boolean =>
  declared.toLowerCase() === actual.split(';')[0]?.trim().toLowerCase();
