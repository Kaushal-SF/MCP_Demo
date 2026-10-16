import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { Logger } from '../lib/logger.js';

/**
 * Local mode: the MCP client launches this process and talks JSON-RPC over stdin/stdout.
 * Nothing but protocol messages may be written to stdout.
 */
export async function startStdio(server: McpServer, logger: Logger): Promise<void> {
  const transport = new StdioServerTransport();

  // close() first so the transport can finish in-flight work; then exit explicitly, because open
  // handles (stdin, timers) would otherwise keep the process alive after the host has gone.
  const shutdown = (signal: string) => {
    logger.info({ signal }, 'shutting down');
    void server.close().finally(() => process.exit(0));
  };
  // once(): a second Ctrl+C during shutdown falls through to Node's default handler and force-quits,
  // which is the escape hatch people expect if a graceful close ever hangs.
  process.once('SIGINT', () => {
    shutdown('SIGINT');
  });
  process.once('SIGTERM', () => {
    shutdown('SIGTERM');
  });
  // The client closing our stdin means it has gone away.
  process.stdin.once('end', () => {
    shutdown('stdin closed');
  });

  // Handlers are registered before connect() so a signal that arrives during startup is still handled.
  await server.connect(transport);
  logger.info('devflow-mcp ready on stdio');
}
