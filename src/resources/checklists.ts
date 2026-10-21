import { ResourceTemplate, type McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ServerContext } from '../context.js';
import { runRequest, singleValue } from '../lib/request-result.js';

export const checklistUri = (name: string) => `devflow://checklists/${name}`;

/**
 * Exposes review checklists as resources: `devflow://checklists/{name}`.
 *
 * Resources (not tools) because a checklist is reference material the user or host chooses to
 * attach, not an action the model performs. The template's `list` callback makes every checklist
 * show up in resources/list, and `complete` lets hosts autocomplete `{name}`.
 */
export function registerChecklistResources(server: McpServer, ctx: ServerContext): void {
  server.registerResource(
    'checklist',
    new ResourceTemplate(checklistUri('{name}'), {
      list: async () => ({
        resources: (await ctx.checklists.list()).map((checklist) => ({
          uri: checklistUri(checklist.name),
          name: checklist.name,
          title: checklist.title,
          description: checklist.description,
          mimeType: 'text/markdown',
        })),
      }),
      complete: {
        name: async (value) =>
          (await ctx.checklists.list())
            .map((checklist) => checklist.name)
            .filter((name) => name.startsWith(value)),
      },
    }),
    {
      title: 'Review checklist',
      description:
        'A code-review checklist in Markdown (e.g. general, react, node, security). ' +
        'Apply it item by item when reviewing a pull request.',
      mimeType: 'text/markdown',
    },
    (uri, variables) =>
      runRequest(ctx.logger, { kind: 'resource', name: 'checklist' }, async () => {
        const checklist = await ctx.checklists.read(singleValue(variables.name));
        return {
          contents: [{ uri: uri.href, mimeType: 'text/markdown', text: checklist.content }],
        };
      }),
  );
}
