import type { FileStatus, GitHubClient } from '../clients/github.js';
import { createPathMatcher } from '../lib/glob.js';
import type { PullRequestRef } from '../lib/pr-ref.js';
import { isGenerated } from './file-classifier.js';

/** GitHub's own cap on the PR file list; also the most we will scan for matching paths. */
const MAX_FILES_SCANNED = 3000;

/** A partial patch shorter than this is not worth sending; skip the file instead. */
const MIN_USEFUL_PATCH_CHARS = 400;

export type OmittedReason = 'generated' | 'no-patch' | 'budget';

export interface DiffFile {
  path: string;
  status: FileStatus;
  additions: number;
  deletions: number;
  patch: string;
  /** True when the patch was cut to fit the character budget. */
  patchTruncated: boolean;
}

export interface PrDiff {
  files: DiffFile[];
  /** Files that matched but whose patch is not included, and why. */
  omitted: { path: string; reason: OmittedReason }[];
  totalChars: number;
  /** Paths that matched nothing in the PR, so the model can correct a typo. */
  unmatchedPaths: string[];
}

export interface PrDiffOptions {
  /** Exact paths or globs. Omit to take files in GitHub's order until the budget runs out. */
  paths?: readonly string[];
  maxChars: number;
}

/**
 * Returns unified-diff patches for a PR within a character budget.
 *
 * The budget exists because a full diff can be megabytes: models read best when given the files
 * that matter, and analyze_pr_risk's focusFiles says which those are. Generated files (lockfiles,
 * snapshots, build output) are skipped unless asked for by name. See Decisions.md D25.
 */
export async function getPrDiff(
  github: GitHubClient,
  ref: PullRequestRef,
  options: PrDiffOptions,
): Promise<PrDiff> {
  const { files } = await github.listPullRequestFiles(ref, MAX_FILES_SCANNED, {
    includePatch: true,
  });

  const requested = options.paths ?? [];
  const matchers = requested.map((pattern) => ({
    pattern,
    matches: createPathMatcher([pattern]),
  }));
  const selected =
    matchers.length === 0
      ? files
      : files.filter((file) => matchers.some(({ matches }) => matches(file.path)));
  const unmatchedPaths = matchers
    .filter(({ matches }) => !files.some((file) => matches(file.path)))
    .map(({ pattern }) => pattern);

  const result: PrDiff = { files: [], omitted: [], totalChars: 0, unmatchedPaths };
  for (const file of selected) {
    // Generated files are noise when browsing, but honour an explicit request for them.
    if (matchers.length === 0 && isGenerated(file.path)) {
      result.omitted.push({ path: file.path, reason: 'generated' });
      continue;
    }
    if (!file.patch) {
      result.omitted.push({ path: file.path, reason: 'no-patch' });
      continue;
    }

    const remaining = options.maxChars - result.totalChars;
    const fits = file.patch.length <= remaining;
    if (!fits && remaining < MIN_USEFUL_PATCH_CHARS) {
      result.omitted.push({ path: file.path, reason: 'budget' });
      continue;
    }
    const patch = fits ? file.patch : file.patch.slice(0, remaining);
    result.files.push({
      path: file.path,
      status: file.status,
      additions: file.additions,
      deletions: file.deletions,
      patch,
      patchTruncated: !fits,
    });
    result.totalChars += patch.length;
  }
  return result;
}
