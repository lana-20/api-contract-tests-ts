// GraphQL layer: queries, mutations, auth, the error shape and depth limiting,
// over real HTTP against Apollo Server. One server per test (fresh seeded store),
// on a free port, so tests can run in parallel and never share data.
import { beforeEach, describe, expect, test } from 'vitest';
import { TOKENS } from '../../src/store';
import { MAX_DEPTH, startGraphql } from '../src/server';

let url: string;
beforeEach(async () => {
  const server = await startGraphql();
  url = server.url;
  return server.stop;
});

/** POST one GraphQL operation and return the HTTP status and parsed body. */
async function gql(query: string, variables: object = {}, token: string | null = TOKENS.alice) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }) },
    body: JSON.stringify({ query, variables }),
  });
  return { status: res.status, body: (await res.json()) as { data?: any; errors?: any[] } };
}

describe('queries', () => {
  test('lists contacts with variables', async () => {
    const { status, body } = await gql('query ($first: Int) { contacts(first: $first) { items { id name } nextCursor } }', { first: 2 });

    expect(status).toBe(200);
    expect(body.errors).toBeUndefined();
    expect(body.data.contacts.items).toEqual([
      { id: 'c_1', name: 'Ada Lovelace' },
      { id: 'c_2', name: 'Grace Hopper' },
    ]);
    expect(body.data.contacts.nextCursor).toEqual(expect.any(String));
  });

  test('cursor pagination walks every contact exactly once', async () => {
    const ids: string[] = [];
    let after: string | null = null;
    do {
      const { body } = await gql('query ($after: String) { contacts(first: 1, after: $after) { items { id } nextCursor } }', { after });
      ids.push(...body.data.contacts.items.map((c: { id: string }) => c.id));
      after = body.data.contacts.nextCursor;
    } while (after);
    expect(ids).toEqual(['c_1', 'c_2', 'c_3']); // alice's contacts only, never bob's c_4
  });

  test("a missing (or someone else's) contact is null, not an error", async () => {
    const { body } = await gql('{ mine: contact(id: "c_1") { name } bobs: contact(id: "c_4") { name } }');
    expect(body).toEqual({ data: { mine: { name: 'Ada Lovelace' }, bobs: null } });
  });
});

describe('mutations', () => {
  const CREATE = 'mutation ($input: CreateContactInput!) { createContact(input: $input) { id name email } }';

  test('creates a contact that a later query can read', async () => {
    const created = await gql(CREATE, { input: { name: 'Mary Jackson', email: 'mary@example.com' } });
    const id = created.body.data.createContact.id;

    const read = await gql('query ($id: ID!) { contact(id: $id) { email } }', { id });
    expect(read.body.data.contact.email).toBe('mary@example.com');
  });

  test('a duplicate email is a CONFLICT error with null data', async () => {
    const { status, body } = await gql(CREATE, { input: { name: 'Ada', email: 'ada@example.com' } });

    expect(status).toBe(200); // GraphQL reports resolver errors in the body, not the HTTP status
    expect(body.data).toBeNull(); // createContact is non-null, so the null bubbles up to data
    expect(body.errors).toEqual([expect.objectContaining({ path: ['createContact'], extensions: { code: 'CONFLICT' } })]);
  });

  test('input is validated with the same rules as the REST API', async () => {
    const { body } = await gql(CREATE, { input: { name: '', email: 'not-an-email' } });

    expect(body.errors?.[0].extensions.code).toBe('BAD_USER_INPUT');
    expect(body.errors?.[0].extensions.fieldErrors.map((e: { pointer: string }) => e.pointer).sort()).toEqual(['/email', '/name']);
  });

  test('sends a message and reads it back through the contact', async () => {
    await gql('mutation { sendMessage(contactId: "c_1", body: "Hi Ada") { id } }');
    const { body } = await gql('{ contact(id: "c_1") { messages { body contact { id } } } }');
    expect(body.data.contact.messages).toEqual([{ body: 'Hi Ada', contact: { id: 'c_1' } }]);
  });

  test('deleteContact returns false when there is nothing to delete', async () => {
    const first = await gql('mutation { deleteContact(id: "c_3") }');
    const second = await gql('mutation { deleteContact(id: "c_3") }');
    expect([first.body.data.deleteContact, second.body.data.deleteContact]).toEqual([true, false]);
  });
});

describe('auth', () => {
  test.each([
    ['no token', null],
    ['an unknown token', 'not-a-real-token'],
    ['an expired token', TOKENS.aliceExpired],
  ])('%s: the whole request is rejected with HTTP 401', async (_name, token) => {
    const { status, body } = await gql('{ contacts { items { id } } }', {}, token);

    expect(status).toBe(401);
    expect(body.data).toBeUndefined();
    expect(body.errors?.[0].extensions.code).toBe('UNAUTHENTICATED');
  });

  test('a read-only token cannot run a mutation', async () => {
    const { body } = await gql('mutation { deleteContact(id: "c_1") }', {}, TOKENS.aliceReadOnly);
    expect(body.errors?.[0]).toMatchObject({ path: ['deleteContact'], extensions: { code: 'FORBIDDEN' } });
  });

  test('field-level auth: errors[] sits alongside partial data', async () => {
    // contacts:read is enough for the contacts, but Contact.messages needs messages:read.
    const { status, body } = await gql('{ contacts(first: 2) { items { name messages { body } } } }', {}, TOKENS.aliceReadOnly);

    expect(status).toBe(200);
    expect(body.data.contacts.items).toEqual([
      { name: 'Ada Lovelace', messages: null },
      { name: 'Grace Hopper', messages: null },
    ]);
    // One error per denied field, each with the path to exactly where data is missing.
    expect(body.errors?.map((e) => [e.path, e.extensions.code])).toEqual([
      [['contacts', 'items', 0, 'messages'], 'FORBIDDEN'],
      [['contacts', 'items', 1, 'messages'], 'FORBIDDEN'],
    ]);
  });
});

describe('request errors', () => {
  const nested = (levels: number) => {
    // contacts > items > messages > contact > messages > ... , `levels` fields deep.
    const fields = ['contacts', 'items'];
    while (fields.length < levels) fields.push(fields.length % 2 === 0 ? 'messages' : 'contact');
    return `{ ${fields.join(' { ')} { id } ${'} '.repeat(fields.length - 1)}}`;
  };

  test(`a query ${MAX_DEPTH} levels deep is allowed`, async () => {
    const { status, body } = await gql(nested(MAX_DEPTH - 1));
    expect(status).toBe(200);
    expect(body.errors).toBeUndefined();
  });

  test('an abusively deep query is rejected before any resolver runs', async () => {
    const { status, body } = await gql(nested(12));

    expect(status).toBe(400);
    expect(body.data).toBeUndefined();
    // Apollo reports every validation-rule failure as GRAPHQL_VALIDATION_FAILED.
    expect(body.errors?.[0]).toMatchObject({
      message: `Query depth 13 exceeds the maximum of ${MAX_DEPTH}.`,
      extensions: { code: 'GRAPHQL_VALIDATION_FAILED' },
    });
  });

  test('fragments count toward the depth too', async () => {
    const query = `
      fragment Deep on Contact { messages { contact { messages { contact { id } } } } }
      { contacts { items { ...Deep } } }`;
    const { body } = await gql(query);
    expect(body.errors?.[0].message).toBe(`Query depth 7 exceeds the maximum of ${MAX_DEPTH}.`);
  });

  test.each([
    ['a syntax error', 'GRAPHQL_PARSE_FAILED', '{ contacts { '],
    ['an unknown field', 'GRAPHQL_VALIDATION_FAILED', '{ contacts { items { password } } }'],
    ['a wrong variable type', 'BAD_USER_INPUT', 'query ($first: Int) { contacts(first: $first) { nextCursor } }'],
  ])('%s is a 400 with code %s', async (_name, code, query) => {
    const { status, body } = await gql(query, { first: 'ten' });
    expect(status).toBe(400);
    expect(body.errors?.[0].extensions.code).toBe(code);
  });

  test('errors never include stack traces', async () => {
    const { body } = await gql('{ contacts { items { password } } }');
    expect(JSON.stringify(body)).not.toMatch(/stacktrace|\.ts:\d+/);
  });
});
