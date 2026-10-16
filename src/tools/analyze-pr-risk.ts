import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { parsePullRequestRef } from '../lib/pr-ref.js';
import { runTool } from '../lib/tool-result.js';
import { getPrContext } from '../services/pr-context.js';
import { analyzeRisk } from '../services/risk-analyzer.js';
import type { ToolContext } from './context.js';
import { AnalyzePrRiskOutputSchema, prInput } from './schemas.js';

/** Enough for almost every PR; GitHub itself caps the file list at 3000. */
const MAX_FILES_FOR_ANALYSIS = 1000;

export function registerAnalyzePrRisk(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'analyze_pr_risk',
    {
      title: 'Analyze pull request risk',
      description:
        'Score a GitHub pull request for review risk (0–100, low/medium/high) using deterministic ' +
        'heuristics: change size, files without accompanying tests, sensitive paths (auth, secrets, ' +
        'CI/CD, infra, migrations), dependency changes, missing description and failing CI. ' +
        'Each signal explains itself, and focusFiles suggests a reading order. Use this to decide ' +
        'how much review attention a PR needs and where to look first.',
      inputSchema: { pr: prInput },
      outputSchema: AnalyzePrRiskOutputSchema,
      annotations: {
        title: 'Analyze pull request risk',
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    ({ pr }) =>
      runTool(ctx.logger, 'analyze_pr_risk', async () => {
        // Same service as get_pr_context, so both tools always see identical data. The analysis
        // itself is pure and makes no further API calls.
        const context = await getPrContext(ctx.github, parsePullRequestRef(pr), {
          maxFiles: MAX_FILES_FOR_ANALYSIS,
        });
        const risk = analyzeRisk(context, { extraSensitivePaths: ctx.extraSensitivePaths });
        // Only a PR summary: the model usually has full context from get_pr_context already, so
        // repeating it here would just spend tokens.
        return {
          pr: { ref: context.pr.ref, url: context.pr.url, title: context.pr.title },
          risk,
        };
      }),
  );
}
