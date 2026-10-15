/**
 * Live smoke test: launches the built server over stdio (exactly as an MCP host would),
 * then calls every tool against the real GitHub API.
 *
 *   GITHUB_TOKEN=... npm run smoke -- https://github.com/owner/repo/pull/123
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

/* eslint-disable no-console -- this script is a CLI, not the server; stdout is fine here. */

const prRef = process.argv[2];
if (!prRef) {
  console.error('Usage: npm run smoke -- <pull request URL or owner/repo#123>');
  process.exit(2);
}

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ['dist/index.js'],
  env: { ...process.env, DEVFLOW_LOG_LEVEL: process.env.DEVFLOW_LOG_LEVEL ?? 'warn' },
  stderr: 'inherit',
});
const client = new Client({ name: 'devflow-smoke', version: '0.0.0' });

function summarize(name: string, result: CallToolResult): void {
  const status = result.isError ? 'ERROR' : 'ok';
  const text = result.content.map((block) => (block.type === 'text' ? block.text : '')).join('');
  console.log(`\n=== ${name}: ${status} ===`);
  console.log(text.length > 1500 ? `${text.slice(0, 1500)}… (${text.length} chars)` : text);
}

try {
  await client.connect(transport);
  const server = client.getServerVersion();
  console.log(`Connected to ${server?.name ?? '?'} ${server?.version ?? '?'}`);

  const { tools } = await client.listTools();
  console.log(`Tools: ${tools.map((tool) => tool.name).join(', ')}`);

  for (const [name, args] of [
    ['get_pr_context', { pr: prRef, maxFiles: 20 }],
    ['analyze_pr_risk', { pr: prRef }],
    ['list_review_queue', { limit: 5 }],
  ] as const) {
    summarize(name, (await client.callTool({ name, arguments: args })) as CallToolResult);
  }
} finally {
  await client.close();
}
