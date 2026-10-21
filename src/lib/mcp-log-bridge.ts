import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SetLevelRequestSchema, type LoggingLevel } from '@modelcontextprotocol/sdk/types.js';
import type { LogSink } from './logger.js';

/** MCP log levels in increasing severity (RFC 5424 order, as used by the spec). */
const MCP_LEVELS: readonly LoggingLevel[] = [
  'debug',
  'info',
  'notice',
  'warning',
  'error',
  'critical',
  'alert',
  'emergency',
];

/** pino's numeric levels → the closest MCP level. */
function toMcpLevel(pinoLevel: number): LoggingLevel {
  if (pinoLevel >= 60) return 'critical';
  if (pinoLevel >= 50) return 'error';
  if (pinoLevel >= 40) return 'warning';
  if (pinoLevel >= 30) return 'info';
  return 'debug';
}

const severity = (level: LoggingLevel) => MCP_LEVELS.indexOf(level);

/** pino bookkeeping fields that mean nothing to an MCP host. */
const DROPPED_FIELDS = new Set(['level', 'time', 'pid', 'hostname', 'name']);

/**
 * Forwards server log lines to the connected MCP host as `notifications/message`, honouring the
 * level the host asks for with `logging/setLevel`.
 *
 * Why we own the level instead of the SDK: the SDK keeps the requested level private and, until a
 * host calls setLevel, forwards *everything*, which would spam hosts with an info line per tool
 * call. We start at `warning` (the spec lets servers choose until the host decides) and switch to
 * whatever the host requests. See Decisions.md D28.
 */
export class McpLogBridge {
  private server: McpServer | undefined;
  private minLevel: LoggingLevel = 'warning';

  /** Connects the bridge to a server and takes over its `logging/setLevel` handler. */
  attach(server: McpServer): void {
    this.server = server;
    server.server.setRequestHandler(SetLevelRequestSchema, (request) => {
      this.minLevel = request.params.level;
      return {};
    });
  }

  get level(): LoggingLevel {
    return this.minLevel;
  }

  /** Pass to createLogger(). An arrow function so it can be handed around unbound. */
  readonly sink: LogSink = (line) => {
    const server = this.server;
    if (!server?.isConnected()) return;

    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return; // pino always writes JSON; ignore anything else rather than crash the logger
    }

    const level = toMcpLevel(typeof entry.level === 'number' ? entry.level : 30);
    if (severity(level) < severity(this.minLevel)) return;

    const data: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(entry)) {
      if (!DROPPED_FIELDS.has(key)) data[key] = value;
    }
    // The spec says log notifications must not expose internal details that could aid an attack,
    // so errors are reduced to type + message. Full stacks stay in the stderr log only.
    if (typeof data.err === 'object' && data.err !== null) {
      const err = data.err as { type?: unknown; message?: unknown };
      data.err = { type: err.type, message: err.message };
    }

    // Fire-and-forget: a failed notification (e.g. host just disconnected) must never turn into
    // another log line, or we could loop.
    server.sendLoggingMessage({ level, logger: 'devflow-mcp', data }).catch(() => undefined);
  };
}
