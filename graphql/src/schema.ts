// The GraphQL API for the same contacts domain as the REST API, backed by the same
// Store, auth and validation rules, so the two APIs cannot drift apart in behavior.
import { GraphQLError } from 'graphql';
import { authorize, type Principal } from '../../src/auth';
import { decodeCursor, encodeCursor } from '../../src/cursor';
import { ApiProblem } from '../../src/problems';
import { createAjv, specRef } from '../../src/spec';
import type { ContactRecord, Store } from '../../src/store';
import type { ContactCreate, Message } from '../../src/types';

export const typeDefs = /* GraphQL */ `
  "A contact owned by the calling user."
  type Contact {
    id: ID!
    name: String!
    email: String!
    phone: String
    createdAt: String!
    updatedAt: String!
    "Needs the messages:read scope. Without it, this field is null and errors[] says why."
    messages: [Message!]
  }

  type Message {
    id: ID!
    body: String!
    createdAt: String!
    contact: Contact!
  }

  type ContactPage {
    items: [Contact!]!
    "Pass as after to get the next page. null on the last page."
    nextCursor: String
  }

  input CreateContactInput {
    name: String!
    email: String!
    phone: String
  }

  type Query {
    "The caller's contacts, oldest first. Needs contacts:read."
    contacts(first: Int = 20, after: String): ContactPage!
    "One contact, or null if it does not exist (or belongs to someone else). Needs contacts:read."
    contact(id: ID!): Contact
  }

  type Mutation {
    "Needs contacts:write."
    createContact(input: CreateContactInput!): Contact!
    "Returns false if there was nothing to delete. Needs contacts:write."
    deleteContact(id: ID!): Boolean!
    "Needs messages:write."
    sendMessage(contactId: ID!, body: String!): Message!
  }
`;

export interface Context {
  principal: Principal;
  store: Store;
}

/**
 * Authentication happens once per HTTP request, before any resolver runs: without a
 * valid token the whole request is rejected with HTTP 401. Scopes are checked per
 * field, so one request can partly succeed (see Contact.messages).
 */
export function createContext(authorization: string | undefined, store: Store): Context {
  try {
    return { principal: authorize(authorization, [], store), store };
  } catch (error) {
    throw toGraphQLError(error);
  }
}

/** Map the REST problem types to the conventional GraphQL error codes. */
const CODES: Record<number, string> = {
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  422: 'BAD_USER_INPUT',
};
function toGraphQLError(error: unknown): unknown {
  if (!(error instanceof ApiProblem)) return error; // Apollo masks unknown errors as INTERNAL_SERVER_ERROR
  return new GraphQLError(error.detail ?? error.title, {
    extensions: {
      code: CODES[error.status] ?? 'INTERNAL_SERVER_ERROR',
      ...(error.errors && { fieldErrors: error.errors }),
      // Only authentication failures change the HTTP status; everything else is 200 with errors[].
      ...(error.status === 401 && { http: { status: 401 } }),
    },
  });
}

function requireScope({ principal }: Context, scope: string): void {
  if (!principal.scopes.includes(scope)) {
    throw new GraphQLError(`This field needs the ${scope} scope.`, { extensions: { code: 'FORBIDDEN' } });
  }
}

// Reuse the REST API's request schema, so both APIs accept exactly the same contacts.
const validateContactCreate = createAjv().compile(specRef('components', 'schemas', 'ContactCreate'));

const publicContact = ({ ownerId: _owner, ...contact }: ContactRecord) => contact;

/** Wrap a resolver so ApiProblem errors become GraphQL errors. */
const resolver =
  <A, R>(fn: (parent: any, args: A, ctx: Context) => R) =>
  (parent: unknown, args: A, ctx: Context) => {
    try {
      return fn(parent, args, ctx);
    } catch (error) {
      throw toGraphQLError(error);
    }
  };

export const resolvers = {
  Query: {
    contacts: resolver((_: unknown, args: { first: number; after?: string | null }, ctx) => {
      requireScope(ctx, 'contacts:read');
      if (args.first < 1 || args.first > 100) {
        throw new GraphQLError('first must be between 1 and 100.', { extensions: { code: 'BAD_USER_INPUT' } });
      }
      const page = ctx.store.listContacts(ctx.principal.userId, {
        limit: args.first,
        ...(args.after && { afterId: decodeCursor(args.after) }),
      });
      const last = page.items.at(-1);
      return { items: page.items.map(publicContact), nextCursor: page.hasMore && last ? encodeCursor(last.id) : null };
    }),
    contact: resolver((_: unknown, args: { id: string }, ctx) => {
      requireScope(ctx, 'contacts:read');
      const contact = ctx.store.getContact(ctx.principal.userId, args.id);
      return contact ? publicContact(contact) : null;
    }),
  },

  Mutation: {
    createContact: resolver((_: unknown, args: { input: ContactCreate }, ctx) => {
      requireScope(ctx, 'contacts:write');
      // GraphQL drops absent optional fields as null; JSON Schema expects them to be missing.
      const input = Object.fromEntries(Object.entries(args.input).filter(([, v]) => v !== null)) as ContactCreate;
      if (!validateContactCreate(input)) {
        throw new GraphQLError('The input is invalid.', {
          extensions: {
            code: 'BAD_USER_INPUT',
            fieldErrors: validateContactCreate.errors?.map((e) => ({ pointer: e.instancePath, detail: e.message })),
          },
        });
      }
      if (ctx.store.emailTaken(ctx.principal.userId, input.email)) {
        throw new GraphQLError(`A contact with email ${input.email} already exists.`, { extensions: { code: 'CONFLICT' } });
      }
      return publicContact(ctx.store.createContact(ctx.principal.userId, input));
    }),
    deleteContact: resolver((_: unknown, args: { id: string }, ctx) => {
      requireScope(ctx, 'contacts:write');
      const contact = ctx.store.getContact(ctx.principal.userId, args.id);
      if (!contact) return false;
      ctx.store.deleteContact(contact);
      return true;
    }),
    sendMessage: resolver((_: unknown, args: { contactId: string; body: string }, ctx) => {
      requireScope(ctx, 'messages:write');
      const contact = ctx.store.getContact(ctx.principal.userId, args.contactId);
      if (!contact) throw new GraphQLError(`Contact ${args.contactId} was not found.`, { extensions: { code: 'NOT_FOUND' } });
      if (args.body.length < 1 || args.body.length > 1000) {
        throw new GraphQLError('body must be 1 to 1000 characters.', { extensions: { code: 'BAD_USER_INPUT' } });
      }
      return ctx.store.createMessage(ctx.principal.userId, contact.id, args.body);
    }),
  },

  Contact: {
    // Field-level authorization: the contact itself is readable with contacts:read,
    // but its messages need messages:read as well.
    messages: resolver((contact: { id: string }, _args: unknown, ctx) => {
      requireScope(ctx, 'messages:read');
      return ctx.store.listMessages(ctx.principal.userId, contact.id);
    }),
  },

  Message: {
    contact: resolver((message: Message, _args: unknown, ctx) => {
      const contact = ctx.store.getContact(ctx.principal.userId, message.contactId);
      return contact ? publicContact(contact) : null;
    }),
  },
};
