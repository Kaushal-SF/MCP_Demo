import type { GitHubClient, PullRequestSearchItem } from '../clients/github.js';
import type { RepoRef } from '../lib/pr-ref.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface ActivityList {
  totalCount: number;
  items: PullRequestSearchItem[];
}

export interface Activity {
  user: string;
  /** Start of the window (ISO 8601, UTC). */
  since: string;
  days: number;
  /** PRs authored by the user and merged in the window. */
  merged: ActivityList;
  /** PRs authored by the user that are still open and saw activity in the window. */
  inProgress: ActivityList;
  /** Other people's PRs the user reviewed that saw activity in the window. */
  reviewed: ActivityList;
  /** Open PRs currently waiting for the user's review (count only). */
  pendingReviewRequests: number;
}

export interface ActivityOptions {
  /** GitHub login; defaults to the token's user. */
  user?: string;
  days: number;
  repo?: RepoRef;
  perList: number;
  /** Injected for deterministic tests. */
  now?: Date;
}

/** GitHub search accepts second-precision UTC timestamps; milliseconds break the qualifier. */
function toSearchTimestamp(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * Collects what a person did on GitHub recently, shaped for a stand-up update.
 *
 * Four searches run in parallel. "Reviewed" is approximated as "reviewed by the user and updated
 * in the window", because search cannot filter on review time; the stand-up prompt tells the model
 * to treat it as recent review activity. See Decisions.md D26.
 */
export async function getActivity(
  github: GitHubClient,
  options: ActivityOptions,
): Promise<Activity> {
  const now = options.now ?? new Date();
  const user = options.user ?? (await github.getAuthenticatedLogin());
  const since = toSearchTimestamp(new Date(now.getTime() - options.days * DAY_MS));
  const repoQualifier = options.repo ? [`repo:${options.repo.owner}/${options.repo.repo}`] : [];

  const search = async (qualifiers: string[]): Promise<ActivityList> => {
    const page = await github.searchPullRequests({
      qualifiers: ['is:pr', ...qualifiers, ...repoQualifier],
      sort: 'updated',
      order: 'desc',
      page: 1,
      perPage: options.perList,
    });
    return { totalCount: page.totalCount, items: page.items };
  };

  const [merged, inProgress, reviewed, pending] = await Promise.all([
    search([`author:${user}`, `merged:>=${since}`]),
    search([`author:${user}`, 'is:open', `updated:>=${since}`]),
    search([`reviewed-by:${user}`, `-author:${user}`, `updated:>=${since}`]),
    github.searchReviewRequests({
      login: user,
      ...(options.repo ? { repo: options.repo } : {}),
      page: 1,
      // Only the count is needed; one item is the smallest page GitHub allows.
      perPage: 1,
    }),
  ]);

  return {
    user,
    since,
    days: options.days,
    merged,
    inProgress,
    reviewed,
    pendingReviewRequests: pending.totalCount,
  };
}
