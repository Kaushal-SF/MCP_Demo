import { z } from 'zod';

const LOG_LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'] as const;

// Env vars are flat strings, so lists are comma-separated. Blank items are dropped, which makes
// trailing commas and extra spaces harmless.
const commaList = z
  .string()
  .optional()
  .transform((value) =>
    (value ?? '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  );

const EnvSchema = z.object({
  GITHUB_TOKEN: z
    .string({ error: 'GITHUB_TOKEN is required' })
    // Tokens pasted into config files often pick up a trailing newline, which GitHub rejects (401).
    .trim()
    .min(1, 'GITHUB_TOKEN is required'),
  GITHUB_API_URL: z.url({ error: 'GITHUB_API_URL must be a valid URL' }).optional(),
  DEVFLOW_LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
  DEVFLOW_SENSITIVE_PATHS: commaList,
});

export type LogLevel = (typeof LOG_LEVELS)[number];

export interface Config {
  github: {
    token: string;
    /** Undefined means public github.com. */
    apiUrl: string | undefined;
  };
  logLevel: LogLevel;
  /** Extra glob patterns (on top of the built-in defaults) that analyze_pr_risk flags as sensitive. */
  extraSensitivePaths: string[];
}

export class ConfigError extends Error {
  override name = 'ConfigError';
}

/**
 * Reads and validates configuration from environment variables.
 * Fails fast at startup with a readable message instead of failing later inside a tool call.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.safeParse(env);
  // Report every problem at once so users can fix their configuration in a single pass.
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => `  - ${issue.message}`).join('\n');
    throw new ConfigError(`Invalid configuration:\n${problems}\nSee .env.example for details.`);
  }

  const data = parsed.data;
  return {
    github: { token: data.GITHUB_TOKEN, apiUrl: data.GITHUB_API_URL },
    logLevel: data.DEVFLOW_LOG_LEVEL,
    extraSensitivePaths: data.DEVFLOW_SENSITIVE_PATHS,
  };
}
