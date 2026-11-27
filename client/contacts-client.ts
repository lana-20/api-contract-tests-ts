// The consumer: a small typed client a front end or another service would use.
// Its types come from the types generated from the spec, so if the spec renames
// or removes a field the client uses, `tsc` fails before any test runs.
//
// In a real setup the consumer team would generate these types from the provider's
// published spec; here both live in one repo to keep the demo self-contained.
import type { components, operations } from '../src/generated/openapi';

type Schemas = components['schemas'];
export type Contact = Schemas['Contact'];
export type ContactCreate = Schemas['ContactCreate'];
export type Problem = Schemas['Problem'];
type ListQuery = NonNullable<operations['listContacts']['parameters']['query']>;

/** Thrown for any non-2xx response, carrying the RFC 9457 problem body. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly problem: Problem,
  ) {
    super(`${status} ${problem.title}${problem.detail ? `: ${problem.detail}` : ''}`);
  }
}

export interface ClientOptions {
  baseUrl: string;
  token: string;
}

export class ContactsClient {
  constructor(private readonly options: ClientOptions) {}

  listContacts(query: ListQuery = {}): Promise<Schemas['ContactPage']> {
    const params = new URLSearchParams();
    if (query.limit !== undefined) params.set('limit', String(query.limit));
    if (query.cursor !== undefined) params.set('cursor', query.cursor);
    const qs = params.size > 0 ? `?${params}` : '';
    return this.request('GET', `/contacts${qs}`);
  }

  getContact(id: string): Promise<Contact> {
    return this.request('GET', `/contacts/${encodeURIComponent(id)}`);
  }

  createContact(input: ContactCreate): Promise<Contact> {
    return this.request('POST', '/contacts', { body: input });
  }

  /** Pass the same idempotencyKey when retrying, so the message is not sent twice. */
  sendMessage(contactId: string, body: string, idempotencyKey: string): Promise<Schemas['Message']> {
    return this.request('POST', `/contacts/${encodeURIComponent(contactId)}/messages`, {
      body: { body } satisfies Schemas['MessageCreate'],
      headers: { 'Idempotency-Key': idempotencyKey },
    });
  }

  private async request<T>(
    method: string,
    path: string,
    init: { body?: unknown; headers?: Record<string, string> } = {},
  ): Promise<T> {
    const res = await fetch(`${this.options.baseUrl}${path}`, {
      method,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${this.options.token}`,
        ...(init.body !== undefined && { 'Content-Type': 'application/json' }),
        ...init.headers,
      },
      ...(init.body !== undefined && { body: JSON.stringify(init.body) }),
    });
    if (!res.ok) throw new ApiError(res.status, (await res.json()) as Problem);
    return (await res.json()) as T;
  }
}
