import { describe, expect, it } from 'vitest';
import type { ChangedFile } from '../../src/clients/github.js';
import {
  isGenerated,
  isLockfile,
  isManifest,
  isSourceFile,
  isTestFile,
} from '../../src/services/file-classifier.js';
import { analyzeRisk, type RiskInput } from '../../src/services/risk-analyzer.js';
import { makeChecks, makeFile } from '../helpers/fixtures.js';

const GOOD_BODY = 'This PR adds rate limiting to login. Tested locally and with unit tests.';

function input(files: ChangedFile[], overrides: Partial<RiskInput> = {}): RiskInput {
  return {
    pr: { body: GOOD_BODY, draft: false },
    files,
    filesTruncated: false,
    checks: makeChecks(),
    ...overrides,
  };
}

const ids = (report: ReturnType<typeof analyzeRisk>) => report.signals.map((signal) => signal.id);

describe('file classifier', () => {
  it.each([
    ['src/app.test.ts', true],
    ['src/__tests__/app.ts', true],
    ['pkg/handler_test.go', true],
    ['tests/test_api.py', true],
    ['src/main/java/FooTest.java', true],
    ['spec/models/user_spec.rb', true],
    ['src/app.ts', false],
  ])('isTestFile(%s) → %s', (path, expected) => {
    expect(isTestFile(path)).toBe(expected);
  });

  it.each([
    ['src/app.ts', true],
    ['api/handler.go', true],
    ['src/app.test.ts', false],
    ['src/types.d.ts', false],
    ['README.md', false],
    ['dist/bundle.js', false],
    ['Makefile', false],
  ])('isSourceFile(%s) → %s', (path, expected) => {
    expect(isSourceFile(path)).toBe(expected);
  });

  it('recognises lockfiles, manifests and generated files', () => {
    expect(isLockfile('apps/web/package-lock.json')).toBe(true);
    expect(isManifest('apps/web/package.json')).toBe(true);
    expect(isGenerated('yarn.lock')).toBe(true);
    expect(isGenerated('src/__snapshots__/a.snap')).toBe(true);
    expect(isGenerated('src/app.ts')).toBe(false);
  });
});

describe('analyzeRisk', () => {
  it('rates a small, tested, described PR as low risk with no signals', () => {
    const report = analyzeRisk(input([makeFile('src/a.ts', 20), makeFile('src/a.test.ts', 30)]));
    expect(report).toMatchObject({ score: 0, level: 'low', signals: [] });
    expect(report.stats).toEqual({
      totalFiles: 2,
      sourceFiles: 1,
      testFiles: 1,
      generatedFiles: 0,
      reviewableLines: 50,
    });
  });

  it('flags production changes without tests', () => {
    const report = analyzeRisk(input([makeFile('src/a.ts', 20)]));
    expect(ids(report)).toEqual(['NO_TEST_CHANGES']);
    expect(report.level).toBe('medium');
  });

  it('does not flag missing tests for pure deletions or docs', () => {
    const report = analyzeRisk(
      input([{ ...makeFile('src/old.ts', 0, 80), status: 'removed' }, makeFile('README.md', 40)]),
    );
    expect(ids(report)).not.toContain('NO_TEST_CHANGES');
  });

  it('grades size and ignores lockfiles when counting lines', () => {
    const medium = analyzeRisk(input([makeFile('src/a.ts', 450), makeFile('src/a.test.ts', 10)]));
    expect(medium.signals.find((s) => s.id === 'LARGE_CHANGE')?.severity).toBe('medium');

    const large = analyzeRisk(input([makeFile('src/a.ts', 1200), makeFile('src/a.test.ts', 10)]));
    expect(large.signals.find((s) => s.id === 'LARGE_CHANGE')?.severity).toBe('high');
    expect(ids(large)).toContain('LARGE_FILE_CHANGES');

    const lockfileOnly = analyzeRisk(input([makeFile('package-lock.json', 5000)]));
    expect(lockfileOnly.stats.reviewableLines).toBe(0);
    expect(ids(lockfileOnly)).toEqual(['LOCKFILE_WITHOUT_MANIFEST']);
  });

  it('grades file count', () => {
    const files = (n: number) => Array.from({ length: n }, (_, i) => makeFile(`docs/p${i}.md`, 1));
    expect(analyzeRisk(input(files(25))).signals[0]).toMatchObject({
      id: 'MANY_FILES',
      severity: 'medium',
    });
    expect(analyzeRisk(input(files(60))).signals[0]).toMatchObject({
      id: 'MANY_FILES',
      severity: 'high',
    });
  });

  it('flags sensitive paths, including user-configured ones', () => {
    const report = analyzeRisk(
      input([
        makeFile('.github/workflows/deploy.yml', 5),
        makeFile('src/payments/charge.test.ts', 5),
      ]),
      { extraSensitivePaths: ['src/payments/**'] },
    );
    const signal = report.signals.find((s) => s.id === 'SENSITIVE_PATHS');
    expect(signal?.files).toEqual(['.github/workflows/deploy.yml', 'src/payments/charge.test.ts']);
  });

  it('flags dependency manifest changes', () => {
    const report = analyzeRisk(
      input([makeFile('package.json', 2), makeFile('package-lock.json', 300)]),
    );
    expect(ids(report)).toEqual(['DEPENDENCY_CHANGES']);
  });

  it('flags a missing description', () => {
    const report = analyzeRisk(
      input([makeFile('README.md', 1)], { pr: { body: ' ', draft: false } }),
    );
    expect(ids(report)).toEqual(['MISSING_DESCRIPTION']);
  });

  it('flags failing CI and notes pending CI', () => {
    const failing = analyzeRisk(
      input([makeFile('README.md', 1)], {
        checks: makeChecks({
          state: 'failure',
          failed: 1,
          failing: [{ name: 'build', conclusion: 'failure' }],
        }),
      }),
    );
    expect(failing.signals[0]).toMatchObject({ id: 'CI_FAILING', severity: 'high' });
    expect(failing.signals[0]?.message).toContain('build');

    const pending = analyzeRisk(
      input([makeFile('README.md', 1)], { checks: makeChecks({ state: 'pending', pending: 2 }) }),
    );
    expect(pending.signals[0]).toMatchObject({ id: 'CI_PENDING', weight: 0 });
  });

  it('adds informational notes for drafts and truncated file lists', () => {
    const report = analyzeRisk(
      input([makeFile('README.md', 1)], {
        pr: { body: GOOD_BODY, draft: true },
        filesTruncated: true,
        checks: null,
      }),
    );
    expect(ids(report)).toEqual(['DRAFT', 'PARTIAL_FILE_LIST']);
    expect(report.score).toBe(0);
  });

  it('caps the score at 100, reports high level, and orders focus files by size', () => {
    const files = [
      makeFile('src/auth/session.ts', 900),
      makeFile('src/small.ts', 10),
      makeFile('src/medium.ts', 300),
      makeFile('package.json', 3),
      ...Array.from({ length: 60 }, (_, i) => makeFile(`docs/p${i}.md`, 1)),
    ];
    const report = analyzeRisk(
      input(files, {
        pr: { body: '', draft: false },
        checks: makeChecks({
          state: 'failure',
          failed: 1,
          failing: [{ name: 'ci', conclusion: 'failure' }],
        }),
      }),
    );
    expect(report.score).toBe(100);
    expect(report.level).toBe('high');
    expect(report.focusFiles).toEqual(['src/auth/session.ts', 'src/medium.ts', 'src/small.ts']);
  });
});
