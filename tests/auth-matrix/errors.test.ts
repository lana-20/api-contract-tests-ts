// Layer 2b: the error-code matrix. Each row is one way a request can go wrong and
// the exact status, problem type and field pointer a client should get back.
import type { InjectOptions } from 'fastify';
import { beforeEach, expect, test, vi } from 'vitest';
import { buildApp } from '../../src/app';
import { seededStore, TOKENS, type Store } from '../../src/store';

const alice = { authorization: `Bearer ${TOKENS.alice}` };
const P = 'https://contacts.example/problems/';

let store: Store;
let app: ReturnType<typeof buildApp>;
beforeEach(() => {
  store = seededStore();
  app = buildApp({ store });
  return () => app.close();
});

interface ErrorCase {
  name: string;
  request: InjectOptions;
  status: number;
  type: string;
  errors?: Array<{ pointer?: string; parameter?: string }>;
}

const cases: ErrorCase[] = [
  { name: 'malformed JSON', status: 400, type: 'bad-request', request: { method: 'POST', url: '/contacts', headers: { ...alice, 'content-type': 'application/json' }, payload: '{' } },
  { name: 'missing Idempotency-Key', status: 400, type: 'bad-request', errors: [{ parameter: 'idempotency-key' }], request: { method: 'POST', url: '/contacts/c_1/messages', headers: alice, payload: { body: 'Hi' } } },
  // Authentication is checked before validation: an anonymous caller learns nothing about the schema.
  { name: 'invalid body and no token', status: 401, type: 'unauthorized', request: { method: 'POST', url: '/contacts', payload: { name: 42 } } },
  // Another user's resource looks exactly like a missing one, so ids can't be probed.
  { name: "another user's contact", status: 404, type: 'not-found', request: { method: 'GET', url: '/contacts/c_4', headers: alice } },
  { name: 'unknown route', status: 404, type: 'not-found', request: { method: 'GET', url: '/does-not-exist', headers: alice } },
  { name: 'duplicate email (case-insensitive)', status: 409, type: 'conflict', request: { method: 'POST', url: '/contacts', headers: alice, payload: { name: 'Ada', email: 'Ada@Example.com' } } },
  { name: 'missing required field', status: 422, type: 'validation-error', errors: [{ pointer: '/email' }], request: { method: 'POST', url: '/contacts', headers: alice, payload: { name: 'No Email' } } },
  { name: 'undocumented field', status: 422, type: 'validation-error', errors: [{ pointer: '/nickname' }], request: { method: 'POST', url: '/contacts', headers: alice, payload: { name: 'A', email: 'a@example.com', nickname: 'x' } } },
  { name: 'phone not in E.164', status: 422, type: 'validation-error', errors: [{ pointer: '/phone' }], request: { method: 'POST', url: '/contacts', headers: alice, payload: { name: 'A', email: 'a@example.com', phone: '555-1234' } } },
  { name: 'wrong JSON type', status: 422, type: 'validation-error', errors: [{ pointer: '/name' }], request: { method: 'PATCH', url: '/contacts/c_1', headers: alice, payload: { name: 42 } } },
  { name: 'limit is not a number', status: 422, type: 'validation-error', errors: [{ parameter: 'limit' }], request: { method: 'GET', url: '/contacts?limit=ten', headers: alice } },
  { name: 'tampered cursor', status: 422, type: 'validation-error', errors: [{ parameter: 'cursor' }], request: { method: 'GET', url: '/contacts?cursor=garbage', headers: alice } },
  { name: 'message body too long', status: 422, type: 'validation-error', errors: [{ pointer: '/body' }], request: { method: 'POST', url: '/contacts/c_1/messages', headers: { ...alice, 'idempotency-key': 'k' }, payload: { body: 'x'.repeat(1001) } } },
];

test.each(cases)('$status $type: $name', async ({ request, status, type, errors }) => {
  const res = await app.inject(request);
  const problem = res.json();

  expect(res.statusCode).toBe(status);
  expect(res.headers['content-type']).toMatch(/^application\/problem\+json/);
  // RFC 9457: `status` in the body must match the HTTP status.
  expect(problem).toMatchObject({ type: P + type, status, instance: request.url });
  if (errors) expect(problem.errors).toEqual(errors.map((e) => expect.objectContaining(e)));
});

test('500 does not leak internal details', async () => {
  vi.spyOn(store, 'listContacts').mockImplementation(() => {
    throw new Error('connection refused: 10.0.0.12:5432');
  });

  const res = await app.inject({ method: 'GET', url: '/contacts', headers: alice });

  expect(res.statusCode).toBe(500);
  expect(res.json()).toEqual({
    type: `${P}internal-error`,
    title: 'Internal server error',
    status: 500,
    detail: 'An unexpected error occurred.',
    instance: '/contacts',
  });
  expect(res.body).not.toMatch(/10\.0\.0\.12|connection refused|at .*\.ts/);
});

test('idempotent replay returns the original message and does not send twice', async () => {
  const send = (body: string) =>
    app.inject({ method: 'POST', url: '/contacts/c_1/messages', headers: { ...alice, 'idempotency-key': 'retry-1' }, payload: { body } });

  const first = await send('Hello');
  const retry = await send('Hello');
  const reused = await send('Something else');

  expect(first.statusCode).toBe(201);
  expect(first.headers['idempotent-replayed']).toBeUndefined();
  expect(retry.statusCode).toBe(201);
  expect(retry.headers['idempotent-replayed']).toBe('true');
  expect(retry.json()).toEqual(first.json()); // same id: no second message was created
  expect(reused.statusCode).toBe(422);
  expect(reused.json().type).toBe(`${P}idempotency-key-reused`);
});
