import { Octokit } from '@octokit/rest';
import { DevflowError, mapGitHubError } from '../lib/errors.js';
import { formatPullRequestRef, type PullRequestRef, type RepoRef } from '../lib/pr-ref.js';

// ---------------------------------------------------------------------------
// Domain types — a small, stable shape instead of leaking raw GitHub API JSON
// into services and tool outputs.
// ---------------------------------------------------------------------------

export type PullRequestState = 'open' | 'closed' | 'merged';

export interface PullRequestInfo {
  ref: PullRequestRef;
  url: string;
  title: string;
  /** Author-written Markdown. Untrusted content. */
  body: string;
  author: string;
  state: PullRequestState;
  draft: boolean;
  baseBranch: string;
  headBranch: string;
  headSha: string;
  createdAt: string;
  updatedAt: string;
  mergedAt: string | null;
  additions: number;
  deletions: number;
  changedFiles: number;
  commits: number;
  labels: string[];
  requestedReviewers: string[];
}

export type FileStatus =
  'added' | 'removed' | 'modified' | 'renamed' | 'copied' | 'changed' | 'unchanged';

export interface ChangedFile {
  path: string;
  status: FileStatus;
  additions: number;
  deletions: number;
  previousPath?: string;
  /**
   * Unified diff for this file. Only present when requested (it is large), and GitHub omits it
   * for binary files and very large diffs. Author-controlled content: untrusted.
   */
  patch?: string;
}

export type CheckState = 'success' | 'failure' | 'pending' | 'none';

export interface FailingCheck {
  name: string;
  conclusion: string;
  url?: string;
}

export interface CheckSummary {
  state: CheckState;
  total: number;
  passed: number;
  failed: number;
  pending: number;
  /** Skipped / neutral / stale — neither passing nor failing. */
  other: number;
  failing: FailingCheck[];
}

export interface ReviewRequestItem {
  ref: PullRequestRef;
  url: string;
  title: string;
  author: string;
  draft: boolean;
  createdAt: string;
  updatedAt: string;
}

/** A pull request as returned by GitHub search: lighter than PullRequestInfo (no sizes). */
export interface PullRequestSearchItem extends ReviewRequestItem {
  state: PullRequestState;
  labels: string[];
  closedAt: string | null;
  mergedAt: string | null;
}

export interface SearchPage<T> {
  items: T[];
  totalCount: number;
}

export interface CommitInfo {
  sha: string;
  /** Committer date (ISO 8601): when the commit landed on the branch, not when it was written. */
  date: string;
}

export interface PullRequestSearchParams {
  /** GitHub search qualifiers, e.g. ["is:pr", "author:octocat"]. Joined with spaces. */
  qualifiers: string[];
  sort?: 'created' | 'updated';
  order?: 'asc' | 'desc';
  page: number;
  perPage: number;
}

/** The port that services depend on. Tests provide a fake implementation. */
export interface GitHubClient {
  getAuthenticatedLogin(): Promise<string>;
  getPullRequest(ref: PullRequestRef): Promise<PullRequestInfo>;
  listPullRequestFiles(
    ref: PullRequestRef,
    limit: number,
    options?: { includePatch?: boolean },
  ): Promise<{ files: ChangedFile[]; truncated: boolean }>;
  getCheckSummary(repo: RepoRef, sha: string): Promise<CheckSummary>;
  /** Resolves a tag, branch or SHA to its commit. */
  getCommit(repo: RepoRef, ref: string): Promise<CommitInfo>;
  /** Text of a file on the default branch, or null when it does not exist. */
  getFileText(repo: RepoRef, path: string): Promise<string | null>;
  searchPullRequests(params: PullRequestSearchParams): Promise<SearchPage<PullRequestSearchItem>>;
  searchReviewRequests(params: {
    login: string;
    repo?: RepoRef;
    page: number;
    perPage: number;
  }): Promise<SearchPage<ReviewRequestItem>>;
}

// ---------------------------------------------------------------------------
// Octokit-backed implementation
// ---------------------------------------------------------------------------

/**
 * Conclusions that should block a merge. 'neutral', 'skipped' and 'stale' are deliberately absent:
 * they count as `other`, so a skipped optional job never makes a PR look broken.
 */
const FAILED_CONCLUSIONS = new Set([
  'failure',
  'timed_out',
  'cancelled',
  'action_required',
  'startup_failure',
  'error',
]);

export interface OctokitGitHubClientOptions {
  token: string;
  apiUrl?: string | undefined;
  userAgent: string;
}

export class OctokitGitHubClient implements GitHubClient {
  private readonly octokit: Octokit;
  private loginPromise: Promise<string> | undefined;

  constructor(options: OctokitGitHubClientOptions) {
    this.octokit = new Octokit({
      auth: options.token,
      userAgent: options.userAgent,
      ...(options.apiUrl ? { baseUrl: options.apiUrl } : {}),
      // Octokit's default logger prints unstructured console warnings (e.g. deprecation notices).
      // Silence it: failures are already turned into DevflowErrors and logged as JSON by runTool.
      log: {
        debug: () => undefined,
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
      },
    });
  }

  getAuthenticatedLogin(): Promise<string> {
    // Cache the promise, not the value, so concurrent first calls share one request. The login
    // never changes for a given token. On failure the cache is cleared so a temporary error is
    // retried next time instead of being remembered forever.
    this.loginPromise ??= this.octokit.rest.users
      .getAuthenticated()
      .then((res) => res.data.login)
      .catch((error: unknown) => {
        this.loginPromise = undefined;
        throw mapGitHubError(error, 'the authenticated user');
      });
    return this.loginPromise;
  }

  async getPullRequest(ref: PullRequestRef): Promise<PullRequestInfo> {
    try {
      const { data } = await this.octokit.rest.pulls.get({
        owner: ref.owner,
        repo: ref.repo,
        pull_number: ref.number,
      });
      return {
        ref,
        url: data.html_url,
        title: data.title,
        body: data.body ?? '',
        author: data.user.login,
        // GitHub reports merged PRs as state "closed"; merged_at is what tells them apart.
        state: data.merged_at ? 'merged' : data.state === 'open' ? 'open' : 'closed',
        draft: data.draft ?? false,
        baseBranch: data.base.ref,
        headBranch: data.head.ref,
        headSha: data.head.sha,
        createdAt: data.created_at,
        updatedAt: data.updated_at,
        mergedAt: data.merged_at,
        additions: data.additions,
        deletions: data.deletions,
        changedFiles: data.changed_files,
        commits: data.commits,
        labels: data.labels.map((label) => label.name),
        requestedReviewers: (data.requested_reviewers ?? []).map((user) => user.login),
      };
    } catch (error) {
      throw mapGitHubError(error, `pull request ${formatPullRequestRef(ref)}`);
    }
  }

  async listPullRequestFiles(
    ref: PullRequestRef,
    limit: number,
    options: { includePatch?: boolean } = {},
  ): Promise<{ files: ChangedFile[]; truncated: boolean }> {
    const files: ChangedFile[] = [];
    try {
      // The iterator (rather than paginate(), which fetches everything) stops requesting pages as
      // soon as the limit is reached; GitHub can list up to 3,000 files.
      const pages = this.octokit.paginate.iterator(this.octokit.rest.pulls.listFiles, {
        owner: ref.owner,
        repo: ref.repo,
        pull_number: ref.number,
        per_page: 100,
      });
      for await (const page of pages) {
        for (const file of page.data) {
          if (files.length >= limit) return { files, truncated: true };
          files.push({
            path: file.filename,
            status: file.status,
            additions: file.additions,
            deletions: file.deletions,
            ...(file.previous_filename ? { previousPath: file.previous_filename } : {}),
            // The patch arrives in the same response either way; we only keep it when asked so
            // callers that need just the file list do not carry megabytes of diff around.
            ...(options.includePatch && file.patch ? { patch: file.patch } : {}),
          });
        }
      }
      return { files, truncated: false };
    } catch (error) {
      throw mapGitHubError(error, `files of pull request ${formatPullRequestRef(ref)}`);
    }
  }

  async getCheckSummary(repo: RepoRef, sha: string): Promise<CheckSummary> {
    try {
      // GitHub has two CI systems: Checks API (GitHub Actions, most apps) and legacy commit statuses.
      const [checkRuns, combined] = await Promise.all([
        this.octokit.paginate(this.octokit.rest.checks.listForRef, {
          owner: repo.owner,
          repo: repo.repo,
          ref: sha,
          per_page: 100,
        }),
        this.octokit.rest.repos.getCombinedStatusForRef({
          owner: repo.owner,
          repo: repo.repo,
          ref: sha,
        }),
      ]);

      const summary: CheckSummary = {
        state: 'none',
        total: 0,
        passed: 0,
        failed: 0,
        pending: 0,
        other: 0,
        failing: [],
      };

      for (const run of checkRuns) {
        summary.total++;
        if (run.status !== 'completed') summary.pending++;
        else if (run.conclusion === 'success') summary.passed++;
        else if (run.conclusion && FAILED_CONCLUSIONS.has(run.conclusion)) {
          summary.failed++;
          summary.failing.push({
            name: run.name,
            conclusion: run.conclusion,
            ...(run.html_url ? { url: run.html_url } : {}),
          });
        } else summary.other++;
      }

      for (const status of combined.data.statuses) {
        summary.total++;
        if (status.state === 'success') summary.passed++;
        else if (status.state === 'pending') summary.pending++;
        else {
          summary.failed++;
          summary.failing.push({
            name: status.context,
            conclusion: status.state,
            ...(status.target_url ? { url: status.target_url } : {}),
          });
        }
      }

      summary.state =
        summary.total === 0
          ? 'none'
          : summary.failed > 0
            ? 'failure'
            : summary.pending > 0
              ? 'pending'
              : 'success';
      return summary;
    } catch (error) {
      throw mapGitHubError(error, `CI checks for ${repo.owner}/${repo.repo}@${sha.slice(0, 7)}`);
    }
  }

  async getCommit(repo: RepoRef, ref: string): Promise<CommitInfo> {
    try {
      const { data } = await this.octokit.rest.repos.getCommit({
        owner: repo.owner,
        repo: repo.repo,
        ref,
      });
      // Committer date, not author date: a rebased commit keeps its old author date, but the
      // committer date is when it actually entered the branch, which is what "since" means.
      const date = data.commit.committer?.date ?? data.commit.author?.date;
      if (!date) throw new DevflowError('UPSTREAM_ERROR', `GitHub returned no date for ${ref}.`);
      return { sha: data.sha, date };
    } catch (error) {
      // 422 here means "no commit matches this ref", which users experience as not found.
      if ((error as { status?: unknown }).status === 422) {
        throw new DevflowError(
          'NOT_FOUND',
          `"${ref}" is not a tag, branch or commit in ${repo.owner}/${repo.repo}.`,
          { cause: error },
        );
      }
      throw mapGitHubError(error, `ref "${ref}" in ${repo.owner}/${repo.repo}`);
    }
  }

  async getFileText(repo: RepoRef, path: string): Promise<string | null> {
    try {
      const { data } = await this.octokit.rest.repos.getContent({
        owner: repo.owner,
        repo: repo.repo,
        path,
      });
      // getContent also returns directories (arrays), symlinks and submodules. Only a file with
      // inline base64 content is usable; files over 1 MB come back with encoding "none".
      if (Array.isArray(data) || data.type !== 'file' || data.encoding !== 'base64') return null;
      return Buffer.from(data.content, 'base64').toString('utf8');
    } catch (error) {
      // A missing file is a normal answer for "does this repo have X?", not a failure.
      if ((error as { status?: unknown }).status === 404) return null;
      throw mapGitHubError(error, `${path} in ${repo.owner}/${repo.repo}`);
    }
  }

  async searchPullRequests(
    params: PullRequestSearchParams,
  ): Promise<SearchPage<PullRequestSearchItem>> {
    try {
      const { data } = await this.octokit.rest.search.issuesAndPullRequests({
        q: params.qualifiers.join(' '),
        ...(params.sort ? { sort: params.sort } : {}),
        ...(params.order ? { order: params.order } : {}),
        page: params.page,
        per_page: params.perPage,
      });
      return {
        totalCount: data.total_count,
        items: data.items.map((item) => {
          // Search results have no owner/repo fields; derive them from ".../repos/{owner}/{repo}".
          const [owner = '', repo = ''] = item.repository_url.split('/').slice(-2);
          const mergedAt = item.pull_request?.merged_at ?? null;
          return {
            ref: { owner, repo, number: item.number },
            url: item.html_url,
            title: item.title,
            author: item.user?.login ?? 'unknown',
            draft: item.draft ?? false,
            state: mergedAt ? 'merged' : item.state === 'open' ? 'open' : 'closed',
            labels: item.labels.flatMap((label) => (label.name ? [label.name] : [])),
            createdAt: item.created_at,
            updatedAt: item.updated_at,
            closedAt: item.closed_at,
            mergedAt,
          };
        }),
      };
    } catch (error) {
      throw mapGitHubError(error, 'pull requests (GitHub search)');
    }
  }

  async searchReviewRequests(params: {
    login: string;
    repo?: RepoRef;
    page: number;
    perPage: number;
  }): Promise<SearchPage<ReviewRequestItem>> {
    return this.searchPullRequests({
      qualifiers: [
        'is:pr',
        'is:open',
        'archived:false', // archived repos are read-only, so their review requests are dead ends
        // An explicit login rather than `@me` keeps the query unambiguous and readable in logs.
        `review-requested:${params.login}`,
        ...(params.repo ? [`repo:${params.repo.owner}/${params.repo.repo}`] : []),
      ],
      sort: 'created',
      order: 'asc', // oldest first: those have waited longest
      page: params.page,
      perPage: params.perPage,
    });
  }
}
