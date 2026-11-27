import { defineConfig } from 'vitest/config';

// One Vitest "project" per contract-test layer, so CI can run each layer as its
// own job (`vitest run --project <name>`) and the report groups results by layer.
const layer = (name: string, dir: string, extra: object = {}) => ({
  extends: true as const,
  test: { name, include: [`tests/${dir}/**/*.test.ts`], ...extra },
});

export default defineConfig({
  test: {
    setupFiles: ['allure-vitest/setup'],
    reporters: ['default', ['allure-vitest/reporter', { resultsDir: 'allure-results' }]],
    projects: [
      layer('schema-conformance', 'schema-conformance'),
      layer('auth-matrix', 'auth-matrix'),
      layer('property', 'property'),
      { extends: true as const, test: { name: 'graphql', include: ['graphql/tests/**/*.test.ts'] } },
      // The provider verifies the pact files the consumer writes, so when both run
      // in one `vitest run`, the consumer group must finish first.
      layer('pact-consumer', 'pact/consumer', { sequence: { groupOrder: 1 } }),
      layer('pact-provider', 'pact/provider', { sequence: { groupOrder: 2 } }),
    ],
  },
});
