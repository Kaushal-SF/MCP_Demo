import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { parseRepoRef } from '../lib/pr-ref.js';
import { runTool } from '../lib/tool-result.js';
import { listReviewQueue } from '../services/review-queue.js';
import type { ToolContext } from './context.js';
import { ReviewQueueOutputSchema } from './schemas.js';

export function registerListReviewQueue(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'list_review_queue',
    {
      title: 'List my review queue',
      description:
        "List open GitHub pull requests where the current user's review is requested, oldest " +
        'first, with age in days and a size label (XS–XL). Use this to answer "what should I ' +
        'review next?". Results are paginated: pass nextCursor back as cursor for more.',
      inputSchema: {
        repo: z
          .string()
          .optional()
          .describe('Only include PRs from this repository (owner/repo). Omit for all repos.'),
        // Max 30 because every item costs one extra GitHub call to fetch its size (see listReviewQueue).
        limit: z
          .number()
          .int()
          .min(1)
          .max(30)
          .default(10)
          .describe('Number of PRs per page (default 10, max 30).'),
        cursor: z.string().optional().describe('nextCursor from a previous call.'),
      },
      outputSchema: ReviewQueueOutputSchema,
      annotations: {
        title: 'List my review queue',
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    ({ repo, limit, cursor }) =>
      runTool(ctx.logger, 'list_review_queue', () =>
        listReviewQueue(ctx.github, {
          limit,
          ...(repo ? { repo: parseRepoRef(repo) } : {}),
          ...(cursor ? { cursor } : {}),
        }),
      ),
  );
}
