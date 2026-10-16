import type { ChangedFile, CheckSummary, PullRequestInfo } from '../clients/github.js';
import { createPathMatcher } from '../lib/glob.js';
import {
  isGenerated,
  isLockfile,
  isManifest,
  isSourceFile,
  isTestFile,
} from './file-classifier.js';

/** Paths where a mistake tends to be expensive. Extend via DEVFLOW_SENSITIVE_PATHS. */
export const DEFAULT_SENSITIVE_PATHS = [
  '**/auth/**',
  '**/authentication/**',
  '**/security/**',
  '**/permissions/**',
  '**/*secret*',
  '**/*credential*',
  '**/.env*',
  '**/migrations/**',
  '.github/workflows/**',
  'Dockerfile',
  '**/*.tf',
  '**/k8s/**',
  '**/helm/**',
] as const;

/**
 * Size thresholds follow widely cited code-review research (e.g. the SmartBear/Cisco study):
 * reviewers find defects reliably up to roughly 200–400 lines; beyond that, effectiveness drops.
 * All values are starting points to calibrate against real team PRs (Sub-goal 3).
 */
export const THRESHOLDS = {
  largeChangeLines: 400,
  veryLargeChangeLines: 1000,
  manyFiles: 20,
  veryManyFiles: 50,
  largeFileLines: 500,
  minDescriptionLength: 30,
  maxListedFiles: 10,
} as const;

export type Severity = 'info' | 'low' | 'medium' | 'high';
export type RiskLevel = 'low' | 'medium' | 'high';

export type SignalId =
  | 'LARGE_CHANGE'
  | 'MANY_FILES'
  | 'NO_TEST_CHANGES'
  | 'SENSITIVE_PATHS'
  | 'DEPENDENCY_CHANGES'
  | 'LOCKFILE_WITHOUT_MANIFEST'
  | 'LARGE_FILE_CHANGES'
  | 'MISSING_DESCRIPTION'
  | 'CI_FAILING'
  | 'CI_PENDING'
  | 'DRAFT'
  | 'PARTIAL_FILE_LIST';

export interface RiskSignal {
  id: SignalId;
  severity: Severity;
  /** Contribution to the 0–100 score. */
  weight: number;
  message: string;
  files?: string[];
}

export interface RiskStats {
  totalFiles: number;
  sourceFiles: number;
  testFiles: number;
  generatedFiles: number;
  /** additions + deletions, excluding lockfiles and generated files. */
  reviewableLines: number;
}

export interface RiskReport {
  score: number;
  level: RiskLevel;
  signals: RiskSignal[];
  stats: RiskStats;
  /** Largest changed source files — a suggested reading order for the reviewer. */
  focusFiles: string[];
}

export interface RiskInput {
  pr: Pick<PullRequestInfo, 'body' | 'draft'>;
  files: ChangedFile[];
  filesTruncated: boolean;
  checks: CheckSummary | null;
}

export interface RiskOptions {
  extraSensitivePaths?: readonly string[];
}

const changed = (file: ChangedFile) => file.additions + file.deletions;

function listFiles(files: ChangedFile[]): string[] {
  return files.slice(0, THRESHOLDS.maxListedFiles).map((file) => file.path);
}

/**
 * Pure, deterministic heuristics over PR metadata. No API calls, so it is fast and easy to test.
 * Each signal explains itself; the score is just the capped sum of signal weights.
 *
 * Weights are balanced so that:
 *   - one strong concern alone (sensitive path 25, failing CI 25, very large 30) → medium
 *   - two strong concerns together (≥ 50) → high
 *   - hygiene issues alone (short description 10, lockfile-only 5) → stay low
 *   - info signals (weight 0) add context for the model without moving the score.
 * Why heuristics instead of asking an LLM: see Decisions.md D12.
 */
export function analyzeRisk(input: RiskInput, options: RiskOptions = {}): RiskReport {
  const { pr, files, checks } = input;
  const signals: RiskSignal[] = [];

  const sourceFiles = files.filter((file) => isSourceFile(file.path));
  const testFiles = files.filter((file) => isTestFile(file.path));
  const generatedFiles = files.filter((file) => isGenerated(file.path));
  // Lockfiles and generated files are excluded: a 5,000-line package-lock.json diff is not
  // 5,000 lines anyone actually reviews.
  const reviewable = files.filter((file) => !isGenerated(file.path));
  const reviewableLines = reviewable.reduce((sum, file) => sum + changed(file), 0);

  // --- Size -----------------------------------------------------------------
  if (reviewableLines > THRESHOLDS.veryLargeChangeLines) {
    signals.push({
      id: 'LARGE_CHANGE',
      severity: 'high',
      weight: 30,
      message: `${reviewableLines} reviewable lines changed. PRs over ${THRESHOLDS.veryLargeChangeLines} lines are hard to review thoroughly; consider splitting.`,
    });
  } else if (reviewableLines > THRESHOLDS.largeChangeLines) {
    signals.push({
      id: 'LARGE_CHANGE',
      severity: 'medium',
      weight: 15,
      message: `${reviewableLines} reviewable lines changed (above ${THRESHOLDS.largeChangeLines}).`,
    });
  }

  if (files.length > THRESHOLDS.veryManyFiles) {
    signals.push({
      id: 'MANY_FILES',
      severity: 'high',
      weight: 20,
      message: `${files.length} files changed.`,
    });
  } else if (files.length > THRESHOLDS.manyFiles) {
    signals.push({
      id: 'MANY_FILES',
      severity: 'medium',
      weight: 10,
      message: `${files.length} files changed.`,
    });
  }

  const largeFiles = sourceFiles.filter((file) => changed(file) > THRESHOLDS.largeFileLines);
  if (largeFiles.length > 0) {
    signals.push({
      id: 'LARGE_FILE_CHANGES',
      severity: 'low',
      weight: 5,
      message: `${largeFiles.length} source file(s) with more than ${THRESHOLDS.largeFileLines} changed lines.`,
      files: listFiles(largeFiles),
    });
  }

  // --- Tests ----------------------------------------------------------------
  // Only additions count: deleting code without touching tests is common and usually fine.
  const sourceAdditions = sourceFiles.reduce((sum, file) => sum + file.additions, 0);
  if (sourceAdditions > 0 && testFiles.length === 0) {
    signals.push({
      id: 'NO_TEST_CHANGES',
      severity: 'medium',
      weight: 20,
      message: `Production code changed (${sourceFiles.length} file(s), +${sourceAdditions} lines) but no test files were added or updated.`,
      files: listFiles(sourceFiles),
    });
  }

  // --- Sensitive areas --------------------------------------------------------
  const isSensitive = createPathMatcher([
    ...DEFAULT_SENSITIVE_PATHS,
    ...(options.extraSensitivePaths ?? []),
  ]);
  const sensitiveFiles = files.filter((file) => isSensitive(file.path));
  if (sensitiveFiles.length > 0) {
    signals.push({
      id: 'SENSITIVE_PATHS',
      severity: 'high',
      weight: 25,
      message: `Touches ${sensitiveFiles.length} file(s) in sensitive areas (auth, secrets, CI/CD, infra, migrations). Request a careful review.`,
      files: listFiles(sensitiveFiles),
    });
  }

  // --- Dependencies -----------------------------------------------------------
  const manifests = files.filter((file) => isManifest(file.path));
  const lockfiles = files.filter((file) => isLockfile(file.path));
  if (manifests.length > 0) {
    signals.push({
      id: 'DEPENDENCY_CHANGES',
      severity: 'medium',
      weight: 10,
      message:
        'Dependency manifest(s) changed. Check new packages for licence, maintenance and security.',
      files: listFiles(manifests),
    });
  } else if (lockfiles.length > 0) {
    // Only when no manifest changed: a manifest change already explains the lockfile.
    signals.push({
      id: 'LOCKFILE_WITHOUT_MANIFEST',
      severity: 'low',
      weight: 5,
      message: 'Lockfile changed without a manifest change. Confirm this was intentional.',
      files: listFiles(lockfiles),
    });
  }

  // --- Description ------------------------------------------------------------
  if (pr.body.trim().length < THRESHOLDS.minDescriptionLength) {
    signals.push({
      id: 'MISSING_DESCRIPTION',
      severity: 'low',
      weight: 10,
      message:
        'PR description is missing or very short. Reviewers lack context on intent and testing.',
    });
  }

  // --- CI -------------------------------------------------------------------
  if (checks?.state === 'failure') {
    signals.push({
      id: 'CI_FAILING',
      severity: 'high',
      weight: 25,
      message: `${checks.failed} CI check(s) failing: ${checks.failing.map((check) => check.name).join(', ')}.`,
    });
  } else if (checks?.state === 'pending') {
    signals.push({
      id: 'CI_PENDING',
      severity: 'info',
      weight: 0,
      message: `${checks.pending} CI check(s) still running.`,
    });
  }

  // --- Context notes ----------------------------------------------------------
  if (pr.draft) {
    signals.push({
      id: 'DRAFT',
      severity: 'info',
      weight: 0,
      message: 'PR is a draft; the author may still be working on it.',
    });
  }
  if (input.filesTruncated) {
    signals.push({
      id: 'PARTIAL_FILE_LIST',
      severity: 'info',
      weight: 0,
      message: 'Only part of the file list was analysed; the real risk may be higher.',
    });
  }

  const score = Math.min(
    100,
    signals.reduce((sum, signal) => sum + signal.weight, 0),
  );
  const level: RiskLevel = score >= 50 ? 'high' : score >= 20 ? 'medium' : 'low';

  // Biggest source changes first: that is where most of the review effort (and risk) usually is.
  const focusFiles = [...sourceFiles]
    .sort((a, b) => changed(b) - changed(a))
    .slice(0, 5)
    .map((file) => file.path);

  return {
    score,
    level,
    signals,
    stats: {
      totalFiles: files.length,
      sourceFiles: sourceFiles.length,
      testFiles: testFiles.length,
      generatedFiles: generatedFiles.length,
      reviewableLines,
    },
    focusFiles,
  };
}
