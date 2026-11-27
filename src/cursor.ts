// Opaque pagination cursors, shared by the REST and GraphQL APIs.
// Internally a cursor is the last id of the previous page, base64url-encoded so
// clients treat it as opaque instead of building their own.
import { problems } from './problems';

export const encodeCursor = (id: string): string => Buffer.from(id).toString('base64url');

export function decodeCursor(cursor: string): string {
  const id = Buffer.from(cursor, 'base64url').toString();
  if (!/^c_[0-9]+$/.test(id)) {
    throw problems.validation([{ parameter: 'cursor', detail: 'is not a valid cursor' }]);
  }
  return id;
}
