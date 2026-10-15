import { describe, expect, it } from 'vitest';
import { DevflowError } from '../../src/lib/errors.js';
import { decodeCursor } from '../../src/lib/pagination.js';
import { getPrContext } from '../../src/services/pr-context.js';
import { listReviewQueue, sizeLabel } from '../../src/services/review-queue.js';
import { FakeGitHubClient, makeFile, makePr, makeReviewItem } from '../helpers/fixtures.js';

const REF = { owner: 'acme', repo: 'web', number: 42 };

describe('getPrContext', () => {
  it('combines PR, files, checks and linked issues', async () => {
    const github = new FakeGitHubClient().addPr(makePr(), [
      makeFile('src/a.ts'),
      makeFile('src/b.ts'),
    ]);
    const context = await getPrContext(github, REF, { maxFiles: 1 });

    expect(context.pr.title).toBe('Add login rate limiting');
    expect(context.files).toHaveLength(1);
    expect(context.filesTruncated).toBe(true);
    expect(context.checks?.state).toBe('success');
    expect(context.checksError).toBeUndefined();
    expect(context.linkedIssues).toEqual(['#12']);
  });

  it('degrades gracefully when CI status is unavailable', async () => {
    const github = new FakeGitHubClient().addPr(makePr());
    github.checks = new DevflowError('FORBIDDEN', 'No Checks permission.');
    const context = await getPrContext(github, REF, { maxFiles: 10 });
    expect(context.checks).toBeNull();
    expect(context.checksError).toBe('No Checks permission.');

    github.checks = new Error('socket hang up');
    expect((await getPrContext(github, REF, { maxFiles: 10 })).checksError).toBe(
      'CI status is unavailable right now.',
    );
  });

  it('propagates a missing PR as NOT_FOUND', async () => {
    await expect(getPrContext(new FakeGitHubClient(), REF, { maxFiles: 10 })).rejects.toMatchObject(
      {
        code: 'NOT_FOUND',
      },
    );
  });
});

describe('sizeLabel', () => {
  it.each([
    [0, 'XS'],
    [9, 'XS'],
    [10, 'S'],
    [49, 'S'],
    [50, 'M'],
    [249, 'M'],
    [250, 'L'],
    [999, 'L'],
    [1000, 'XL'],
  ])('%i lines → %s', (lines, label) => {
    expect(sizeLabel(lines)).toBe(label);
  });
});

describe('listReviewQueue', () => {
  const now = new Date('2026-10-15T12:00:00Z');

  function setup(totalCount: number, numbers: number[]) {
    const github = new FakeGitHubClient();
    github.reviewRequests = {
      totalCount,
      items: numbers.map((n) => makeReviewItem(n, '2026-10-10T09:00:00Z')),
    };
    for (const n of numbers) {
      github.addPr(makePr({ ref: { ...REF, number: n }, additions: 40, deletions: 5 }));
    }
    return github;
  }

  it('returns enriched items for the authenticated reviewer', async () => {
    const github = setup(2, [1, 2]);
    const queue = await listReviewQueue(github, { limit: 10, now });

    expect(queue.reviewer).toBe('reviewer1');
    expect(queue.items[0]).toMatchObject({
      ageDays: 5,
      size: { label: 'S', additions: 40, deletions: 5, changedFiles: 3 },
    });
    expect(queue.nextCursor).toBeUndefined();
    expect(github.searchCalls[0]).toEqual({ login: 'reviewer1', page: 1, perPage: 10 });
  });

  it('keeps items whose details cannot be fetched, without size', async () => {
    const github = setup(1, [1]);
    github.prs.clear();
    const queue = await listReviewQueue(github, { limit: 10, now });
    expect(queue.items[0]?.size).toBeUndefined();
    expect(queue.items[0]?.ageDays).toBe(5);
  });

  it('paginates with an opaque cursor that remembers the page size', async () => {
    const github = setup(5, [1, 2]);
    const first = await listReviewQueue(github, {
      limit: 2,
      now,
      repo: { owner: 'acme', repo: 'web' },
    });
    expect(first.nextCursor).toBeDefined();
    expect(decodeCursor(first.nextCursor, 99)).toEqual({ page: 2, perPage: 2 });
    expect(github.searchCalls[0]?.repo).toEqual({ owner: 'acme', repo: 'web' });

    // A different limit on the follow-up call must not change the page size.
    await listReviewQueue(github, {
      limit: 30,
      now,
      ...(first.nextCursor ? { cursor: first.nextCursor } : {}),
    });
    expect(github.searchCalls[1]).toMatchObject({ page: 2, perPage: 2 });
  });

  it('stops paginating at the GitHub search cap of 1000 results', async () => {
    const github = setup(5000, [1, 2]);
    const cursorAtCap = Buffer.from(JSON.stringify({ page: 500, perPage: 2 })).toString(
      'base64url',
    );
    const queue = await listReviewQueue(github, { limit: 2, now, cursor: cursorAtCap });
    expect(queue.nextCursor).toBeUndefined();
  });
});
