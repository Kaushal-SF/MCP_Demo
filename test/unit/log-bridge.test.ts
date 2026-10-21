import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { describe, expect, it, vi } from 'vitest';
import { createLogger } from '../../src/lib/logger.js';
import { McpLogBridge } from '../../src/lib/mcp-log-bridge.js';

/** Discards the stderr copy of each line; the bridge still receives them through its sink. */
const quiet = { write: () => undefined };

/** A stand-in McpServer exposing only what the bridge touches. */
function fakeServer(connected = true) {
  let setLevelHandler: ((request: { params: { level: string } }) => unknown) | undefined;
  const sent: unknown[] = [];
  const send = vi.fn((params: unknown) => {
    sent.push(params);
    return Promise.resolve();
  });
  const server = {
    isConnected: () => connected,
    sendLoggingMessage: send,
    server: {
      setRequestHandler: (_schema: unknown, handler: typeof setLevelHandler) => {
        setLevelHandler = handler;
      },
    },
  };
  return {
    server: server as unknown as McpServer,
    sent,
    send,
    setLevel: (level: string) => setLevelHandler?.({ params: { level } }),
  };
}

describe('McpLogBridge', () => {
  it('forwards warning and above by default, mapping pino levels to MCP levels', () => {
    const bridge = new McpLogBridge();
    const { server, sent } = fakeServer();
    bridge.attach(server);
    const logger = createLogger('trace', bridge.sink, quiet);

    logger.debug('debug line');
    logger.info('info line');
    logger.warn({ tool: 'x' }, 'warn line');
    logger.error('error line');
    logger.fatal('fatal line');

    expect(bridge.level).toBe('warning');
    expect(sent).toEqual([
      { level: 'warning', logger: 'devflow-mcp', data: { tool: 'x', msg: 'warn line' } },
      { level: 'error', logger: 'devflow-mcp', data: { msg: 'error line' } },
      { level: 'critical', logger: 'devflow-mcp', data: { msg: 'fatal line' } },
    ]);
  });

  it('follows the level the host sets with logging/setLevel', () => {
    const bridge = new McpLogBridge();
    const { server, sent, setLevel } = fakeServer();
    bridge.attach(server);
    const logger = createLogger('trace', bridge.sink, quiet);

    setLevel('debug');
    logger.debug('now visible');
    setLevel('error');
    logger.warn('now hidden');

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ level: 'debug', data: { msg: 'now visible' } });
  });

  it('strips stack traces and never forwards redacted secrets', () => {
    const bridge = new McpLogBridge();
    const { server, sent } = fakeServer();
    bridge.attach(server);
    const logger = createLogger('info', bridge.sink, quiet);

    logger.error({ err: new TypeError('boom'), token: 'ghp_secret' }, 'crashed');

    expect(sent[0]).toEqual({
      level: 'error',
      logger: 'devflow-mcp',
      data: { err: { type: 'TypeError', message: 'boom' }, token: '[redacted]', msg: 'crashed' },
    });
    expect(JSON.stringify(sent)).not.toContain('ghp_secret');
    expect(JSON.stringify(sent)).not.toContain('at ');
  });

  it('stays silent when not attached or not connected, and ignores non-JSON', () => {
    const detached = new McpLogBridge();
    expect(() => {
      detached.sink('{"level":50,"msg":"x"}');
    }).not.toThrow();

    const bridge = new McpLogBridge();
    const { server, sent } = fakeServer(false);
    bridge.attach(server);
    bridge.sink('{"level":50,"msg":"x"}');
    expect(sent).toEqual([]);

    const live = new McpLogBridge();
    const connected = fakeServer();
    live.attach(connected.server);
    live.sink('not json');
    expect(connected.sent).toEqual([]);
  });

  it('swallows notification failures so logging can never loop or crash', async () => {
    const bridge = new McpLogBridge();
    const { server, send } = fakeServer();
    send.mockRejectedValueOnce(new Error('closed'));
    bridge.attach(server);
    bridge.sink('{"level":50,"msg":"x"}');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(send).toHaveBeenCalledTimes(1);
  });
});
