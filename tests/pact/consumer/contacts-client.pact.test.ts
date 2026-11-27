// Layer 3a: consumer-driven contract tests (Pact V4).
// The consumer's real client runs against a Pact mock server. Each interaction
// records only what this consumer actually sends and relies on, and the passing
// test writes pacts/contacts-web-contacts-api.json for the provider to verify.
import path from 'node:path';
import { MatchersV3, PactV4 } from '@pact-foundation/pact';
import { describe, expect, test } from 'vitest';
import { ApiError, ContactsClient } from '../../../client/contacts-client';

const { like, eachLike, regex, string } = MatchersV3;

const pact = new PactV4({
  consumer: 'contacts-web',
  provider: 'contacts-api',
  dir: path.resolve(import.meta.dirname, '../../../pacts'),
  logLevel: 'warn',
});

// Matchers say "any value of this shape"; the second argument is the example the
// mock server returns. The provider's real values (ids, timestamps) only have to match.
// Pact regexes must match the whole value, hence the trailing `.*$` on header matchers
// (the real API sends `application/json; charset=utf-8`).
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const contactBody = {
  id: regex(/^c_[0-9]+$/, 'c_1'),
  name: string('Ada Lovelace'),
  email: string('ada@example.com'),
  createdAt: regex(ISO_DATE_TIME, '2026-01-01T00:00:00.000Z'),
  // The consumer does not use `phone` or `updatedAt`, so the pact does not mention
  // them. The provider is free to change them without breaking this consumer.
};
const bearer = (token: string) => ({ Authorization: regex(/^Bearer \S+$/, `Bearer ${token}`) });
const json = { 'Content-Type': regex(/^application\/json.*$/, 'application/json') };
const problemJson = { 'Content-Type': regex(/^application\/problem\+json.*$/, 'application/problem+json') };

// The example tokens below exist in the provider's seed data (src/store.ts).
const client = (baseUrl: string, token = 'alice-token') => new ContactsClient({ baseUrl, token });

describe('contacts-web -> contacts-api', () => {
  test('lists the first page of contacts', () =>
    pact
      .addInteraction()
      .given('alice has contacts')
      .uponReceiving('a request for the first page of contacts')
      .withRequest('GET', '/contacts', (req) => req.query({ limit: '2' }).headers(bearer('alice-token')))
      .willRespondWith(200, (res) =>
        res.headers(json).jsonBody({
          items: eachLike(contactBody),
          nextCursor: like('Y18y'),
        }),
      )
      .executeTest(async (mock) => {
        const page = await client(mock.url).listContacts({ limit: 2 });
        expect(page.items[0]?.name).toBe('Ada Lovelace');
        expect(page.nextCursor).toBe('Y18y');
      }));

  test('gets one contact', () =>
    pact
      .addInteraction()
      .given('alice has a contact c_1')
      .uponReceiving('a request for contact c_1')
      .withRequest('GET', '/contacts/c_1', (req) => req.headers(bearer('alice-token')))
      .willRespondWith(200, (res) => res.headers(json).jsonBody(contactBody))
      .executeTest(async (mock) => {
        const contact = await client(mock.url).getContact('c_1');
        expect(contact.id).toBe('c_1');
      }));

  test('gets a 404 problem for a missing contact', () =>
    pact
      .addInteraction()
      .given('contact c_999 does not exist')
      .uponReceiving('a request for a contact that does not exist')
      .withRequest('GET', '/contacts/c_999', (req) => req.headers(bearer('alice-token')))
      .willRespondWith(404, (res) =>
        res.headers(problemJson).jsonBody({
          type: 'https://contacts.example/problems/not-found', // exact: the client switches on it
          status: 404,
          title: string('Not found'),
        }),
      )
      .executeTest(async (mock) => {
        const error = await client(mock.url).getContact('c_999').catch((e: unknown) => e);
        expect(error).toBeInstanceOf(ApiError);
        expect((error as ApiError).problem.type).toBe('https://contacts.example/problems/not-found');
      }));

  test('creates a contact', () =>
    pact
      .addInteraction()
      .given('alice has contacts')
      .uponReceiving('a request to create a contact')
      .withRequest('POST', '/contacts', (req) =>
        req.headers({ ...bearer('alice-token'), ...json }).jsonBody({ name: 'Mary Jackson', email: 'mary@example.com' }),
      )
      .willRespondWith(201, (res) =>
        res
          .headers({ ...json, Location: regex(/^\/contacts\/c_[0-9]+$/, '/contacts/c_5') })
          .jsonBody({ ...contactBody, name: string('Mary Jackson'), email: string('mary@example.com') }),
      )
      .executeTest(async (mock) => {
        const created = await client(mock.url).createContact({ name: 'Mary Jackson', email: 'mary@example.com' });
        expect(created.email).toBe('mary@example.com');
      }));

  test('gets a 409 problem for a duplicate email', () =>
    pact
      .addInteraction()
      .given('alice already has a contact with email ada@example.com')
      .uponReceiving('a request to create a contact with a duplicate email')
      .withRequest('POST', '/contacts', (req) =>
        req.headers({ ...bearer('alice-token'), ...json }).jsonBody({ name: 'Ada', email: 'ada@example.com' }),
      )
      .willRespondWith(409, (res) =>
        res.headers(problemJson).jsonBody({ type: 'https://contacts.example/problems/conflict', status: 409 }),
      )
      .executeTest(async (mock) => {
        const error = await client(mock.url)
          .createContact({ name: 'Ada', email: 'ada@example.com' })
          .catch((e: unknown) => e);
        expect((error as ApiError).status).toBe(409);
      }));

  test('sends a message with an idempotency key', () =>
    pact
      .addInteraction()
      .given('alice has a contact c_1')
      .uponReceiving('a request to send a message')
      .withRequest('POST', '/contacts/c_1/messages', (req) =>
        req
          .headers({ ...bearer('alice-token'), ...json, 'Idempotency-Key': like('7c1e7d2e-0b7a-4c55-9f0e-3f1a0c9b2d11') })
          .jsonBody({ body: 'See you at 10.' }),
      )
      .willRespondWith(201, (res) =>
        res.headers(json).jsonBody({
          id: regex(/^m_[0-9]+$/, 'm_1'),
          contactId: 'c_1',
          body: 'See you at 10.',
        }),
      )
      .executeTest(async (mock) => {
        const message = await client(mock.url).sendMessage('c_1', 'See you at 10.', '7c1e7d2e-0b7a-4c55-9f0e-3f1a0c9b2d11');
        expect(message.contactId).toBe('c_1');
      }));

  test('gets a 401 problem when the token has expired', () =>
    pact
      .addInteraction()
      .given('alice has an expired token')
      .uponReceiving('a request with an expired token')
      .withRequest('GET', '/contacts', (req) => req.headers(bearer('alice-expired')))
      .willRespondWith(401, (res) =>
        res
          .headers({ ...problemJson, 'WWW-Authenticate': regex(/^Bearer .*error="invalid_token".*$/, 'Bearer realm="contacts", error="invalid_token"') })
          .jsonBody({ type: 'https://contacts.example/problems/unauthorized', status: 401 }),
      )
      .executeTest(async (mock) => {
        const error = await client(mock.url, 'alice-expired').listContacts().catch((e: unknown) => e);
        // The client's job here is to surface a typed 401 so the app can send the user to log in.
        expect((error as ApiError).status).toBe(401);
      }));
});
