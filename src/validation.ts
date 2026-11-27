// Request validation compiled from the OpenAPI spec, so the API cannot accept
// something the spec says is invalid (or reject something it says is valid).
import type { ErrorObject, ValidateFunction } from 'ajv';
import { problems } from './problems';
import { createAjv, specRef, type Operation, type ParameterObject } from './spec';
import type { FieldError } from './types';

interface Validators {
  query?: ValidateFunction;
  headers?: ValidateFunction;
  body?: ValidateFunction;
}

export class RequestValidator {
  // The body must match exactly: "1" is not a number in JSON.
  private readonly bodyAjv = createAjv();
  // Query strings and headers are always text, so these values are coerced
  // ("20" -> 20), and defaults from the spec are filled in (limit = 20).
  private readonly textAjv = createAjv({ coerceTypes: true, useDefaults: true });
  private readonly cache = new Map<string, Validators>();

  /** Throws a problem if the request does not match the operation. Mutates `query` with coerced values. */
  validate(op: Operation, request: { query: object; headers: object; body: unknown }): void {
    const v = this.validatorsFor(op);

    // A missing or invalid required header means we cannot process the request at all -> 400.
    if (v.headers && !v.headers(request.headers)) {
      throw problems.badRequest('A required header is missing or invalid.', toFieldErrors(v.headers.errors, 'parameter'));
    }

    const errors: FieldError[] = [];
    if (v.query && !v.query(request.query)) errors.push(...toFieldErrors(v.query.errors, 'parameter'));
    if (v.body && !v.body(request.body ?? null)) errors.push(...toFieldErrors(v.body.errors, 'pointer'));
    if (errors.length > 0) throw problems.validation(errors);
  }

  private validatorsFor(op: Operation): Validators {
    let v = this.cache.get(op.operationId);
    if (!v) {
      v = {
        query: this.compileParams(op.parameters.filter((p) => p.in === 'query')),
        headers: this.compileParams(op.parameters.filter((p) => p.in === 'header'), true),
        body: op.hasJsonBody
          ? this.bodyAjv.compile(
              specRef('paths', op.path, op.method, 'requestBody', 'content', 'application/json', 'schema'),
            )
          : undefined,
      };
      this.cache.set(op.operationId, v);
    }
    return v;
  }

  /** Turn a list of parameters into one object schema. Header names are lower-cased by Node. */
  private compileParams(params: ParameterObject[], lowerCaseNames = false) {
    if (params.length === 0) return undefined;
    const key = (p: ParameterObject) => (lowerCaseNames ? p.name.toLowerCase() : p.name);
    return this.textAjv.compile({
      type: 'object',
      properties: Object.fromEntries(params.map((p) => [key(p), p.schema])),
      required: params.filter((p) => p.required).map(key),
    });
  }
}

/** Ajv errors -> RFC 9457 `errors` entries that point at the offending field. */
function toFieldErrors(errors: ErrorObject[] | null | undefined, kind: 'pointer' | 'parameter'): FieldError[] {
  return (errors ?? []).map((e) => {
    let path = e.instancePath;
    // For "required" and "additionalProperties", point at the property itself, not its parent.
    if (e.keyword === 'required') path += `/${e.params.missingProperty}`;
    if (e.keyword === 'additionalProperties') path += `/${e.params.additionalProperty}`;
    if (kind === 'pointer') return { pointer: path, detail: e.message ?? 'is invalid' };
    return { parameter: path.replace(/^\//, ''), detail: e.message ?? 'is invalid' };
  });
}
