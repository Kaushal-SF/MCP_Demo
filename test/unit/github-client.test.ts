import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { OctokitGitHubClient } from '../../src/clients/github.js';

/**
 * Exercises the real Octokit adapter against a mocked GitHub REST API, checking that raw API
 * JSON is mapped to our domain types and HTTP failures to DevflowErrors.
 */
const API = 'https://api.github.com';
const REF = { owner: 'acme', repo: 'web', number: 42 };

const server = setupServer();
beforeAll(() => {
  server.listen({ onUnhandledFrame: 'error' });
});
afterEach(() => {
  server.resetHandlers();
});
afterAll(() => {
  server.close();
});

const client = () => new OctokitGitHubClient({ token: 'test-token', userAgent: 'devflow-test' });

describe('OctokitGitHubClient', () => {
  it('maps a pull request and sends the token', async () => {
    let auth: string | null = null;
    server.use(
      http.get(`${API}/repos/acme/web/pulls/42`, ({ request }) => {
        auth = request.headers.get('authorization');
        return HttpResponse.json({
          html_url: 'https://github.com/acme/web/pull/42',
          title: 'Add thing',
          body: null,
          user: { login: 'octocat' },
          state: 'closed',
          merged_at: '2026-10-03T00:00:00Z',
          draft: false,
          base: { ref: 'main' },
          head: { ref: 'feat', sha: 'abc123' },
          created_at: '2026-10-01T00:00:00Z',
          updated_at: '2026-10-03T00:00:00Z',
          additions: 10,
          deletions: 2,
          changed_files: 1,
          commits: 1,
          labels: [{ name: 'bug' }],
          requested_reviewers: [{ login: 'r1' }],
        });
      }),
    );

    const pr = await client().getPullRequest(REF);
    expect(auth).toBe('token test-token');
    expect(pr).toMatchObject({
      title: 'Add thing',
      body: '',
      state: 'merged',
      headSha: 'abc123',
      labels: ['bug'],
      requestedReviewers: ['r1'],
    });
  });

  it('maps 404 to NOT_FOUND with a helpful message', async () => {
    server.use(
      http.get(`${API}/repos/acme/web/pulls/42`, () =>
        HttpResponse.json({ message: 'Not Found' }, { status: 404 }),
      ),
    );
    await expect(client().getPullRequest(REF)).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: expect.stringContaining('acme/web#42'),
    });
  });

  it('paginates files and truncates at the limit', async () => {
    const page = (start: number, count: number) =>
      Array.from({ length: count }, (_, i) => ({
        filename: `f${start + i}.ts`,
        status: 'modified',
        additions: 1,
        deletions: 0,
      }));
    server.use(
      http.get(`${API}/repos/acme/web/pulls/42/files`, ({ request }) => {
        const pageNumber = Number(new URL(request.url).searchParams.get('page') ?? '1');
        const headers =
          pageNumber === 1
            ? { link: `<${API}/repos/acme/web/pulls/42/files?per_page=100&page=2>; rel="next"` }
            : undefined;
        return HttpResponse.json(pageNumber === 1 ? page(0, 100) : page(100, 20), { headers });
      }),
    );

    const all = await client().listPullRequestFiles(REF, 500);
    expect(all.files).toHaveLength(120);
    expect(all.truncated).toBe(false);

    const limited = await client().listPullRequestFiles(REF, 50);
    expect(limited.files).toHaveLength(50);
    expect(limited.truncated).toBe(true);
  });

  it('merges check runs and commit statuses into one summary', async () => {
    server.use(
      http.get(`${API}/repos/acme/web/commits/abc123/check-runs`, () =>
        HttpResponse.json({
          total_count: 4,
          check_runs: [
            { name: 'build', status: 'completed', conclusion: 'success', html_url: 'u1' },
            { name: 'lint', status: 'completed', conclusion: 'failure', html_url: 'u2' },
            { name: 'e2e', status: 'in_progress', conclusion: null, html_url: 'u3' },
            { name: 'docs', status: 'completed', conclusion: 'skipped', html_url: 'u4' },
          ],
        }),
      ),
      http.get(`${API}/repos/acme/web/commits/abc123/status`, () =>
        HttpResponse.json({
          statuses: [
            { context: 'ci/legacy', state: 'success', target_url: null },
            { context: 'ci/deploy', state: 'error', target_url: 'u5' },
          ],
        }),
      ),
    );

    const checks = await client().getCheckSummary(REF, 'abc123');
    expect(checks).toEqual({
      state: 'failure',
      total: 6,
      passed: 2,
      failed: 2,
      pending: 1,
      other: 1,
      failing: [
        { name: 'lint', conclusion: 'failure', url: 'u2' },
        { name: 'ci/deploy', conclusion: 'error', url: 'u5' },
      ],
    });
  });

  it('builds the review-request search query and maps results', async () => {
    let query: string | null = null;
    server.use(
      http.get(`${API}/user`, () => HttpResponse.json({ login: 'reviewer1' })),
      http.get(`${API}/search/issues`, ({ request }) => {
        query = new URL(request.url).searchParams.get('q');
        return HttpResponse.json({
          total_count: 1,
          incomplete_results: false,
          items: [
            {
              number: 7,
              repository_url: `${API}/repos/acme/api`,
              html_url: 'https://github.com/acme/api/pull/7',
              title: 'Fix bug',
              user: { login: 'dev' },
              draft: true,
              state: 'open',
              labels: [],
              created_at: '2026-10-01T00:00:00Z',
              updated_at: '2026-10-02T00:00:00Z',
            },
          ],
        });
      }),
    );

    const github = client();
    const login = await github.getAuthenticatedLogin();
    const result = await github.searchReviewRequests({
      login,
      repo: { owner: 'acme', repo: 'api' },
      page: 1,
      perPage: 10,
    });

    expect(query).toBe('is:pr is:open archived:false review-requested:reviewer1 repo:acme/api');
    expect(result.items[0]).toMatchObject({
      ref: { owner: 'acme', repo: 'api', number: 7 },
      author: 'dev',
      draft: true,
    });
  });

  it('maps 401 on the authenticated user lookup and retries next time', async () => {
    server.use(
      http.get(
        `${API}/user`,
        () => HttpResponse.json({ message: 'Bad credentials' }, { status: 401 }),
        {
          once: true,
        },
      ),
      http.get(`${API}/user`, () => HttpResponse.json({ login: 'reviewer1' })),
    );
    const github = client();
    await expect(github.getAuthenticatedLogin()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    await expect(github.getAuthenticatedLogin()).resolves.toBe('reviewer1');
  });
  it('resolves a ref to its commit SHA and committer date, and maps 422 to NOT_FOUND', async () => {
    server.use(
      http.get(`${API}/repos/acme/web/commits/v1.0.0`, () =>
        HttpResponse.json({
          sha: 'abc123',
          commit: {
            author: { date: '2026-09-01T00:00:00Z' },
            committer: { date: '2026-09-02T00:00:00Z' },
          },
        }),
      ),
      http.get(`${API}/repos/acme/web/commits/nope`, () =>
        HttpResponse.json({ message: 'No commit found' }, { status: 422 }),
      ),
    );
    await expect(client().getCommit(REF, 'v1.0.0')).resolves.toEqual({
      sha: 'abc123',
      date: '2026-09-02T00:00:00Z',
    });
    await expect(client().getCommit(REF, 'nope')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('reads file text, returning null for missing files and directories', async () => {
    server.use(
      http.get(`${API}/repos/acme/web/contents/CONTRIBUTING.md`, () =>
        HttpResponse.json({
          type: 'file',
          encoding: 'base64',
          content: Buffer.from('# Contributing\n').toString('base64'),
        }),
      ),
      http.get(`${API}/repos/acme/web/contents/docs`, () => HttpResponse.json([])),
      http.get(`${API}/repos/acme/web/contents/missing.md`, () =>
        HttpResponse.json({ message: 'Not Found' }, { status: 404 }),
      ),
      http.get(`${API}/repos/acme/web/contents/secret.md`, () =>
        HttpResponse.json({ message: 'Forbidden' }, { status: 403 }),
      ),
    );
    const github = client();
    await expect(github.getFileText(REF, 'CONTRIBUTING.md')).resolves.toBe('# Contributing\n');
    await expect(github.getFileText(REF, 'docs')).resolves.toBeNull();
    await expect(github.getFileText(REF, 'missing.md')).resolves.toBeNull();
    await expect(github.getFileText(REF, 'secret.md')).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('maps search results including merge state and labels', async () => {
    let params: URLSearchParams | undefined;
    server.use(
      http.get(`${API}/search/issues`, ({ request }) => {
        params = new URL(request.url).searchParams;
        return HttpResponse.json({
          total_count: 2,
          incomplete_results: false,
          items: [
            {
              number: 1,
              repository_url: `${API}/repos/acme/web`,
              html_url: 'https://github.com/acme/web/pull/1',
              title: 'feat: a',
              user: { login: 'amy' },
              state: 'closed',
              labels: [{ name: 'feature' }, { name: null }],
              created_at: '2026-10-01T00:00:00Z',
              updated_at: '2026-10-02T00:00:00Z',
              closed_at: '2026-10-02T00:00:00Z',
              pull_request: { merged_at: '2026-10-02T00:00:00Z' },
            },
            {
              number: 2,
              repository_url: `${API}/repos/acme/web`,
              html_url: 'https://github.com/acme/web/pull/2',
              title: 'wip',
              user: null,
              state: 'open',
              labels: [],
              created_at: '2026-10-01T00:00:00Z',
              updated_at: '2026-10-02T00:00:00Z',
              closed_at: null,
              pull_request: { merged_at: null },
            },
          ],
        });
      }),
    );
    const page = await client().searchPullRequests({
      qualifiers: ['is:pr', 'author:amy'],
      sort: 'updated',
      order: 'desc',
      page: 2,
      perPage: 5,
    });
    expect(params?.get('q')).toBe('is:pr author:amy');
    expect(params?.get('sort')).toBe('updated');
    expect(params?.get('page')).toBe('2');
    expect(page.items[0]).toMatchObject({
      state: 'merged',
      labels: ['feature'],
      mergedAt: '2026-10-02T00:00:00Z',
    });
    expect(page.items[1]).toMatchObject({ state: 'open', author: 'unknown', mergedAt: null });
  });

  it('includes patches only when asked', async () => {
    server.use(
      http.get(`${API}/repos/acme/web/pulls/42/files`, () =>
        HttpResponse.json([
          { filename: 'a.ts', status: 'modified', additions: 1, deletions: 0, patch: '@@ +x' },
        ]),
      ),
    );
    const github = client();
    expect((await github.listPullRequestFiles(REF, 10)).files[0]).not.toHaveProperty('patch');
    expect(
      (await github.listPullRequestFiles(REF, 10, { includePatch: true })).files[0],
    ).toMatchObject({
      patch: '@@ +x',
    });
  });
});
