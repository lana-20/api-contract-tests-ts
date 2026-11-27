// An in-memory store. Every app instance gets its own Store, so tests never share
// mutable state, and the seed data and clock are fixed, so results are deterministic.
import type { Contact, ContactCreate, ContactUpdate, Message } from './types';

/** Returns "now". Injected so tests control time instead of reading the real clock. */
export type Clock = () => Date;

/** A clock that starts at `start` and moves forward one second per call. */
export function steppingClock(start = '2026-01-01T00:00:00.000Z'): Clock {
  let ms = Date.parse(start);
  return () => {
    const now = new Date(ms);
    ms += 1000;
    return now;
  };
}

export interface TokenRecord {
  userId: string;
  scopes: string[];
  expiresAt: Date;
}

/** What we store. `ownerId` is internal and must never appear in a response. */
export interface ContactRecord extends Contact {
  ownerId: string;
}

export interface IdempotencyRecord {
  fingerprint: string;
  message: Message;
}

export class Store {
  readonly tokens = new Map<string, TokenRecord>();
  private readonly contacts = new Map<string, ContactRecord>();
  private readonly messages = new Map<string, Message & { ownerId: string }>();
  private readonly idempotency = new Map<string, IdempotencyRecord>();
  private nextContactId = 1;
  private nextMessageId = 1;

  constructor(readonly clock: Clock = steppingClock()) {}

  /** Empty the store. Used by Pact provider states to start each interaction clean. */
  reset(): void {
    this.tokens.clear();
    this.contacts.clear();
    this.messages.clear();
    this.idempotency.clear();
    this.nextContactId = 1;
    this.nextMessageId = 1;
  }

  addToken(token: string, record: TokenRecord): void {
    this.tokens.set(token, record);
  }

  /** Contacts of one owner in id order, starting after `afterId`. */
  listContacts(ownerId: string, options: { afterId?: string; limit: number }) {
    const afterNumber = options.afterId ? idNumber(options.afterId) : 0;
    const mine = [...this.contacts.values()]
      .filter((c) => c.ownerId === ownerId && idNumber(c.id) > afterNumber)
      .sort((a, b) => idNumber(a.id) - idNumber(b.id));
    return { items: mine.slice(0, options.limit), hasMore: mine.length > options.limit };
  }

  getContact(ownerId: string, id: string): ContactRecord | undefined {
    const contact = this.contacts.get(id);
    // Another user's contact is reported as "not found", not "forbidden",
    // so callers cannot probe which ids exist.
    return contact?.ownerId === ownerId ? contact : undefined;
  }

  emailTaken(ownerId: string, email: string, exceptId?: string): boolean {
    const wanted = email.toLowerCase();
    return [...this.contacts.values()].some(
      (c) => c.ownerId === ownerId && c.id !== exceptId && c.email.toLowerCase() === wanted,
    );
  }

  createContact(ownerId: string, input: ContactCreate): ContactRecord {
    const now = this.clock().toISOString();
    const record: ContactRecord = {
      ...input,
      id: `c_${this.nextContactId++}`,
      ownerId,
      createdAt: now,
      updatedAt: now,
    };
    this.contacts.set(record.id, record);
    return record;
  }

  updateContact(record: ContactRecord, changes: ContactUpdate): ContactRecord {
    Object.assign(record, changes, { updatedAt: this.clock().toISOString() });
    return record;
  }

  deleteContact(record: ContactRecord): void {
    this.contacts.delete(record.id);
  }

  createMessage(ownerId: string, contactId: string, body: string): Message {
    const message = {
      id: `m_${this.nextMessageId++}`,
      contactId,
      body,
      createdAt: this.clock().toISOString(),
    };
    this.messages.set(message.id, { ...message, ownerId });
    return message;
  }

  listMessages(ownerId: string, contactId: string): Message[] {
    return [...this.messages.values()]
      .filter((m) => m.ownerId === ownerId && m.contactId === contactId)
      .map(({ ownerId: _owner, ...message }) => message);
  }

  // Idempotency keys are scoped per user, so two users can pick the same key.
  getIdempotency(userId: string, key: string): IdempotencyRecord | undefined {
    return this.idempotency.get(`${userId}:${key}`);
  }

  saveIdempotency(userId: string, key: string, record: IdempotencyRecord): void {
    this.idempotency.set(`${userId}:${key}`, record);
  }
}

function idNumber(id: string): number {
  return Number(id.split('_')[1]);
}

/** Tokens created by `seededStore()`. Tests import these instead of hard-coding strings. */
export const TOKENS = {
  alice: 'alice-token', // all scopes
  aliceReadOnly: 'alice-read-only', // contacts:read only
  aliceExpired: 'alice-expired', // expired before the clock starts
  aliceNoScopes: 'alice-no-scopes', // valid, but no scopes at all
  bob: 'bob-token', // another user with all scopes
} as const;

// messages:read is only used by the GraphQL API (Contact.messages); REST has no read endpoint for messages.
export const ALL_SCOPES = ['contacts:read', 'contacts:write', 'messages:read', 'messages:write'];

/** A new Store with the same users, tokens and contacts every time. */
export function seededStore(clock: Clock = steppingClock()): Store {
  return seed(new Store(clock));
}

/** Put the standard users, tokens and contacts into an empty store. */
export function seed(store: Store): Store {
  const farFuture = new Date('2099-01-01T00:00:00.000Z');
  store.addToken(TOKENS.alice, { userId: 'alice', scopes: ALL_SCOPES, expiresAt: farFuture });
  store.addToken(TOKENS.aliceReadOnly, {
    userId: 'alice',
    scopes: ['contacts:read'],
    expiresAt: farFuture,
  });
  store.addToken(TOKENS.aliceExpired, {
    userId: 'alice',
    scopes: ALL_SCOPES,
    expiresAt: new Date('2025-12-31T23:59:59.000Z'),
  });
  store.addToken(TOKENS.aliceNoScopes, { userId: 'alice', scopes: [], expiresAt: farFuture });
  store.addToken(TOKENS.bob, { userId: 'bob', scopes: ALL_SCOPES, expiresAt: farFuture });

  store.createContact('alice', { name: 'Ada Lovelace', email: 'ada@example.com', phone: '+442071234567' });
  store.createContact('alice', { name: 'Grace Hopper', email: 'grace@example.com' });
  store.createContact('alice', { name: 'Margaret Hamilton', email: 'margaret@example.com' });
  store.createContact('bob', { name: 'Katherine Johnson', email: 'katherine@example.com' });
  return store;
}
