// RFC 9457 problem details. Handlers throw ApiProblem; the app's error handler
// turns it into an `application/problem+json` response.
import type { FieldError, Problem, ProblemType } from './types';

const PROBLEM_BASE = 'https://contacts.example/problems/';
type Slug = ProblemType extends `${typeof PROBLEM_BASE}${infer S}` ? S : never;

export class ApiProblem extends Error {
  constructor(
    readonly status: number,
    readonly slug: Slug,
    readonly title: string,
    readonly detail?: string,
    readonly errors?: FieldError[],
    readonly headers: Record<string, string> = {},
  ) {
    super(detail ?? title);
  }

  toProblem(instance: string): Problem {
    return {
      type: `${PROBLEM_BASE}${this.slug}`,
      title: this.title,
      status: this.status,
      ...(this.detail && { detail: this.detail }),
      instance,
      ...(this.errors && { errors: this.errors }),
    };
  }
}

// RFC 6750 section 3: the WWW-Authenticate challenge that goes with 401/403.
const challenge = (params = '') => `Bearer realm="contacts"${params}`;

export const problems = {
  badRequest: (detail: string, errors?: FieldError[]) =>
    new ApiProblem(400, 'bad-request', 'Bad request', detail, errors),
  // No credentials at all: RFC 6750 says the challenge should not carry an error code.
  missingToken: () =>
    new ApiProblem(401, 'unauthorized', 'Unauthorized', 'A bearer token is required.', undefined, {
      'www-authenticate': challenge(),
    }),
  invalidToken: (detail: string) =>
    new ApiProblem(401, 'unauthorized', 'Unauthorized', detail, undefined, {
      'www-authenticate': challenge(`, error="invalid_token", error_description="${detail}"`),
    }),
  insufficientScope: (scope: string) =>
    new ApiProblem(403, 'forbidden', 'Forbidden', `This operation needs the ${scope} scope.`, undefined, {
      'www-authenticate': challenge(`, error="insufficient_scope", scope="${scope}"`),
    }),
  notFound: (detail: string) => new ApiProblem(404, 'not-found', 'Not found', detail),
  conflict: (detail: string) => new ApiProblem(409, 'conflict', 'Conflict', detail),
  validation: (errors: FieldError[]) =>
    new ApiProblem(422, 'validation-error', 'Validation failed', 'The request is invalid.', errors),
  idempotencyKeyReused: () =>
    new ApiProblem(
      422,
      'idempotency-key-reused',
      'Idempotency key reused',
      'This Idempotency-Key was already used with a different request body.',
    ),
  internal: () =>
    new ApiProblem(500, 'internal-error', 'Internal server error', 'An unexpected error occurred.'),
};
