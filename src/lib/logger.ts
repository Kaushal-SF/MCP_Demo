import { pino, type DestinationStream, type Logger } from 'pino';
import type { LogLevel } from '../config.js';

export type { Logger };

/** Receives every log line (one JSON object per line) after redaction, e.g. to forward to MCP. */
export type LogSink = (line: string) => void;

/**
 * Structured JSON logger that writes to **stderr** (fd 2), and optionally to a second sink.
 *
 * In stdio mode stdout carries JSON-RPC messages, so writing anything else there
 * would corrupt the protocol stream. MCP clients typically surface server stderr in their logs.
 * The optional sink is how logs also reach the host as MCP notifications (see McpLogBridge).
 */
export function createLogger(
  level: LogLevel = 'info',
  sink?: LogSink,
  // Injectable so tests can keep their output clean; production always uses stderr.
  stderr: DestinationStream = pino.destination(2),
): Logger {
  return pino(
    {
      name: 'devflow-mcp',
      level,
      // Defence in depth: we never log tokens on purpose, but redaction catches an accidental
      // log of a config or request object.
      redact: {
        paths: ['token', '*.token', 'authorization', '*.authorization', 'headers.authorization'],
        censor: '[redacted]',
      },
    },
    // A minimal destination: pino only needs write(). Redaction has already happened by now, so
    // the sink never sees secrets either.
    {
      write(line: string) {
        stderr.write(line);
        sink?.(line);
      },
    },
  );
}

/** A logger that discards everything — handy for tests. */
export function createSilentLogger(): Logger {
  return pino({ level: 'silent' });
}
