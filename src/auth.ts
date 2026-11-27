// Bearer-token authentication (RFC 6750) and scope checks.
import { problems } from './problems';
import type { Store } from './store';

export interface Principal {
  userId: string;
  scopes: string[];
}

/**
 * Order matters and is part of the contract:
 * 1. no or malformed header  -> 401 (no error code in the challenge)
 * 2. unknown or expired token -> 401 invalid_token
 * 3. missing scope            -> 403 insufficient_scope
 * Authentication runs before request validation, so an anonymous caller
 * learns nothing about the request schema.
 */
export function authorize(
  authorization: string | undefined,
  requiredScopes: string[],
  store: Store,
): Principal {
  // The auth scheme name is case-insensitive (RFC 9110 section 11.1).
  const match = /^Bearer\s+(\S+)$/i.exec(authorization ?? '');
  if (!match) throw problems.missingToken();

  const record = store.tokens.get(match[1]!);
  if (!record) throw problems.invalidToken('The token is not recognized.');
  if (record.expiresAt <= store.clock()) throw problems.invalidToken('The token has expired.');

  const missing = requiredScopes.find((scope) => !record.scopes.includes(scope));
  if (missing) throw problems.insufficientScope(missing);

  return { userId: record.userId, scopes: record.scopes };
}
