// Builds the Fastify app. Routes come from the OpenAPI spec: for every operation
// we register its method and path, check its bearer scopes, validate the request
// against its schemas, and call the handler with the same operationId.
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { authorize } from './auth';
import { handlers } from './handlers';
import { ApiProblem, problems } from './problems';
import { operations } from './spec';
import { seededStore, type Store } from './store';
import { RequestValidator } from './validation';

export interface AppOptions {
  /** Defaults to a freshly seeded store, so every app starts from the same data. */
  store?: Store;
  logger?: FastifyServerOptions['logger'];
}

export function buildApp(options: AppOptions = {}): FastifyInstance {
  const store = options.store ?? seededStore();
  const validator = new RequestValidator();
  const app = Fastify({ logger: options.logger ?? false });

  for (const op of operations) {
    const handler = handlers[op.operationId];
    // Fail at startup, not at request time, if the spec and the code disagree.
    if (!handler) throw new Error(`No handler for operation ${op.operationId}`);

    app.route({
      method: op.method.toUpperCase() as Uppercase<typeof op.method>,
      url: op.path.replace(/\{(\w+)\}/g, ':$1'), // /contacts/{id} -> /contacts/:id
      handler: async (request, reply) => {
        const principal = authorize(request.headers.authorization, op.scopes, store);
        const query = { ...(request.query as object) };
        validator.validate(op, { query, headers: request.headers, body: request.body });

        const result = handler({
          principal,
          store,
          params: request.params as Record<string, string>,
          query,
          headers: request.headers,
          body: request.body,
        });
        // Note: we deliberately do not give Fastify response schemas. Its serializer
        // would silently drop undocumented fields, hiding exactly the bugs the
        // conformance tests are meant to catch.
        return reply.code(result.status).headers(result.headers ?? {}).send(result.body);
      },
    });
  }

  app.setNotFoundHandler((request) => {
    throw problems.notFound(`No route for ${request.method} ${request.url}.`);
  });

  app.setErrorHandler((error, request, reply) => {
    let problem: ApiProblem;
    if (error instanceof ApiProblem) {
      problem = error;
    } else if (isClientError(error)) {
      // Errors Fastify raises before our handler runs, such as malformed JSON or an
      // empty JSON body. The spec's only "could not read the request" status is 400.
      problem = problems.badRequest(error.message);
    } else {
      // Log the real error, but never send internals (stack, SQL, ...) to the client.
      request.log.error(error);
      problem = problems.internal();
    }
    return reply
      .code(problem.status)
      .headers(problem.headers)
      .type('application/problem+json')
      .send(problem.toProblem(request.url));
  });

  return app;
}

function isClientError(error: unknown): error is Error {
  const status = (error as { statusCode?: number }).statusCode;
  return error instanceof Error && typeof status === 'number' && status >= 400 && status < 500;
}
