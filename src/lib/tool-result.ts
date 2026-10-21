import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { z } from 'zod';
import { DevflowError } from './errors.js';
import type { Logger } from './logger.js';

/**
 * Runs a tool body and converts the outcome into an MCP `CallToolResult`.
 *
 * The result is first parsed with the tool's own output schema. That drops any field the schema
 * does not declare and rejects missing ones, so what we send always matches what we publish.
 * Without it, an extra field passes the SDK's lenient server-side check but fails strict
 * clients (published JSON Schemas say `additionalProperties: false`). That exact bug reached a
 * live run in M2; see Decisions.md D34.
 *
 * - Success: `structuredContent` (validated by the SDK against the tool's outputSchema) plus the
 *   same JSON serialized in a text block, as the spec recommends for clients that predate
 *   structured output.
 * - Failure: an `isError: true` result with an actionable message, so the model can see what
 *   went wrong and self-correct (e.g. fix a malformed PR URL). Unexpected errors are logged with
 *   their stack but only a generic message is returned, so internals are not leaked.
 */
export async function runTool<S extends z.ZodType<Record<string, unknown>>>(
  logger: Logger,
  toolName: string,
  outputSchema: S,
  body: () => Promise<z.input<S>>,
): Promise<CallToolResult> {
  // performance.now() is monotonic: durations stay correct even if the system clock changes.
  const startedAt = performance.now();
  try {
    const structured = outputSchema.parse(await body());
    logger.info(
      { tool: toolName, ms: Math.round(performance.now() - startedAt) },
      'tool succeeded',
    );
    return {
      structuredContent: structured,
      content: [{ type: 'text', text: JSON.stringify(structured) }],
    };
  } catch (error) {
    const ms = Math.round(performance.now() - startedAt);
    // warn, not error: bad input or a 404 is an expected outcome, not a fault in this server.
    if (error instanceof DevflowError) {
      logger.warn({ tool: toolName, ms, code: error.code, err: error }, 'tool failed');
      return errorResult(`[${error.code}] ${error.message}`);
    }
    logger.error({ tool: toolName, ms, err: error }, 'tool crashed');
    return errorResult('[INTERNAL] Unexpected internal error. Details are in the server logs.');
  }
}

function errorResult(text: string): CallToolResult {
  return { isError: true, content: [{ type: 'text', text }] };
}
