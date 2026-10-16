import { pino, type Logger } from 'pino';
import type { LogLevel } from '../config.js';

export type { Logger };

/**
 * Structured JSON logger that writes to **stderr** (fd 2).
 *
 * In stdio mode stdout carries JSON-RPC messages, so writing anything else there
 * would corrupt the protocol stream. MCP clients typically surface server stderr in their logs.
 */
export function createLogger(level: LogLevel = 'info'): Logger {
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
    pino.destination(2),
  );
}

/** A logger that discards everything — handy for tests. */
export function createSilentLogger(): Logger {
  return pino({ level: 'silent' });
}
