// Starts the GraphQL API over real HTTP. Tests start one per file on a free port.
import { ApolloServer } from '@apollo/server';
import { startStandaloneServer } from '@apollo/server/standalone';
import { seededStore, type Store } from '../../src/store';
import { depthLimit } from './depth-limit';
import { createContext, resolvers, typeDefs, type Context } from './schema';

export const MAX_DEPTH = 5;

export function buildGraphqlServer(): ApolloServer<Context> {
  return new ApolloServer<Context>({
    typeDefs,
    resolvers,
    validationRules: [depthLimit(MAX_DEPTH)],
    // Never send stack traces to clients, even in development.
    includeStacktraceInErrorResponses: false,
  });
}

export async function startGraphql(options: { store?: Store; port?: number } = {}) {
  const store = options.store ?? seededStore();
  const server = buildGraphqlServer();
  const { url } = await startStandaloneServer(server, {
    listen: { port: options.port ?? 0, host: '127.0.0.1' },
    context: async ({ req }) => createContext(req.headers.authorization, store),
  });
  return { url, store, stop: () => server.stop() };
}

// `npm run start:graphql` runs it on port 4000 for manual exploration.
if (import.meta.url === `file://${process.argv[1]}`) {
  const { url } = await startGraphql({ port: Number(process.env.PORT ?? 4000) });
  console.log(`GraphQL API ready at ${url}`);
}
