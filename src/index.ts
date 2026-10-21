/**
 * Entry point and composition root.
 *
 * This is the only file that knows about concrete implementations (Octokit, pino, stdio).
 * Everything below it receives its dependencies as arguments, which is what lets tests swap in
 * a fake GitHub client and an in-memory transport. See Flow.md § 1 for the startup sequence.
 */
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { OctokitGitHubClient } from './clients/github.js';
import { ConfigError, loadConfig, resolveGitHubToken } from './config.js';
import { createLogger } from './lib/logger.js';
import { McpLogBridge } from './lib/mcp-log-bridge.js';
import { findPackageRoot } from './lib/package-root.js';
import { createServer, SERVER_NAME, SERVER_VERSION } from './server.js';
import { ChecklistStore } from './services/checklists.js';
import { ReviewQueueSuggestions } from './services/suggestions.js';
import { startStdio } from './transports/stdio.js';

const USAGE = `Usage: devflow-mcp [--help] [--version]

Started by an MCP host (Claude Code, Claude Desktop, VS Code, ...), which talks to it over stdio.

Environment (all optional):
  GITHUB_TOKEN              GitHub token; if unset, the GitHub CLI login (gh auth token) is used
  GITHUB_API_URL            GitHub Enterprise API URL (default: https://api.github.com)
  DEVFLOW_LOG_LEVEL         trace|debug|info|warn|error|fatal|silent (default: info)
  DEVFLOW_SENSITIVE_PATHS   extra comma-separated globs for analyze_pr_risk
  DEVFLOW_CHECKLISTS_DIR    folder of your own review checklists (default: bundled ones)`;

// CLI output goes to stderr: stdout is reserved for the MCP protocol.
function print(message: string): void {
  process.stderr.write(`${message}\n`);
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      help: { type: 'boolean', short: 'h', default: false },
      version: { type: 'boolean', short: 'v', default: false },
    },
  });

  if (values.help) {
    print(USAGE);
    return;
  }
  if (values.version) {
    print(`${SERVER_NAME} ${SERVER_VERSION}`);
    return;
  }

  // Config first: it decides the log level, and a bad config must stop us before anything starts.
  const config = loadConfig();
  // The bridge exists before the logger so that every log line can also reach the host; it stays
  // silent until attach() below gives it a connected server.
  const logBridge = new McpLogBridge();
  const logger = createLogger(config.logLevel, logBridge.sink);
  const { token, source } = await resolveGitHubToken(config.github);
  logger.info({ source }, 'GitHub token resolved');
  const github = new OctokitGitHubClient({
    token,
    apiUrl: config.github.apiUrl,
    userAgent: `${SERVER_NAME}/${SERVER_VERSION}`,
  });

  const server = createServer({
    github,
    logger,
    checklists: new ChecklistStore(
      config.checklistsDir ?? join(findPackageRoot(import.meta.url), 'checklists'),
    ),
    suggestions: new ReviewQueueSuggestions(github, logger),
    extraSensitivePaths: config.extraSensitivePaths,
  });
  logBridge.attach(server);
  await startStdio(server, logger);
}

// Exit non-zero so the MCP host marks the server as failed instead of waiting on a dead process.
main().catch((error: unknown) => {
  print(error instanceof ConfigError ? error.message : `Fatal: ${String(error)}`);
  process.exit(1);
});
