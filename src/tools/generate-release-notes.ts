import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ServerContext } from '../context.js';
import { parseRepoRef } from '../lib/pr-ref.js';
import { runTool } from '../lib/tool-result.js';
import { generateReleaseNotes, MAX_RELEASE_PRS } from '../services/release-notes.js';
import { ReleaseNotesOutputSchema } from './schemas.js';

export function registerGenerateReleaseNotes(server: McpServer, ctx: ServerContext): void {
  server.registerTool(
    'generate_release_notes',
    {
      title: 'Generate release notes',
      description:
        'Draft release notes from the pull requests merged into a GitHub repository between two ' +
        'points: tags, branches, commit SHAs or dates (YYYY-MM-DD). PRs are grouped into Features, ' +
        'Bug fixes, Performance, Documentation, Dependencies, Maintenance and Other, using ' +
        'conventional-commit titles (feat:, fix:, …) and then labels; breaking changes are called ' +
        'out. Returns structured data plus ready-to-paste Markdown.',
      inputSchema: {
        repo: z.string().describe('Repository as owner/repo.'),
        from: z
          .string()
          .min(1)
          .describe('Start (exclusive): the previous release tag, a branch, a SHA or a date.'),
        to: z
          .string()
          .min(1)
          .optional()
          .describe('End (inclusive): a tag, branch, SHA or date. Omit for "now".'),
        base: z
          .string()
          .min(1)
          .optional()
          .describe('Only PRs merged into this branch (e.g. main). Omit for any branch.'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(MAX_RELEASE_PRS)
          .default(100)
          .describe(`Maximum PRs to include (default 100, max ${MAX_RELEASE_PRS}).`),
      },
      outputSchema: ReleaseNotesOutputSchema,
      annotations: {
        title: 'Generate release notes',
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    ({ repo, from, to, base, limit }) =>
      runTool(ctx.logger, 'generate_release_notes', ReleaseNotesOutputSchema, () =>
        generateReleaseNotes(ctx.github, {
          repo: parseRepoRef(repo),
          from,
          limit,
          ...(to ? { to } : {}),
          ...(base ? { base } : {}),
        }),
      ),
  );
}
