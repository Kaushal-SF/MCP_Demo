import { completable } from '@modelcontextprotocol/sdk/server/completable.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ServerContext } from '../context.js';
import { DevflowError } from '../lib/errors.js';
import { parseRepoRef } from '../lib/pr-ref.js';
import { runRequest } from '../lib/request-result.js';

/** `/standup-summary`: yesterday / today / blockers, built from real GitHub activity. */
export function registerStandupSummaryPrompt(server: McpServer, ctx: ServerContext): void {
  server.registerPrompt(
    'standup-summary',
    {
      title: 'Stand-up summary',
      description:
        'Write a short stand-up update (yesterday, today, blockers) from your recent GitHub ' +
        'pull-request activity and review queue.',
      argsSchema: {
        // Prompt arguments are always strings in MCP, so the number arrives as text.
        days: completable(
          z.string().optional().describe('Days to look back (default 1; 3 on Mondays)'),
          (value) => ['1', '3', '7'].filter((option) => option.startsWith(value ?? '')),
        ),
        repo: z.string().optional().describe('Only this repository (owner/repo). Default: all'),
      },
    },
    ({ days, repo }) =>
      runRequest(ctx.logger, { kind: 'prompt', name: 'standup-summary' }, () => {
        const lookback = days === undefined || days === '' ? 1 : Number(days);
        if (!Number.isInteger(lookback) || lookback < 1 || lookback > 31) {
          throw new DevflowError(
            'INVALID_INPUT',
            `days must be a whole number from 1 to 31, got "${days ?? ''}".`,
          );
        }
        const repoName = repo
          ? `${parseRepoRef(repo).owner}/${parseRepoRef(repo).repo}`
          : undefined;
        const repoArg = repoName ? `, repo="${repoName}"` : '';
        const text = `Write my stand-up update.

1. Call get_my_activity with days=${lookback}${repoArg}.
2. Call list_review_queue${repoName ? ` with repo="${repoName}"` : ''} to see which reviews are waiting on me.

Reply in this format, as short bullet points a person would say out loud:
**Yesterday** – PRs merged and reviews done (the "reviewed" list approximates recent reviews).
**Today** – PRs still in progress, then the most important reviews to do (oldest or smallest first).
**Blockers** – PRs waiting a long time for review, failing or stale work; write "None" if there are none.

Mention PRs as owner/repo#number with their title. Do not invent work that is not in the tool results.`;
        return Promise.resolve({
          description: `Stand-up summary for the last ${lookback} day(s)`,
          messages: [{ role: 'user' as const, content: { type: 'text' as const, text } }],
        });
      }),
  );
}
