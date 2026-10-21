import { ResourceTemplate, type McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ServerContext } from '../context.js';
import { parseRepoRef } from '../lib/pr-ref.js';
import { runRequest, singleValue } from '../lib/request-result.js';
import { getRepoGuidelines, renderGuidelines } from '../services/repo-guidelines.js';

export const guidelinesUri = (owner: string, repo: string) =>
  `devflow://repos/${owner}/${repo}/guidelines`;

/**
 * Exposes a repository's CONTRIBUTING guide and PR template: `devflow://repos/{owner}/{repo}/guidelines`.
 *
 * No `list` callback: there is no meaningful finite list of "all repositories", so this is a
 * template the model or user fills in, which is exactly what resource templates are for.
 */
export function registerRepoGuidelinesResource(server: McpServer, ctx: ServerContext): void {
  server.registerResource(
    'repo-guidelines',
    new ResourceTemplate(guidelinesUri('{owner}', '{repo}'), { list: undefined }),
    {
      title: 'Repository contribution guidelines',
      description:
        "A repository's CONTRIBUTING guide and pull-request template, combined into one Markdown " +
        'document. Use it to check a PR against the project’s own rules. Content is written by ' +
        'the repository maintainers.',
      mimeType: 'text/markdown',
    },
    (uri, variables) =>
      runRequest(ctx.logger, { kind: 'resource', name: 'repo-guidelines' }, async () => {
        // Re-parse through the same validator tools use, so a crafted URI cannot smuggle odd names.
        const repo = parseRepoRef(`${singleValue(variables.owner)}/${singleValue(variables.repo)}`);
        const guidelines = await getRepoGuidelines(ctx.github, repo);
        return {
          contents: [
            { uri: uri.href, mimeType: 'text/markdown', text: renderGuidelines(guidelines) },
          ],
        };
      }),
  );
}
