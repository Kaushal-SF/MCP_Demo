import { describe, expect, it } from 'vitest';
import { DevflowError, mapGitHubError } from '../../src/lib/errors.js';
import { createPathMatcher, globToRegExp } from '../../src/lib/glob.js';
import { extractLinkedIssues } from '../../src/lib/issue-refs.js';
import { decodeCursor, encodeCursor } from '../../src/lib/pagination.js';
import { parsePullRequestRef, parseRepoRef } from '../../src/lib/pr-ref.js';

describe('parsePullRequestRef', () => {
  it.each([
    ['https://github.com/acme/web/pull/42', { owner: 'acme', repo: 'web', number: 42 }],
    ['https://github.com/acme/web/pull/42/files', { owner: 'acme', repo: 'web', number: 42 }],
    ['https://github.com/acme/web/pull/42#discussion', { owner: 'acme', repo: 'web', number: 42 }],
    ['https://ghe.corp.io/team/my.repo/pull/7', { owner: 'team', repo: 'my.repo', number: 7 }],
    ['acme/web#42', { owner: 'acme', repo: 'web', number: 42 }],
    ['  acme/web-app#1  ', { owner: 'acme', repo: 'web-app', number: 1 }],
  ])('parses %s', (input, expected) => {
    expect(parsePullRequestRef(input)).toEqual(expected);
  });

  it.each(['42', 'acme/web', 'https://github.com/acme/web/issues/42', 'acme web#1', ''])(
    'rejects %j with INVALID_INPUT',
    (input) => {
      expect(() => parsePullRequestRef(input)).toThrow(
        expect.objectContaining({ code: 'INVALID_INPUT' }),
      );
    },
  );
});

describe('parseRepoRef', () => {
  it('parses owner/repo', () => {
    expect(parseRepoRef('acme/web')).toEqual({ owner: 'acme', repo: 'web' });
  });
  it('rejects other shapes', () => {
    expect(() => parseRepoRef('acme')).toThrow(DevflowError);
  });
});

describe('globToRegExp / createPathMatcher', () => {
  it.each([
    ['**/auth/**', 'src/auth/login.ts', true],
    ['**/auth/**', 'auth/login.ts', true],
    ['**/auth/**', 'src/author.ts', false],
    ['.github/workflows/**', '.github/workflows/ci.yml', true],
    ['.github/workflows/**', 'x/.github/workflows/ci.yml', false],
    ['Dockerfile', 'services/api/Dockerfile', true],
    ['Dockerfile', 'Dockerfile.dev', false],
    ['**/*.tf', 'infra/main.tf', true],
    ['**/*secret*', 'config/secrets.yaml', true],
    ['src/*.ts', 'src/a.ts', true],
    ['src/*.ts', 'src/nested/a.ts', false],
    ['file?.md', 'docs/file1.md', true],
  ])('%s matches %s → %s', (pattern, path, expected) => {
    expect(globToRegExp(pattern).test(path)).toBe(expected);
  });

  it('matches any of several patterns', () => {
    const matches = createPathMatcher(['**/*.tf', 'Dockerfile']);
    expect(matches('a/Dockerfile')).toBe(true);
    expect(matches('a/b.ts')).toBe(false);
  });
});

describe('extractLinkedIssues', () => {
  it('finds closing keywords in several forms, de-duplicated', () => {
    const body = `Fixes #12. Also closes acme/api#34
    Resolves: https://github.com/acme/api/issues/56
    fixes #12 again, and mentions #99 without a keyword.`;
    expect(extractLinkedIssues(body)).toEqual(['#12', 'acme/api#34', 'acme/api#56']);
  });

  it('returns an empty list when nothing is linked', () => {
    expect(extractLinkedIssues('Refactor only, see #3')).toEqual([]);
  });
});

describe('cursor encoding', () => {
  it('round-trips', () => {
    expect(decodeCursor(encodeCursor({ page: 3, perPage: 10 }), 5)).toEqual({
      page: 3,
      perPage: 10,
    });
  });

  it('defaults to the first page', () => {
    expect(decodeCursor(undefined, 7)).toEqual({ page: 1, perPage: 7 });
  });

  it.each(['garbage', encodeCursor({ page: 0, perPage: 10 }), 'eyJwYWdlIjoxfQ'])(
    'rejects invalid cursor %s',
    (cursor) => {
      expect(() => decodeCursor(cursor, 10)).toThrow(
        expect.objectContaining({ code: 'INVALID_INPUT' }),
      );
    },
  );
});

describe('mapGitHubError', () => {
  const http = (status: number, headers: Record<string, string> = {}) => ({
    status,
    response: { headers },
  });

  it.each([
    [401, {}, 'UNAUTHORIZED'],
    [403, {}, 'FORBIDDEN'],
    [403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1800000000' }, 'RATE_LIMITED'],
    [429, {}, 'RATE_LIMITED'],
    [404, {}, 'NOT_FOUND'],
    [422, {}, 'INVALID_INPUT'],
    [502, {}, 'UPSTREAM_ERROR'],
  ])('maps HTTP %i to %s', (status, headers, code) => {
    expect(mapGitHubError(http(status, headers), 'thing').code).toBe(code);
  });

  it('includes the reset time for rate limits', () => {
    const error = mapGitHubError(
      http(403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1800000000' }),
      'x',
    );
    expect(error.message).toContain('2027-01-15T08:00:00.000Z');
  });

  it('passes DevflowErrors through and wraps unknown errors as INTERNAL', () => {
    const original = new DevflowError('NOT_FOUND', 'nope');
    expect(mapGitHubError(original, 'x')).toBe(original);
    expect(mapGitHubError(new Error('boom'), 'x').code).toBe('INTERNAL');
  });
});
