import type { GitHubClient, ReviewRequestItem } from '../clients/github.js';
import { decodeCursor, encodeCursor } from '../lib/pagination.js';
import type { RepoRef } from '../lib/pr-ref.js';

export type SizeLabel = 'XS' | 'S' | 'M' | 'L' | 'XL';

export interface ReviewQueueItem extends ReviewRequestItem {
  /** Whole days since the PR was opened (proxy for how long it has been waiting). */
  ageDays: number;
  /** Omitted when the PR details could not be fetched. */
  size?: {
    label: SizeLabel;
    additions: number;
    deletions: number;
    changedFiles: number;
  };
}

export interface ReviewQueue {
  reviewer: string;
  totalCount: number;
  items: ReviewQueueItem[];
  nextCursor?: string;
}

export interface ReviewQueueOptions {
  repo?: RepoRef;
  /** Page size for the first page; later pages reuse the size stored in the cursor. */
  limit: number;
  cursor?: string;
  /** Injected for deterministic tests. */
  now?: Date;
}

/** GitHub search only returns the first 1000 results. */
const SEARCH_RESULT_CAP = 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export function sizeLabel(lines: number): SizeLabel {
  if (lines < 10) return 'XS';
  if (lines < 50) return 'S';
  if (lines < 250) return 'M';
  if (lines < 1000) return 'L';
  return 'XL';
}

/**
 * Open PRs where the authenticated user's review is requested, oldest first,
 * enriched with size so the reviewer can pick quick wins or block out time.
 */
export async function listReviewQueue(
  github: GitHubClient,
  options: ReviewQueueOptions,
): Promise<ReviewQueue> {
  const { page, perPage } = decodeCursor(options.cursor, options.limit);
  const now = options.now ?? new Date();
  // Search needs an explicit login. The client caches it, so this costs one API call per process.
  const login = await github.getAuthenticatedLogin();

  const result = await github.searchReviewRequests({
    login,
    ...(options.repo ? { repo: options.repo } : {}),
    page,
    perPage,
  });

  // Search results carry no line counts, so each item needs one pulls.get call (an N+1 pattern).
  // Acceptable because N is capped at 30 and the calls run in parallel, well within GitHub's
  // 5,000 requests/hour budget.
  const items = await Promise.all(
    result.items.map(async (found): Promise<ReviewQueueItem> => {
      // Copy fields explicitly instead of spreading: the client may return a richer object than
      // ReviewRequestItem, and extra fields would break the strict published output schema.
      const item: ReviewRequestItem = {
        ref: found.ref,
        url: found.url,
        title: found.title,
        author: found.author,
        draft: found.draft,
        createdAt: found.createdAt,
        updatedAt: found.updatedAt,
      };
      const ageDays = Math.floor((now.getTime() - new Date(item.createdAt).getTime()) / DAY_MS);
      try {
        const pr = await github.getPullRequest(item.ref);
        return {
          ...item,
          ageDays,
          size: {
            label: sizeLabel(pr.additions + pr.deletions),
            additions: pr.additions,
            deletions: pr.deletions,
            changedFiles: pr.changedFiles,
          },
        };
      } catch {
        // Size is a nice-to-have; never fail the whole queue because one PR is unreadable.
        return { ...item, ageDays };
      }
    }),
  );

  // There is another page only if this one was full AND we have not reached the real total or the
  // 1000-result search cap (GitHub returns 422 for pages past it).
  const seen = (page - 1) * perPage + result.items.length;
  const hasMore =
    result.items.length === perPage && seen < Math.min(result.totalCount, SEARCH_RESULT_CAP);

  return {
    reviewer: login,
    totalCount: result.totalCount,
    items,
    ...(hasMore ? { nextCursor: encodeCursor({ page: page + 1, perPage }) } : {}),
  };
}
