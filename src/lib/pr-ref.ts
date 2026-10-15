import { DevflowError } from './errors.js';

export interface RepoRef {
  owner: string;
  repo: string;
}

export interface PullRequestRef extends RepoRef {
  number: number;
}

const NAME = '[A-Za-z0-9_.-]+';
const URL_PATTERN = new RegExp(`^https?://[^/]+/(${NAME})/(${NAME})/pull/(\\d+)(?:[/?#].*)?$`);
const SHORT_PATTERN = new RegExp(`^(${NAME})/(${NAME})#(\\d+)$`);
const REPO_PATTERN = new RegExp(`^(${NAME})/(${NAME})$`);

/**
 * Accepts the two forms people naturally paste:
 *   - https://github.com/owner/repo/pull/123 (also works for GitHub Enterprise hosts)
 *   - owner/repo#123
 */
export function parsePullRequestRef(input: string): PullRequestRef {
  const value = input.trim();
  const match = URL_PATTERN.exec(value) ?? SHORT_PATTERN.exec(value);
  if (!match) {
    throw new DevflowError(
      'INVALID_INPUT',
      `"${input}" is not a pull request reference. Use a URL like https://github.com/owner/repo/pull/123 or the short form owner/repo#123.`,
    );
  }
  const [, owner = '', repo = '', num = ''] = match;
  return { owner, repo, number: Number(num) };
}

export function parseRepoRef(input: string): RepoRef {
  const match = REPO_PATTERN.exec(input.trim());
  if (!match) {
    throw new DevflowError('INVALID_INPUT', `"${input}" is not a repository. Use owner/repo.`);
  }
  const [, owner = '', repo = ''] = match;
  return { owner, repo };
}

export function formatPullRequestRef(ref: PullRequestRef): string {
  return `${ref.owner}/${ref.repo}#${ref.number}`;
}
