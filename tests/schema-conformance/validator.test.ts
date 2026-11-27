// Tests for the checker itself. A conformance check that never fails is worse than
// none, so each rule gets a response that should break it.
import { describe, expect, test, vi } from 'vitest';
import { buildApp } from '../../src/app';
import { handlers } from '../../src/handlers';
import { seededStore, TOKENS } from '../../src/store';
import { contractViolations, type HttpResponse } from '../support/contract';

const contact = {
  id: 'c_1',
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};
const json = (statusCode: number, body: unknown, headers = {}): HttpResponse => ({
  statusCode,
  headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  body: JSON.stringify(body),
});

describe('contractViolations', () => {
  test('accepts a valid response', () => {
    expect(contractViolations('getContact', json(200, contact))).toEqual([]);
  });

  test.each([
    ['an undocumented status code', 'getContact', json(418, contact), /status 418 is not documented/],
    ['an undocumented field', 'getContact', json(200, { ...contact, ownerId: 'alice' }), /must NOT have additional properties/],
    ['a missing required field', 'getContact', json(200, { ...contact, email: undefined }), /must have required property 'email'/],
    ['a wrong type', 'getContact', json(200, { ...contact, id: 1 }), /body\/id must be string/],
    ['a bad format', 'getContact', json(200, { ...contact, createdAt: 'yesterday' }), /must match format "date-time"/],
    ['the wrong content type', 'getContact', { ...json(200, contact), headers: { 'content-type': 'text/html' } }, /content-type "text\/html"/],
    ['a missing required header', 'createContact', json(201, contact), /required header Location is missing/],
    ['a body on a 204', 'deleteContact', { statusCode: 204, headers: {}, body: '{}' }, /expected no body/],
    ['a problem type outside the catalog', 'getContact', { ...json(404, { type: 'about:blank', title: 'x', status: 404 }), headers: { 'content-type': 'application/problem+json' } }, /must be equal to one of the allowed values/],
  ])('rejects %s', (_name, operationId, response, expected) => {
    expect(contractViolations(operationId, response).join('\n')).toMatch(expected);
  });
});

test('catches a handler that leaks an internal field', async () => {
  // Simulate a real bug: returning the stored record instead of the public shape.
  vi.spyOn(handlers, 'getContact').mockImplementation((ctx) => ({
    status: 200,
    body: ctx.store.getContact(ctx.principal.userId, ctx.params.contactId!),
  }));
  const app = buildApp({ store: seededStore() });

  const res = await app.inject({ method: 'GET', url: '/contacts/c_1', headers: { authorization: `Bearer ${TOKENS.alice}` } });

  expect(contractViolations('getContact', res)).toEqual([
    'body must NOT have additional properties {"additionalProperty":"ownerId"}',
  ]);
  vi.restoreAllMocks();
  await app.close();
});
