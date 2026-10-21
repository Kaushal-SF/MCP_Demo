import type {
  ChangedFile,
  CheckSummary,
  CommitInfo,
  GitHubClient,
  PullRequestInfo,
  PullRequestSearchItem,
  PullRequestSearchParams,
  ReviewRequestItem,
  SearchPage,
} from '../../src/clients/github.js';
import { DevflowError } from '../../src/lib/errors.js';
import { formatPullRequestRef, type PullRequestRef, type RepoRef } from '../../src/lib/pr-ref.js';

export function makePr(overrides: Partial<PullRequestInfo> = {}): PullRequestInfo {
  const ref = overrides.ref ?? { owner: 'acme', repo: 'web', number: 42 };
  return {
    ref,
    url: `https://github.com/${ref.owner}/${ref.repo}/pull/${ref.number}`,
    title: 'Add login rate limiting',
    body: 'Adds rate limiting to the login endpoint.\n\nFixes #12',
    author: 'octocat',
    state: 'open',
    draft: false,
    baseBranch: 'main',
    headBranch: 'feature/rate-limit',
    headSha: 'abc1234def5678',
    createdAt: '2026-10-01T10:00:00Z',
    updatedAt: '2026-10-02T10:00:00Z',
    mergedAt: null,
    additions: 120,
    deletions: 30,
    changedFiles: 3,
    commits: 2,
    labels: ['feature'],
    requestedReviewers: ['reviewer1'],
    ...overrides,
  };
}

export function makeFile(path: string, additions = 10, deletions = 0): ChangedFile {
  return { path, status: 'modified', additions, deletions };
}

export function makeChecks(overrides: Partial<CheckSummary> = {}): CheckSummary {
  return {
    state: 'success',
    total: 2,
    passed: 2,
    failed: 0,
    pending: 0,
    other: 0,
    failing: [],
    ...overrides,
  };
}

export function makeReviewItem(number: number, createdAt: string): ReviewRequestItem {
  return {
    ref: { owner: 'acme', repo: 'web', number },
    url: `https://github.com/acme/web/pull/${number}`,
    title: `PR ${number}`,
    author: 'octocat',
    draft: false,
    createdAt,
    updatedAt: createdAt,
  };
}

export function makeSearchItem(
  number: number,
  overrides: Partial<PullRequestSearchItem> = {},
): PullRequestSearchItem {
  return {
    ...makeReviewItem(number, '2026-10-01T00:00:00Z'),
    state: 'merged',
    labels: [],
    closedAt: '2026-10-05T00:00:00Z',
    mergedAt: '2026-10-05T00:00:00Z',
    ...overrides,
  };
}

/**
 * In-memory GitHubClient for service and integration tests.
 * Unknown PRs raise NOT_FOUND exactly like the real client does.
 */
export class FakeGitHubClient implements GitHubClient {
  login = 'reviewer1';
  prs = new Map<string, PullRequestInfo>();
  files = new Map<string, ChangedFile[]>();
  checks: CheckSummary | Error = makeChecks();
  reviewRequests: SearchPage<ReviewRequestItem> = { items: [], totalCount: 0 };
  searchCalls: Parameters<GitHubClient['searchReviewRequests']>[0][] = [];
  /** Keyed by "owner/repo@ref". */
  commits = new Map<string, CommitInfo>();
  /** Keyed by "owner/repo:path". */
  fileTexts = new Map<string, string>();
  prSearchCalls: PullRequestSearchParams[] = [];
  /** Decides what searchPullRequests returns; defaults to an empty page. */
  prSearch: (params: PullRequestSearchParams) => SearchPage<PullRequestSearchItem> = () => ({
    items: [],
    totalCount: 0,
  });

  addPr(pr: PullRequestInfo, files: ChangedFile[] = []): this {
    this.prs.set(formatPullRequestRef(pr.ref), pr);
    this.files.set(formatPullRequestRef(pr.ref), files);
    return this;
  }

  getAuthenticatedLogin(): Promise<string> {
    return Promise.resolve(this.login);
  }

  getPullRequest(ref: PullRequestRef): Promise<PullRequestInfo> {
    const pr = this.prs.get(formatPullRequestRef(ref));
    return pr
      ? Promise.resolve(pr)
      : Promise.reject(
          new DevflowError('NOT_FOUND', `Could not find ${formatPullRequestRef(ref)}.`),
        );
  }

  listPullRequestFiles(
    ref: PullRequestRef,
    limit: number,
    options: { includePatch?: boolean } = {},
  ): Promise<{ files: ChangedFile[]; truncated: boolean }> {
    const all = this.files.get(formatPullRequestRef(ref)) ?? [];
    // Mirror the real client: patches only when asked for.
    const files = all
      .slice(0, limit)
      .map(({ patch, ...file }) => (options.includePatch && patch ? { ...file, patch } : file));
    return Promise.resolve({ files, truncated: all.length > limit });
  }

  getCommit(repo: RepoRef, ref: string): Promise<CommitInfo> {
    const commit = this.commits.get(`${repo.owner}/${repo.repo}@${ref}`);
    return commit
      ? Promise.resolve(commit)
      : Promise.reject(new DevflowError('NOT_FOUND', `"${ref}" is not a tag, branch or commit.`));
  }

  getFileText(repo: RepoRef, path: string): Promise<string | null> {
    return Promise.resolve(this.fileTexts.get(`${repo.owner}/${repo.repo}:${path}`) ?? null);
  }

  searchPullRequests(params: PullRequestSearchParams): Promise<SearchPage<PullRequestSearchItem>> {
    this.prSearchCalls.push(params);
    return Promise.resolve(this.prSearch(params));
  }

  getCheckSummary(): Promise<CheckSummary> {
    return this.checks instanceof Error
      ? Promise.reject(this.checks)
      : Promise.resolve(this.checks);
  }

  searchReviewRequests(
    params: Parameters<GitHubClient['searchReviewRequests']>[0],
  ): Promise<SearchPage<ReviewRequestItem>> {
    this.searchCalls.push(params);
    // Mirror the real client, which builds this on searchPullRequests and so returns the richer
    // PullRequestSearchItem. Returning only the narrow type here once hid a real bug (PROGRESS M2).
    return Promise.resolve({
      ...this.reviewRequests,
      items: this.reviewRequests.items.map((item): PullRequestSearchItem => ({
        state: 'open',
        labels: [],
        closedAt: null,
        mergedAt: null,
        ...item,
      })),
    });
  }
}
