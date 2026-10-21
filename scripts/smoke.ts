/**
 * Live smoke test: launches the built server over stdio (exactly as an MCP host would),
 * then calls every tool against the real GitHub API.
 *
 *   npm run smoke -- <pr> [release-from]      (uses GITHUB_TOKEN, else your gh login)
 *
 *   <pr>           https://github.com/owner/repo/pull/123 or owner/repo#123
 *   [release-from] previous release tag/date for generate_release_notes (default: 14 days ago)
 *   SMOKE_MAX_CHARS=5000 prints more of each result (default 1500)
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { parsePullRequestRef } from '../src/lib/pr-ref.js';

/* eslint-disable no-console -- this script is a CLI, not the server; stdout is fine here. */

const prRef = process.argv[2];
if (!prRef) {
  console.error('Usage: npm run smoke -- <pull request URL or owner/repo#123> [release-from]');
  process.exit(2);
}
const { owner, repo } = parsePullRequestRef(prRef);
const releaseFrom =
  process.argv[3] ?? new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
const maxChars = Number(process.env.SMOKE_MAX_CHARS ?? 1500);

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ['dist/index.js'],
  env: { ...process.env, DEVFLOW_LOG_LEVEL: process.env.DEVFLOW_LOG_LEVEL ?? 'warn' },
  stderr: 'inherit',
});
const client = new Client({ name: 'devflow-smoke', version: '0.0.0' });

function print(title: string, ok: boolean, text: string): void {
  console.log(`\n=== ${title}: ${ok ? 'ok' : 'ERROR'} ===`);
  console.log(text.length > maxChars ? `${text.slice(0, maxChars)}… (${text.length} chars)` : text);
}

function summarize(name: string, result: CallToolResult): void {
  const text = result.content.map((block) => (block.type === 'text' ? block.text : '')).join('');
  print(name, !result.isError, text);
}

let failures = 0;
async function attempt(title: string, run: () => Promise<string>): Promise<void> {
  try {
    print(title, true, await run());
  } catch (error) {
    failures++;
    print(title, false, String(error));
  }
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
    ['get_pr_diff', { pr: prRef, maxChars: 4000 }],
    ['list_review_queue', { limit: 5 }],
    ['get_my_activity', { days: 7 }],
    ['generate_release_notes', { repo: `${owner}/${repo}`, from: releaseFrom, limit: 20 }],
  ] as const) {
    const result = (await client.callTool({ name, arguments: args })) as CallToolResult;
    if (result.isError) failures++;
    summarize(name, result);
  }

  const { resources } = await client.listResources();
  console.log(`\nResources: ${resources.map((resource) => resource.uri).join(', ')}`);
  await attempt('read devflow://checklists/react', async () => {
    const result = await client.readResource({ uri: 'devflow://checklists/react' });
    const first = result.contents[0];
    return first && 'text' in first ? first.text : '';
  });
  await attempt(`read devflow://repos/${owner}/${repo}/guidelines`, async () => {
    const result = await client.readResource({
      uri: `devflow://repos/${owner}/${repo}/guidelines`,
    });
    const first = result.contents[0];
    return first && 'text' in first ? first.text : '';
  });

  const { prompts } = await client.listPrompts();
  console.log(`\nPrompts: ${prompts.map((prompt) => prompt.name).join(', ')}`);
  await attempt('prompt review-pr', async () => {
    const prompt = await client.getPrompt({ name: 'review-pr', arguments: { pr: prRef } });
    return JSON.stringify(prompt.messages.map((message) => message.content.type));
  });
  await attempt('complete review-pr › pr', async () => {
    const result = await client.complete({
      ref: { type: 'ref/prompt', name: 'review-pr' },
      argument: { name: 'pr', value: '' },
    });
    return JSON.stringify(result.completion.values);
  });
} finally {
  await client.close();
}

console.log(`\n${failures === 0 ? 'All checks passed.' : `${failures} check(s) failed.`}`);
process.exitCode = failures === 0 ? 0 : 1;
