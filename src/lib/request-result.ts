import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { DevflowError } from './errors.js';
import type { Logger } from './logger.js';

/**
 * The resources/prompts counterpart of runTool().
 *
 * Tools report failures *inside* a successful result (`isError`) so the model can react. Resource
 * reads and prompt gets have no such field in the spec, so failures must be JSON-RPC errors. We
 * keep the same `[CODE] message` text so users see consistent errors everywhere:
 *   - INVALID_INPUT / NOT_FOUND → -32602 Invalid params (what the SDK itself uses for unknown URIs)
 *   - other DevflowErrors       → -32603 Internal error, with our safe, actionable message
 *   - anything unexpected       → -32603 with a generic message; details go to the log only
 * See Decisions.md D32.
 */
export async function runRequest<T>(
  logger: Logger,
  what: { kind: 'resource' | 'prompt'; name: string },
  body: () => Promise<T>,
): Promise<T> {
  const startedAt = performance.now();
  const ms = () => Math.round(performance.now() - startedAt);
  try {
    const result = await body();
    logger.info({ [what.kind]: what.name, ms: ms() }, `${what.kind} served`);
    return result;
  } catch (error) {
    if (error instanceof DevflowError) {
      logger.warn(
        { [what.kind]: what.name, ms: ms(), code: error.code, err: error },
        `${what.kind} failed`,
      );
      const code =
        error.code === 'INVALID_INPUT' || error.code === 'NOT_FOUND'
          ? ErrorCode.InvalidParams
          : ErrorCode.InternalError;
      throw new McpError(code, `[${error.code}] ${error.message}`);
    }
    logger.error({ [what.kind]: what.name, ms: ms(), err: error }, `${what.kind} crashed`);
    throw new McpError(
      ErrorCode.InternalError,
      '[INTERNAL] Unexpected internal error. Details are in the server logs.',
    );
  }
}

/** URI-template variables can be arrays (for `{+list*}` forms); ours are always single values. */
export function singleValue(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? '';
}
