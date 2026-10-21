import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ServerContext } from '../context.js';
import { parseRepoRef } from '../lib/pr-ref.js';
import { runTool } from '../lib/tool-result.js';
import { getActivity } from '../services/activity.js';
import { ActivityOutputSchema } from './schemas.js';

export function registerGetMyActivity(server: McpServer, ctx: ServerContext): void {
  server.registerTool(
    'get_my_activity',
    {
      title: 'Get my recent GitHub activity',
      description:
        "Summarise a person's recent pull-request activity on GitHub: PRs they merged, PRs still " +
        'in progress, PRs they reviewed, and how many reviews are waiting for them. Use this for ' +
        'stand-up updates, weekly summaries or "what did I do yesterday?". Defaults to the ' +
        'authenticated user and the last 1 day.',
      inputSchema: {
        days: z
          .number()
          .int()
          .min(1)
          .max(31)
          .default(1)
          .describe('How many days back to look (default 1; use 3 on a Monday to cover Friday).'),
        user: z
          .string()
          .regex(/^[A-Za-z0-9-]+$/, 'GitHub logins contain only letters, digits and dashes.')
          .optional()
          .describe('GitHub login to report on. Omit for the authenticated user.'),
        repo: z.string().optional().describe('Only this repository (owner/repo). Omit for all.'),
      },
      outputSchema: ActivityOutputSchema,
      annotations: {
        title: 'Get my recent GitHub activity',
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    ({ days, user, repo }) =>
      runTool(ctx.logger, 'get_my_activity', ActivityOutputSchema, () =>
        getActivity(ctx.github, {
          days,
          // 20 per list is plenty for a stand-up and keeps four searches cheap.
          perList: 20,
          ...(user ? { user } : {}),
          ...(repo ? { repo: parseRepoRef(repo) } : {}),
        }),
      ),
  );
}
