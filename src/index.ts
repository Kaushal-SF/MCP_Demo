import { parseArgs } from 'node:util';
import { OctokitGitHubClient } from './clients/github.js';
import { ConfigError, loadConfig } from './config.js';
import { createLogger } from './lib/logger.js';
import { createServer, SERVER_NAME, SERVER_VERSION } from './server.js';
import { startStdio } from './transports/stdio.js';

const USAGE = `Usage: devflow-mcp [--transport stdio] [--help] [--version]

Environment:
  GITHUB_TOKEN              (required) GitHub token with read access to pull requests
  GITHUB_API_URL            GitHub Enterprise API URL (default: https://api.github.com)
  DEVFLOW_LOG_LEVEL         trace|debug|info|warn|error|fatal|silent (default: info)
  DEVFLOW_SENSITIVE_PATHS   extra comma-separated globs for analyze_pr_risk`;

// CLI output goes to stderr: stdout is reserved for the MCP protocol.
function print(message: string): void {
  process.stderr.write(`${message}\n`);
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      transport: { type: 'string', default: process.env.DEVFLOW_TRANSPORT ?? 'stdio' },
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

  if (values.transport !== 'stdio') {
    print(
      `Unsupported transport "${values.transport}". Only "stdio" is available in this version.`,
    );
    process.exitCode = 2;
    return;
  }

  const config = loadConfig();
  const logger = createLogger(config.logLevel);
  const github = new OctokitGitHubClient({
    token: config.github.token,
    apiUrl: config.github.apiUrl,
    userAgent: `${SERVER_NAME}/${SERVER_VERSION}`,
  });

  const server = createServer({
    github,
    logger,
    extraSensitivePaths: config.extraSensitivePaths,
  });
  await startStdio(server, logger);
}

main().catch((error: unknown) => {
  print(error instanceof ConfigError ? error.message : `Fatal: ${String(error)}`);
  process.exit(1);
});
