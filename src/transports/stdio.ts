import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { Logger } from '../lib/logger.js';

/**
 * Local mode: the MCP client launches this process and talks JSON-RPC over stdin/stdout.
 * Nothing but protocol messages may be written to stdout.
 */
export async function startStdio(server: McpServer, logger: Logger): Promise<void> {
  const transport = new StdioServerTransport();

  const shutdown = (signal: string) => {
    logger.info({ signal }, 'shutting down');
    void server.close().finally(() => process.exit(0));
  };
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

  await server.connect(transport);
  logger.info('devflow-mcp ready on stdio');
}
