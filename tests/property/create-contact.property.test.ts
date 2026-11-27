// Layer 5: property-based checks with fast-check, on one endpoint (POST /contacts)
// plus pagination. Instead of hand-picked examples, fast-check generates many
// inputs from rules that mirror the spec, and shrinks any failure to a minimal case.
//
// Runs are random by default so each CI run explores new inputs. A failure prints
// the seed; rerun it exactly with FC_SEED=<seed> npm run test:property.
import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { buildApp } from '../../src/app';
import { seededStore, TOKENS } from '../../src/store';
import type { ContactCreate } from '../../src/types';
import { expectToMatchSpec } from '../support/contract';

const params = {
  numRuns: 100,
  ...(process.env.FC_SEED && { seed: Number(process.env.FC_SEED) }),
};
const alice = { authorization: `Bearer ${TOKENS.alice}` };

// Generators that follow the ContactCreate schema in openapi.yaml.
const validName = fc.string({ minLength: 1, maxLength: 100 });
const validEmail = fc.emailAddress().filter((e) => e.length <= 254);
const validPhone = fc.stringMatching(/^\+[1-9][0-9]{1,14}$/);
const validContact: fc.Arbitrary<ContactCreate> = fc.record(
  { name: validName, email: validEmail, phone: validPhone },
  { requiredKeys: ['name', 'email'] },
);

// One way to break each field, so we know which pointer the error must name.
const invalidField = fc.oneof(
  fc.record({ field: fc.constant('name'), value: fc.oneof(fc.constant(''), fc.string({ minLength: 101, maxLength: 120 }), fc.integer()) }),
  fc.record({ field: fc.constant('email'), value: fc.oneof(fc.string().filter((s) => !s.includes('@')), fc.boolean()) }),
  fc.record({ field: fc.constant('phone'), value: fc.oneof(fc.stringMatching(/^[0-9]{3}-[0-9]{4}$/), fc.constant('+0123')) }),
);

/** A brand-new app per run, so runs cannot affect each other. */
async function withApp<T>(fn: (app: ReturnType<typeof buildApp>) => Promise<T>): Promise<T> {
  const app = buildApp({ store: seededStore() });
  try {
    return await fn(app);
  } finally {
    await app.close();
  }
}

describe('POST /contacts', () => {
  test('any valid contact is created, conforms to the spec, and reads back unchanged', async () => {
    await fc.assert(
      fc.asyncProperty(validContact, (input) =>
        withApp(async (app) => {
          const created = await app.inject({ method: 'POST', url: '/contacts', headers: alice, payload: input });
          expect(created.statusCode).toBe(201);
          expectToMatchSpec('createContact', created);

          const read = await app.inject({ method: 'GET', url: created.headers.location as string, headers: alice });
          expect(read.json()).toMatchObject(input);
        }),
      ),
      params,
    );
  });

  test('a contact with one invalid field gets a 422 pointing at that field', async () => {
    await fc.assert(
      fc.asyncProperty(validContact, invalidField, (input, { field, value }) =>
        withApp(async (app) => {
          const res = await app.inject({ method: 'POST', url: '/contacts', headers: alice, payload: { ...input, [field]: value } });
          expect(res.statusCode).toBe(422);
          expectToMatchSpec('createContact', res);
          expect(res.json().errors.map((e: { pointer: string }) => e.pointer)).toContain(`/${field}`);
        }),
      ),
      params,
    );
  });

  test('fuzz: any JSON body gets a documented response, never a 500', async () => {
    await fc.assert(
      fc.asyncProperty(fc.jsonValue(), (body) =>
        withApp(async (app) => {
          const res = await app.inject({
            method: 'POST',
            url: '/contacts',
            headers: { ...alice, 'content-type': 'application/json' },
            payload: JSON.stringify(body),
          });
          expect(res.statusCode).toBeLessThan(500);
          expectToMatchSpec('createContact', res); // also fails on any undocumented status
        }),
      ),
      params,
    );
  });
});

describe('GET /contacts pagination', () => {
  test('following nextCursor returns every contact exactly once, in order', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 0, max: 30 }), fc.integer({ min: 1, max: 10 }), (extra, limit) =>
        withApp(async (app) => {
          for (let i = 0; i < extra; i++) {
            await app.inject({ method: 'POST', url: '/contacts', headers: alice, payload: { name: `P${i}`, email: `p${i}@example.com` } });
          }
          const seen: string[] = [];
          let cursor: string | null = null;
          do {
            const qs: string = `limit=${limit}${cursor ? `&cursor=${cursor}` : ''}`;
            const res = await app.inject({ method: 'GET', url: `/contacts?${qs}`, headers: alice });
            expectToMatchSpec('listContacts', res);
            const page = res.json();
            expect(page.items.length).toBeLessThanOrEqual(limit);
            seen.push(...page.items.map((c: { id: string }) => c.id));
            cursor = page.nextCursor;
          } while (cursor);

          const total = 3 + extra; // alice starts with 3 seeded contacts
          expect(seen).toHaveLength(total);
          expect(new Set(seen).size).toBe(total);
          expect(seen).toEqual([...seen].sort((a, b) => Number(a.slice(2)) - Number(b.slice(2))));
        }),
      ),
      { ...params, numRuns: 30 },
    );
  });
});
