// Checks one HTTP response against what the OpenAPI spec documents for it.
// Used by the schema-conformance and property layers.
import type { ValidateFunction } from 'ajv';
import { createAjv, getOperation, resolveRef, specRef } from '../../src/spec';

interface ResponseObject {
  headers?: Record<string, { required?: boolean }>;
  content?: Record<string, unknown>;
}

/** The parts of a response we check. Fastify's inject() result fits this shape. */
export interface HttpResponse {
  statusCode: number;
  headers: Record<string, string | string[] | number | undefined>;
  body: string;
}

const ajv = createAjv();
const compiled = new Map<string, ValidateFunction>();

/**
 * Returns a list of human-readable violations (empty means the response conforms):
 * - the status code is documented for this operation
 * - the Content-Type is one the spec lists (or there is no body when none is documented)
 * - every required response header is present
 * - the body validates against the schema, including "no undocumented fields"
 *   (our schemas set additionalProperties: false)
 */
export function contractViolations(operationId: string, res: HttpResponse): string[] {
  const op = getOperation(operationId);
  const status = String(res.statusCode);
  const documented = op.responses[status] ?? op.responses.default;
  if (!documented) {
    return [`status ${status} is not documented for ${operationId} (documented: ${Object.keys(op.responses).join(', ')})`];
  }
  const response = resolveRef<ResponseObject>(documented);
  const violations: string[] = [];

  for (const [name, header] of Object.entries(response.headers ?? {})) {
    if (header.required && res.headers[name.toLowerCase()] === undefined) {
      violations.push(`required header ${name} is missing`);
    }
  }

  const mediaTypes = Object.keys(response.content ?? {});
  if (mediaTypes.length === 0) {
    if (res.body !== '') violations.push(`expected no body for ${status}, got ${res.body.slice(0, 80)}`);
    return violations;
  }

  // Compare the media type without parameters: "application/json; charset=utf-8" -> "application/json".
  const contentType = String(res.headers['content-type'] ?? '').split(';')[0]!.trim();
  if (!mediaTypes.includes(contentType)) {
    violations.push(`content-type "${contentType}" is not one of ${mediaTypes.join(', ')}`);
    return violations;
  }

  // Point Ajv at the schema inside the spec rather than copying it, so $refs keep working.
  // For a response defined in components, point at the component itself.
  const ref = documented as { $ref?: string };
  const location = ref.$ref
    ? [...ref.$ref.replace(/^#\//, '').split('/'), 'content', contentType, 'schema']
    : ['paths', op.path, op.method, 'responses', status, 'content', contentType, 'schema'];
  const key = location.join(' ');
  let validate = compiled.get(key);
  if (!validate) {
    validate = ajv.compile(specRef(...location));
    compiled.set(key, validate);
  }

  let body: unknown;
  try {
    body = JSON.parse(res.body);
  } catch {
    violations.push(`body is not valid JSON: ${res.body.slice(0, 80)}`);
    return violations;
  }
  if (!validate(body)) {
    for (const e of validate.errors ?? []) {
      violations.push(`body${e.instancePath} ${e.message}${e.params ? ` ${JSON.stringify(e.params)}` : ''}`);
    }
  }
  return violations;
}

/** Assertion form, for use inside tests. */
export function expectToMatchSpec(operationId: string, res: HttpResponse): void {
  const violations = contractViolations(operationId, res);
  if (violations.length > 0) {
    throw new Error(
      `Response does not match the spec for ${operationId} (${res.statusCode}):\n  - ${violations.join('\n  - ')}`,
    );
  }
}
