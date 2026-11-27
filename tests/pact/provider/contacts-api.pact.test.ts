// Layer 3b: provider verification.
// Start the real API on a random local port, replay every interaction from the
// consumer's pact file against it, and check the real responses match.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { Verifier } from '@pact-foundation/pact';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { buildApp } from '../../../src/app';
import { seed, seededStore } from '../../../src/store';

const pactFile = path.resolve(import.meta.dirname, '../../../pacts/contacts-web-contacts-api.json');

const store = seededStore();
const app = buildApp({ store });
let baseUrl: string;

beforeAll(async () => {
  // Port 0 = let the OS pick a free port, so parallel runs never collide.
  baseUrl = await app.listen({ port: 0, host: '127.0.0.1' });
});
afterAll(() => app.close());

/**
 * Provider states: the consumer names a situation ("alice has a contact c_1"),
 * and the provider makes it true before replaying that interaction.
 * Each state starts from a clean, seeded store so interactions are independent.
 * The seed data already contains everything these states describe; the handler
 * comments say which part.
 */
const freshSeed = () => {
  store.reset();
  seed(store);
  return Promise.resolve();
};
const stateHandlers = {
  'alice has contacts': freshSeed, // c_1..c_3
  'alice has a contact c_1': freshSeed, // c_1 = Ada Lovelace
  'contact c_999 does not exist': freshSeed, // ids go up to c_4
  'alice already has a contact with email ada@example.com': freshSeed, // c_1
  'alice has an expired token': freshSeed, // token "alice-expired"
};

test('the API honors every interaction in the contacts-web pact', async () => {
  // Fail with a clear message rather than a cryptic one if the consumer step was skipped.
  expect(existsSync(pactFile), `${pactFile} not found: run "npm run test:pact:consumer" first`).toBe(true);

  await new Verifier({
    provider: 'contacts-api',
    providerBaseUrl: baseUrl,
    pactUrls: [pactFile],
    stateHandlers,
    logLevel: 'warn',
    // With a Pact Broker you would replace pactUrls with:
    //   pactBrokerUrl, consumerVersionSelectors: [{ mainBranch: true }, { deployedOrReleased: true }],
    //   providerVersion: process.env.GIT_SHA, providerVersionBranch: process.env.GIT_BRANCH,
    //   publishVerificationResult: process.env.CI === 'true'
  }).verifyProvider();
}, 60_000);
