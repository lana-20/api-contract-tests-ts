// Layer 2a: the auth matrix. Every operation in the spec x every way a token can be wrong.
// The operations and their required scopes are read from the spec, so a new
// endpoint is covered automatically, and a missing scope check is caught.
import type { InjectOptions } from 'fastify';
import { beforeEach, describe, expect, test } from 'vitest';
import { buildApp } from '../../src/app';
import { operations, type Operation } from '../../src/spec';
import { seededStore, TOKENS } from '../../src/store';

let app: ReturnType<typeof buildApp>;
beforeEach(() => {
  app = buildApp({ store: seededStore() });
  return () => app.close();
});

/** A request that succeeds with a full-scope token. Only the Authorization header varies. */
function validRequest(op: Operation, authorization?: string): InjectOptions {
  const payloads: Record<string, object> = {
    createContact: { name: 'Mary Jackson', email: 'mary@example.com' },
    updateContact: { name: 'Ada King' },
    sendMessage: { body: 'Hello!' },
  };
  return {
    method: op.method.toUpperCase() as 'GET',
    url: op.path.replace('{contactId}', 'c_1'),
    headers: {
      ...(authorization !== undefined && { authorization }),
      ...(op.operationId === 'sendMessage' && { 'idempotency-key': 'auth-matrix' }),
    },
    ...(payloads[op.operationId] !== undefined && { payload: payloads[op.operationId] }),
  };
}

const realm = 'Bearer realm="contacts"';
const invalidToken = expect.stringMatching(/^Bearer realm="contacts", error="invalid_token"/);

const badCredentials = [
  { name: 'no Authorization header', authorization: undefined, challenge: realm },
  { name: 'a non-Bearer scheme', authorization: 'Basic YWxpY2U6c2VjcmV0', challenge: realm },
  { name: 'Bearer with no token', authorization: 'Bearer ', challenge: realm },
  { name: 'an unknown token', authorization: 'Bearer not-a-real-token', challenge: invalidToken },
  { name: 'an expired token', authorization: `Bearer ${TOKENS.aliceExpired}`, challenge: invalidToken },
];

describe.each(operations)('$operationId', (op) => {
  test.each(badCredentials)('401 for $name', async ({ authorization, challenge }) => {
    const res = await app.inject(validRequest(op, authorization));

    expect(res.statusCode).toBe(401);
    expect(res.headers['www-authenticate']).toEqual(challenge);
    expect(res.json()).toMatchObject({ type: 'https://contacts.example/problems/unauthorized', status: 401 });
  });

  test('403 naming the missing scope for a token without scopes', async () => {
    const res = await app.inject(validRequest(op, `Bearer ${TOKENS.aliceNoScopes}`));

    expect(res.statusCode).toBe(403);
    expect(res.headers['www-authenticate']).toBe(`${realm}, error="insufficient_scope", scope="${op.scopes[0]}"`);
    expect(res.json()).toMatchObject({ type: 'https://contacts.example/problems/forbidden', status: 403 });
  });

  test('read-only token is allowed exactly when the spec asks only for contacts:read', async () => {
    const readOnlyAllowed = op.scopes.every((scope) => scope === 'contacts:read');
    const res = await app.inject(validRequest(op, `Bearer ${TOKENS.aliceReadOnly}`));

    expect(res.statusCode).toBe(readOnlyAllowed ? successStatus(op) : 403);
  });

  test('succeeds with a full-scope token, and the scheme name is case-insensitive', async () => {
    const res = await app.inject(validRequest(op, `bearer ${TOKENS.alice}`));
    expect(res.statusCode).toBe(successStatus(op));
  });
});

function successStatus(op: Operation): number {
  return Number(Object.keys(op.responses).find((status) => status.startsWith('2')));
}

test('every operation requires at least one scope (no accidentally public endpoints)', () => {
  expect(operations.filter((op) => op.scopes.length === 0).map((op) => op.operationId)).toEqual([]);
});
