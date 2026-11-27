import { defineConfig } from 'vitest/config';

// One Vitest "project" per contract-test layer, so CI can run each layer as its
// own job (`vitest run --project <name>`) and a failure points at one layer.
const layer = (name: string, dir: string, extra: object = {}) => ({
  extends: true as const,
  test: { name, include: [`${dir}/**/*.test.ts`], ...extra },
});

export default defineConfig({
  test: {
    setupFiles: ['allure-vitest/setup'],
    reporters: ['default', ['allure-vitest/reporter', { resultsDir: 'allure-results' }]],
    projects: [
      layer('schema-conformance', 'tests/schema-conformance'),
      layer('auth-matrix', 'tests/auth-matrix'),
      layer('property', 'tests/property'),
      layer('graphql', 'graphql/tests'),
      // The provider verifies the pact files the consumer writes, so when both run
      // in one `vitest run`, the consumer group must finish first.
      layer('pact-consumer', 'tests/pact/consumer', { sequence: { groupOrder: 1 } }),
      layer('pact-provider', 'tests/pact/provider', { sequence: { groupOrder: 2 } }),
    ],
  },
});
