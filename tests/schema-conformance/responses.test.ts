// Layer 1: provider schema conformance.
// Drive the real app (in-process, no network) through one scenario per documented
// response, and check each response against the OpenAPI spec.
import type { InjectOptions } from 'fastify';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { buildApp } from '../../src/app';
import { operations } from '../../src/spec';
import { seededStore, TOKENS, type Store } from '../../src/store';
import { expectToMatchSpec } from '../support/contract';

const auth = (token: string) => ({ authorization: `Bearer ${token}` });
const alice = auth(TOKENS.alice);

interface Scenario {
  operationId: string;
  status: number;
  name: string;
  request: InjectOptions;
  /** Runs before the request, for scenarios that need extra state. */
  arrange?: (store: Store, send: (r: InjectOptions) => Promise<unknown>) => Promise<unknown> | void;
}

const message = (key = 'key-1', body = 'Hello!'): InjectOptions => ({
  method: 'POST',
  url: '/contacts/c_1/messages',
  headers: { ...alice, 'idempotency-key': key },
  payload: { body },
});

const scenarios: Scenario[] = [
  // listContacts
  { operationId: 'listContacts', status: 200, name: 'first page', request: { method: 'GET', url: '/contacts', headers: alice } },
  { operationId: 'listContacts', status: 200, name: 'page with a cursor', request: { method: 'GET', url: '/contacts?limit=1&cursor=Y18x' /* base64url('c_1') */, headers: alice } },
  { operationId: 'listContacts', status: 401, name: 'no token', request: { method: 'GET', url: '/contacts' } },
  { operationId: 'listContacts', status: 403, name: 'no scopes', request: { method: 'GET', url: '/contacts', headers: auth(TOKENS.aliceNoScopes) } },
  { operationId: 'listContacts', status: 422, name: 'limit out of range', request: { method: 'GET', url: '/contacts?limit=500', headers: alice } },

  // createContact
  { operationId: 'createContact', status: 201, name: 'valid contact', request: { method: 'POST', url: '/contacts', headers: alice, payload: { name: 'Mary Jackson', email: 'mary@example.com' } } },
  { operationId: 'createContact', status: 400, name: 'malformed JSON', request: { method: 'POST', url: '/contacts', headers: { ...alice, 'content-type': 'application/json' }, payload: '{"name":' } },
  { operationId: 'createContact', status: 401, name: 'no token', request: { method: 'POST', url: '/contacts', payload: {} } },
  { operationId: 'createContact', status: 403, name: 'read-only token', request: { method: 'POST', url: '/contacts', headers: auth(TOKENS.aliceReadOnly), payload: {} } },
  { operationId: 'createContact', status: 409, name: 'duplicate email', request: { method: 'POST', url: '/contacts', headers: alice, payload: { name: 'Ada again', email: 'ADA@example.com' } } },
  { operationId: 'createContact', status: 422, name: 'invalid fields', request: { method: 'POST', url: '/contacts', headers: alice, payload: { name: '', email: 'not-an-email', nickname: 'x' } } },

  // getContact
  { operationId: 'getContact', status: 200, name: 'own contact', request: { method: 'GET', url: '/contacts/c_1', headers: alice } },
  { operationId: 'getContact', status: 401, name: 'expired token', request: { method: 'GET', url: '/contacts/c_1', headers: auth(TOKENS.aliceExpired) } },
  { operationId: 'getContact', status: 403, name: 'no scopes', request: { method: 'GET', url: '/contacts/c_1', headers: auth(TOKENS.aliceNoScopes) } },
  { operationId: 'getContact', status: 404, name: "another user's contact", request: { method: 'GET', url: '/contacts/c_4', headers: alice } },

  // updateContact
  { operationId: 'updateContact', status: 200, name: 'change the phone', request: { method: 'PATCH', url: '/contacts/c_2', headers: alice, payload: { phone: '+15551234567' } } },
  { operationId: 'updateContact', status: 400, name: 'malformed JSON', request: { method: 'PATCH', url: '/contacts/c_2', headers: { ...alice, 'content-type': 'application/json' }, payload: 'nope' } },
  { operationId: 'updateContact', status: 401, name: 'unknown token', request: { method: 'PATCH', url: '/contacts/c_2', headers: auth('made-up'), payload: {} } },
  { operationId: 'updateContact', status: 403, name: 'read-only token', request: { method: 'PATCH', url: '/contacts/c_2', headers: auth(TOKENS.aliceReadOnly), payload: {} } },
  { operationId: 'updateContact', status: 404, name: 'missing contact', request: { method: 'PATCH', url: '/contacts/c_999', headers: alice, payload: { name: 'X' } } },
  { operationId: 'updateContact', status: 409, name: "another contact's email", request: { method: 'PATCH', url: '/contacts/c_2', headers: alice, payload: { email: 'ada@example.com' } } },
  { operationId: 'updateContact', status: 422, name: 'empty patch', request: { method: 'PATCH', url: '/contacts/c_2', headers: alice, payload: {} } },

  // deleteContact
  { operationId: 'deleteContact', status: 204, name: 'own contact', request: { method: 'DELETE', url: '/contacts/c_3', headers: alice } },
  { operationId: 'deleteContact', status: 401, name: 'no token', request: { method: 'DELETE', url: '/contacts/c_3' } },
  { operationId: 'deleteContact', status: 403, name: 'read-only token', request: { method: 'DELETE', url: '/contacts/c_3', headers: auth(TOKENS.aliceReadOnly) } },
  { operationId: 'deleteContact', status: 404, name: 'already deleted', request: { method: 'DELETE', url: '/contacts/c_3', headers: alice }, arrange: (_s, send) => send({ method: 'DELETE', url: '/contacts/c_3', headers: alice }) },

  // sendMessage
  { operationId: 'sendMessage', status: 201, name: 'first send', request: message() },
  { operationId: 'sendMessage', status: 201, name: 'replay with the same key', request: message(), arrange: (_s, send) => send(message()) },
  { operationId: 'sendMessage', status: 400, name: 'no Idempotency-Key', request: { method: 'POST', url: '/contacts/c_1/messages', headers: alice, payload: { body: 'Hi' } } },
  { operationId: 'sendMessage', status: 401, name: 'no token', request: { method: 'POST', url: '/contacts/c_1/messages', payload: { body: 'Hi' } } },
  { operationId: 'sendMessage', status: 403, name: 'read-only token', request: { ...message(), headers: { ...auth(TOKENS.aliceReadOnly), 'idempotency-key': 'k' } } },
  { operationId: 'sendMessage', status: 404, name: 'missing contact', request: { ...message(), url: '/contacts/c_999/messages' } },
  { operationId: 'sendMessage', status: 422, name: 'empty body', request: message('key-2', '') },
  { operationId: 'sendMessage', status: 422, name: 'key reused with a different body', request: message('key-3', 'Second'), arrange: (_s, send) => send(message('key-3', 'First')) },

  // 500 for every operation: the token lookup throws, as if a database were down.
  ...operations.map(
    (op): Scenario => ({
      operationId: op.operationId,
      status: 500,
      name: 'store failure',
      request: { method: op.method.toUpperCase() as 'GET', url: op.path.replace('{contactId}', 'c_1'), headers: alice },
      arrange: (store) => {
        vi.spyOn(store.tokens, 'get').mockImplementation(() => {
          throw new Error('connection refused: 10.0.0.12:5432');
        });
      },
    }),
  ),
];

let store: Store;
let app: ReturnType<typeof buildApp>;

beforeEach(async () => {
  // A fresh store and app per test: no test can see another test's writes.
  store = seededStore();
  app = buildApp({ store });
  return () => app.close();
});

describe.each(operations.map((op) => op.operationId))('%s', (operationId) => {
  test.each(scenarios.filter((s) => s.operationId === operationId))(
    '$status $name',
    async ({ status, request, arrange }) => {
      await arrange?.(store, (r) => app.inject(r));
      const res = await app.inject(request);

      expect(res.statusCode).toBe(status);
      expectToMatchSpec(operationId, res);
    },
  );
});

test('every response documented in the spec has at least one scenario', () => {
  // Guards against the suite silently falling behind the spec: add a status code
  // to openapi.yaml without a scenario here, and this test fails.
  const documented = operations.flatMap((op) => Object.keys(op.responses).map((s) => `${op.operationId} ${s}`));
  const covered = new Set(scenarios.map((s) => `${s.operationId} ${s.status}`));
  expect(documented.filter((key) => !covered.has(key))).toEqual([]);
});
