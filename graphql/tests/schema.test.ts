// The GraphQL schema is the contract. It is printed to graphql/schema.graphql and
// committed, so every schema change shows up as a reviewable diff in the pull request,
// and CI runs GraphQL Inspector on that file to block breaking changes.
// After an intended change: `npm run graphql:snapshot`, then commit the file.
import { buildSchema, lexicographicSortSchema, printSchema } from 'graphql';
import { expect, test } from 'vitest';
import { typeDefs } from '../src/schema';

test('the schema matches the committed graphql/schema.graphql', async () => {
  const schema = buildSchema(typeDefs);
  // Sorting makes the file independent of declaration order, so only real changes show up.
  await expect(printSchema(lexicographicSortSchema(schema))).toMatchFileSnapshot('../schema.graphql');
});
