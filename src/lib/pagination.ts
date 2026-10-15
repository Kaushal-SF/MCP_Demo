import { DevflowError } from './errors.js';

/**
 * Opaque pagination cursors, as recommended by the MCP spec: clients must treat them as
 * black boxes, which lets us change the underlying paging strategy without breaking anyone.
 * The page size travels inside the cursor so a follow-up call with a different `limit`
 * cannot skip or repeat items.
 */
export interface PageCursor {
  page: number;
  perPage: number;
}

export function encodeCursor(cursor: PageCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

function isPositiveInt(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 1;
}

/** Returns the decoded cursor, or the first page with `defaultPerPage` when no cursor is given. */
export function decodeCursor(cursor: string | undefined, defaultPerPage: number): PageCursor {
  if (cursor === undefined || cursor === '') return { page: 1, perPage: defaultPerPage };
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (typeof parsed === 'object' && parsed !== null) {
      const { page, perPage } = parsed as Record<string, unknown>;
      if (isPositiveInt(page) && isPositiveInt(perPage) && perPage <= 100) {
        return { page, perPage };
      }
    }
  } catch {
    // fall through to the error below
  }
  throw new DevflowError(
    'INVALID_INPUT',
    'Invalid cursor. Pass back the exact nextCursor value from a previous response, or omit it to start from the beginning.',
  );
}
