import type {
  ChangedFile,
  CheckSummary,
  GitHubClient,
  PullRequestInfo,
} from '../clients/github.js';
import { DevflowError } from '../lib/errors.js';
import { extractLinkedIssues } from '../lib/issue-refs.js';
import type { PullRequestRef } from '../lib/pr-ref.js';

export interface PrContext {
  pr: PullRequestInfo;
  files: ChangedFile[];
  /** True when the PR has more files than were fetched. */
  filesTruncated: boolean;
  /** Null when CI status could not be read (e.g. token lacks Checks permission). */
  checks: CheckSummary | null;
  checksError?: string;
  /** Issues the PR body says it closes, e.g. ["#12", "acme/api#34"]. */
  linkedIssues: string[];
}

export interface PrContextOptions {
  maxFiles: number;
}

/**
 * Collects everything a reviewer usually opens in separate tabs: PR metadata, changed files,
 * CI status and linked issues. CI is best-effort so a permissions gap never hides the rest.
 */
export async function getPrContext(
  github: GitHubClient,
  ref: PullRequestRef,
  options: PrContextOptions,
): Promise<PrContext> {
  const pr = await github.getPullRequest(ref);

  const [fileResult, checksResult] = await Promise.all([
    github.listPullRequestFiles(ref, options.maxFiles),
    github.getCheckSummary(ref, pr.headSha).then(
      (checks) => ({ checks, error: undefined }),
      (error: unknown) => ({
        checks: null,
        error:
          error instanceof DevflowError ? error.message : 'CI status is unavailable right now.',
      }),
    ),
  ]);

  return {
    pr,
    files: fileResult.files,
    filesTruncated: fileResult.truncated,
    checks: checksResult.checks,
    ...(checksResult.error ? { checksError: checksResult.error } : {}),
    linkedIssues: extractLinkedIssues(pr.body),
  };
}
