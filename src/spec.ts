// Loads openapi/openapi.yaml once and exposes what the app and the tests need from it.
// Keeping this in one small module means there is exactly one way the spec is read.
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import type { Options } from 'ajv';

export const SPEC_PATH = new URL('../openapi/openapi.yaml', import.meta.url);

// The id under which the whole spec is registered in Ajv, so schemas can be
// referenced by JSON Pointer, e.g. `openapi.json#/components/schemas/Contact`.
export const SPEC_ID = 'openapi.json';

export const HTTP_METHODS = ['get', 'put', 'post', 'patch', 'delete'] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

// Only the parts of the OpenAPI document model this repo actually uses.
export interface ParameterObject {
  name: string;
  in: 'query' | 'header' | 'path' | 'cookie';
  required?: boolean;
  schema: Record<string, unknown>;
}
interface Ref {
  $ref: string;
}
interface OperationObject {
  operationId: string;
  security?: Array<Record<string, string[]>>;
  parameters?: Array<ParameterObject | Ref>;
  requestBody?: { required?: boolean; content: Record<string, { schema: unknown }> };
  responses: Record<string, unknown>;
}
type PathItem = { parameters?: Array<ParameterObject | Ref> } & Partial<
  Record<HttpMethod, OperationObject>
>;
export interface OpenApiDocument {
  openapi: string;
  security?: Array<Record<string, string[]>>;
  paths: Record<string, PathItem>;
  components: Record<string, Record<string, unknown>>;
}

export const spec = parse(readFileSync(SPEC_PATH, 'utf8')) as OpenApiDocument;

/** Escape one segment of a JSON Pointer (RFC 6901): `~` -> `~0`, `/` -> `~1`. */
export function escapePointer(segment: string): string {
  return segment.replaceAll('~', '~0').replaceAll('/', '~1');
}

/** Build a `$ref` to a location inside the spec, for compiling with Ajv. */
export function specRef(...segments: string[]): { $ref: string } {
  return { $ref: `${SPEC_ID}#/${segments.map(escapePointer).join('/')}` };
}

/** Resolve a local `#/components/...` reference. External refs are not used here. */
export function resolveRef<T>(value: T | Ref): T {
  if (value && typeof value === 'object' && '$ref' in value) {
    const path = value.$ref.replace(/^#\//, '').split('/');
    let node: unknown = spec;
    for (const segment of path) {
      node = (node as Record<string, unknown>)[segment.replaceAll('~1', '/').replaceAll('~0', '~')];
    }
    if (node === undefined) throw new Error(`Unresolvable $ref ${value.$ref}`);
    return node as T;
  }
  return value as T;
}

/** A flattened view of one operation, so callers don't walk the spec themselves. */
export interface Operation {
  operationId: string;
  method: HttpMethod;
  path: string; // OpenAPI template, e.g. /contacts/{contactId}
  scopes: string[]; // bearer scopes required by `security`
  parameters: ParameterObject[]; // path-level and operation-level, refs resolved
  hasJsonBody: boolean;
  responses: Record<string, unknown>;
}

export const operations: Operation[] = Object.entries(spec.paths).flatMap(([path, item]) =>
  HTTP_METHODS.filter((method) => item[method]).map((method) => {
    const op = item[method]!;
    const security = op.security ?? spec.security ?? [];
    return {
      operationId: op.operationId,
      method,
      path,
      scopes: security.flatMap((requirement) => requirement.bearerAuth ?? []),
      parameters: [...(item.parameters ?? []), ...(op.parameters ?? [])].map((p) =>
        resolveRef<ParameterObject>(p),
      ),
      hasJsonBody: Boolean(op.requestBody?.content['application/json']),
      responses: op.responses,
    };
  }),
);

export function getOperation(operationId: string): Operation {
  const op = operations.find((o) => o.operationId === operationId);
  if (!op) throw new Error(`No operation ${operationId} in the spec`);
  return op;
}

/**
 * A fresh Ajv instance with the whole spec registered.
 * OpenAPI 3.1 schemas are JSON Schema 2020-12, so we use Ajv's 2020 build.
 * `strict: false` because the spec document also contains non-schema keys
 * (paths, info, ...) that Ajv would otherwise reject.
 */
export function createAjv(options: Options = {}) {
  const ajv = new Ajv2020({ strict: false, allErrors: true, ...options });
  addFormats(ajv);
  ajv.addSchema(spec, SPEC_ID);
  return ajv;
}
