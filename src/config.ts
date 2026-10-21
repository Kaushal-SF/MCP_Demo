import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { homedir } from 'node:os';
import { join } from 'node:path';
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
  // Optional: without it we ask the GitHub CLI (see resolveGitHubToken). Tokens pasted into config
  // files often pick up a trailing newline, which GitHub rejects (401); a blank value counts as unset
  // because installers such as Claude Desktop pass an empty string for an unfilled optional field.
  GITHUB_TOKEN: z
    .string()
    .trim()
    .optional()
    .transform((value) => value || undefined),
  GITHUB_API_URL: z.url({ error: 'GITHUB_API_URL must be a valid URL' }).optional(),
  DEVFLOW_LOG_LEVEL: z
    .enum(LOG_LEVELS, { error: `DEVFLOW_LOG_LEVEL must be one of: ${LOG_LEVELS.join(', ')}` })
    .default('info'),
  DEVFLOW_SENSITIVE_PATHS: commaList,
  DEVFLOW_CHECKLISTS_DIR: z.string().trim().min(1).optional(),
});

export type LogLevel = (typeof LOG_LEVELS)[number];

export interface Config {
  github: {
    /** Undefined means "not set in the environment"; resolveGitHubToken() then asks the gh CLI. */
    token: string | undefined;
    /** Undefined means public github.com. */
    apiUrl: string | undefined;
  };
  logLevel: LogLevel;
  /** Extra glob patterns (on top of the built-in defaults) that analyze_pr_risk flags as sensitive. */
  extraSensitivePaths: string[];
  /**
   * Folder of Markdown review checklists. Undefined means the checklists bundled with the package,
   * so teams can point this at their own folder without forking (see Decisions.md D27).
   */
  checklistsDir: string | undefined;
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
    checklistsDir: data.DEVFLOW_CHECKLISTS_DIR,
  };
}

/** Runs a command and resolves with its stdout. Injectable so tests never spawn real processes. */
export type RunCommand = (file: string, args: string[]) => Promise<string>;

const execFileAsync = promisify(execFile);

// The timeout stops a hung CLI (for example, one waiting on a keychain prompt) from blocking startup.
const runCommand: RunCommand = async (file, args) =>
  (await execFileAsync(file, args, { timeout: 5_000 })).stdout;

/**
 * Where to look for the GitHub CLI. Plain `gh` covers terminals; the absolute paths cover apps such
 * as Claude Desktop, which start servers with a minimal PATH that lacks Homebrew and ~/.local/bin.
 */
function ghCandidates(): string[] {
  return [
    'gh',
    '/opt/homebrew/bin/gh',
    '/usr/local/bin/gh',
    join(homedir(), '.local', 'bin', 'gh'),
  ];
}

export const NO_TOKEN_MESSAGE = `No GitHub token found. Do one of these:
  - Sign in with the GitHub CLI: gh auth login   (recommended; DevFlow picks it up automatically)
  - Or set GITHUB_TOKEN to a token with read access to your repositories`;

/**
 * Returns the GitHub token to use: GITHUB_TOKEN if set, otherwise the token of the signed-in GitHub
 * CLI user. Most developers already run `gh auth login`, so this makes setup zero-config while
 * keeping the token out of every config file. See Decisions.md D36.
 */
export async function resolveGitHubToken(
  github: Config['github'],
  run: RunCommand = runCommand,
): Promise<{ token: string; source: 'env' | 'gh' }> {
  if (github.token) return { token: github.token, source: 'env' };

  // For GitHub Enterprise, gh keeps a separate login per host.
  const host = github.apiUrl ? new URL(github.apiUrl).hostname : undefined;
  const args = [
    'auth',
    'token',
    ...(host && host !== 'api.github.com' ? ['--hostname', host] : []),
  ];
  for (const gh of ghCandidates()) {
    try {
      const token = (await run(gh, args)).trim();
      if (token) return { token, source: 'gh' };
    } catch {
      // Not installed at this path, or not signed in: try the next candidate.
    }
  }
  throw new ConfigError(NO_TOKEN_MESSAGE);
}
