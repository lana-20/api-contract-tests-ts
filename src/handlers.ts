// One function per operationId in the spec. Each returns a plain result object
// instead of writing to the reply, which keeps handlers short and easy to read.
import type { Principal } from './auth';
import { decodeCursor, encodeCursor } from './cursor';
import { problems } from './problems';
import type { ContactRecord, Store } from './store';
import type { Contact, ContactCreate, ContactPage, ContactUpdate, Message, MessageCreate } from './types';

export interface HandlerContext {
  principal: Principal;
  store: Store;
  params: Record<string, string>;
  query: Record<string, unknown>;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
}

export interface HandlerResult {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}

export type Handler = (ctx: HandlerContext) => HandlerResult;

/** Map a stored record to the public shape. Only documented fields leave the API. */
function toContact({ id, name, email, phone, createdAt, updatedAt }: ContactRecord): Contact {
  return { id, name, email, ...(phone !== undefined && { phone }), createdAt, updatedAt };
}

function findContact(ctx: HandlerContext): ContactRecord {
  const contact = ctx.store.getContact(ctx.principal.userId, ctx.params.contactId!);
  if (!contact) throw problems.notFound(`Contact ${ctx.params.contactId} was not found.`);
  return contact;
}

export const handlers: Record<string, Handler> = {
  listContacts(ctx) {
    const limit = ctx.query.limit as number; // validated and defaulted from the spec
    const cursor = ctx.query.cursor as string | undefined;
    const page = ctx.store.listContacts(ctx.principal.userId, {
      limit,
      ...(cursor !== undefined && { afterId: decodeCursor(cursor) }),
    });
    const last = page.items.at(-1);
    const body: ContactPage = {
      items: page.items.map(toContact),
      nextCursor: page.hasMore && last ? encodeCursor(last.id) : null,
    };
    return { status: 200, body };
  },

  createContact(ctx) {
    const input = ctx.body as ContactCreate;
    if (ctx.store.emailTaken(ctx.principal.userId, input.email)) {
      throw problems.conflict(`A contact with email ${input.email} already exists.`);
    }
    const contact = toContact(ctx.store.createContact(ctx.principal.userId, input));
    return { status: 201, body: contact, headers: { location: `/contacts/${contact.id}` } };
  },

  getContact(ctx) {
    return { status: 200, body: toContact(findContact(ctx)) };
  },

  updateContact(ctx) {
    const contact = findContact(ctx);
    const changes = ctx.body as ContactUpdate;
    if (changes.email && ctx.store.emailTaken(ctx.principal.userId, changes.email, contact.id)) {
      throw problems.conflict(`A contact with email ${changes.email} already exists.`);
    }
    return { status: 200, body: toContact(ctx.store.updateContact(contact, changes)) };
  },

  deleteContact(ctx) {
    ctx.store.deleteContact(findContact(ctx));
    return { status: 204 };
  },

  // Idempotency, following draft-ietf-httpapi-idempotency-key-header:
  // - same key, same body      -> replay the stored response, do not send again
  // - same key, different body -> 422
  // Only successful sends are stored, so a failed request can be retried with the same key.
  sendMessage(ctx) {
    const key = ctx.headers['idempotency-key'] as string; // required by the spec
    const { body } = ctx.body as MessageCreate;
    const fingerprint = JSON.stringify([ctx.params.contactId, body]);

    const previous = ctx.store.getIdempotency(ctx.principal.userId, key);
    if (previous) {
      if (previous.fingerprint !== fingerprint) throw problems.idempotencyKeyReused();
      return { status: 201, body: previous.message, headers: { 'idempotent-replayed': 'true' } };
    }

    const contact = findContact(ctx);
    const message: Message = ctx.store.createMessage(ctx.principal.userId, contact.id, body);
    ctx.store.saveIdempotency(ctx.principal.userId, key, { fingerprint, message });
    return { status: 201, body: message };
  },
};
