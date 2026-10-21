import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createSilentLogger } from '../../src/lib/logger.js';
import { findPackageRoot } from '../../src/lib/package-root.js';
import { getActivity } from '../../src/services/activity.js';
import { ChecklistStore } from '../../src/services/checklists.js';
import { getPrDiff } from '../../src/services/pr-diff.js';
import {
  classify,
  generateReleaseNotes,
  MAX_RELEASE_PRS,
} from '../../src/services/release-notes.js';
import {
  getRepoGuidelines,
  MAX_GUIDELINE_CHARS,
  renderGuidelines,
} from '../../src/services/repo-guidelines.js';
import { ReviewQueueSuggestions } from '../../src/services/suggestions.js';
import {
  FakeGitHubClient,
  makeFile,
  makePr,
  makeReviewItem,
  makeSearchItem,
} from '../helpers/fixtures.js';

const REF = { owner: 'acme', repo: 'web', number: 42 };
const REPO = { owner: 'acme', repo: 'web' };
const BUNDLED_DIR = join(findPackageRoot(import.meta.url), 'checklists');

describe('ChecklistStore', () => {
  it('lists the bundled checklists with titles and descriptions, ignoring README', async () => {
    const list = await new ChecklistStore(BUNDLED_DIR).list();
    expect(list.map((c) => c.name)).toEqual(['general', 'node', 'react', 'security']);
    for (const checklist of list) {
      expect(checklist.title.length).toBeGreaterThan(3);
      expect(checklist.description.length).toBeGreaterThan(10);
    }
  });

  it('reads a checklist with its full content', async () => {
    const react = await new ChecklistStore(BUNDLED_DIR).read('react');
    expect(react.title).toBe('React review');
    expect(react.content).toContain('- [ ]');
  });

  it.each(['../secrets', 'React', 'a/b', '', '.hidden'])(
    'rejects unsafe name %j before touching the file system',
    async (name) => {
      await expect(new ChecklistStore(BUNDLED_DIR).read(name)).rejects.toMatchObject({
        code: 'INVALID_INPUT',
      });
    },
  );

  it('reports NOT_FOUND with the available names', async () => {
    await expect(new ChecklistStore(BUNDLED_DIR).read('python')).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: expect.stringContaining('general, node, react, security'),
    });
  });

  it('treats a missing folder as empty and falls back to the file name as title', async () => {
    expect(await new ChecklistStore('/definitely/not/here').list()).toEqual([]);
    const dir = await mkdtemp(join(tmpdir(), 'devflow-checklists-'));
    await writeFile(join(dir, 'team.md'), '- [ ] item without header\n');
    await writeFile(join(dir, 'Bad Name.md'), '# ignored\n');
    expect(await new ChecklistStore(dir).list()).toEqual([
      { name: 'team', title: 'team', description: '' },
    ]);
  });
});

describe('getPrDiff', () => {
  function setup() {
    return new FakeGitHubClient().addPr(makePr(), [
      { ...makeFile('src/a.ts', 5), patch: '@@ a\n+one' },
      { ...makeFile('package-lock.json', 900), patch: '@@ lock\n+x' },
      makeFile('assets/logo.png', 0), // binary: GitHub sends no patch
      { ...makeFile('src/big.ts', 400), patch: 'x'.repeat(5000) },
    ]);
  }

  it('returns patches in order, skipping generated and patch-less files', async () => {
    const diff = await getPrDiff(setup(), REF, { maxChars: 100_000 });
    expect(diff.files.map((f) => f.path)).toEqual(['src/a.ts', 'src/big.ts']);
    expect(diff.omitted).toEqual([
      { path: 'package-lock.json', reason: 'generated' },
      { path: 'assets/logo.png', reason: 'no-patch' },
    ]);
    expect(diff.totalChars).toBe(9 + 5000);
  });

  it('honours explicit paths and globs, including generated files, and reports misses', async () => {
    const diff = await getPrDiff(setup(), REF, {
      paths: ['package-lock.json', 'src/*.ts', 'src/missing.ts'],
      maxChars: 100_000,
    });
    expect(diff.files.map((f) => f.path)).toEqual(['src/a.ts', 'package-lock.json', 'src/big.ts']);
    expect(diff.unmatchedPaths).toEqual(['src/missing.ts']);
  });

  it('truncates the last patch to the budget, or omits it if too little room is left', async () => {
    const truncated = await getPrDiff(setup(), REF, { maxChars: 1010 });
    expect(truncated.files[1]).toMatchObject({ path: 'src/big.ts', patchTruncated: true });
    expect(truncated.totalChars).toBe(1010);

    const omitted = await getPrDiff(setup(), REF, { maxChars: 100 });
    expect(omitted.files.map((f) => f.path)).toEqual(['src/a.ts']);
    expect(omitted.omitted).toContainEqual({ path: 'src/big.ts', reason: 'budget' });
  });
});

describe('getActivity', () => {
  it('runs the four searches over the window and assembles the result', async () => {
    const github = new FakeGitHubClient();
    github.reviewRequests = { totalCount: 4, items: [] };
    github.prSearch = (params) =>
      params.qualifiers.some((q) => q.startsWith('merged:'))
        ? { totalCount: 1, items: [makeSearchItem(7)] }
        : { totalCount: 0, items: [] };

    const activity = await getActivity(github, {
      days: 3,
      perList: 20,
      repo: REPO,
      now: new Date('2026-10-20T09:30:00.123Z'),
    });

    expect(activity).toMatchObject({
      user: 'reviewer1',
      since: '2026-10-17T09:30:00Z',
      days: 3,
      merged: { totalCount: 1 },
      inProgress: { totalCount: 0 },
      reviewed: { totalCount: 0 },
      pendingReviewRequests: 4,
    });
    expect(github.prSearchCalls.map((c) => c.qualifiers.join(' '))).toEqual([
      'is:pr author:reviewer1 merged:>=2026-10-17T09:30:00Z repo:acme/web',
      'is:pr author:reviewer1 is:open updated:>=2026-10-17T09:30:00Z repo:acme/web',
      'is:pr reviewed-by:reviewer1 -author:reviewer1 updated:>=2026-10-17T09:30:00Z repo:acme/web',
    ]);
    expect(github.searchCalls[0]).toMatchObject({ login: 'reviewer1', perPage: 1 });
  });

  it('reports on another user without looking up the token owner', async () => {
    const github = new FakeGitHubClient();
    const spy = vi.spyOn(github, 'getAuthenticatedLogin');
    const activity = await getActivity(github, { user: 'octocat', days: 1, perList: 5 });
    expect(activity.user).toBe('octocat');
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('release notes', () => {
  describe('classify', () => {
    it.each([
      [
        { title: 'feat(api): add search', labels: [], author: 'a' },
        'feat',
        'api',
        'Add search',
        false,
      ],
      [{ title: 'fix!: drop node 18', labels: [], author: 'a' }, 'fix', null, 'Drop node 18', true],
      [
        { title: 'chore: tidy', labels: ['breaking'], author: 'a' },
        'maintenance',
        null,
        'Tidy',
        true,
      ],
      [
        { title: 'Improve speed', labels: ['performance'], author: 'a' },
        'perf',
        null,
        'Improve speed',
        false,
      ],
      [
        { title: 'Bump x from 1 to 2', labels: [], author: 'dependabot[bot]' },
        'deps',
        null,
        'Bump x from 1 to 2',
        false,
      ],
      [
        { title: 'wip: something', labels: [], author: 'a' },
        'other',
        null,
        'Wip: something',
        false,
      ],
      [{ title: 'misc tweaks', labels: ['Bug'], author: 'a' }, 'fix', null, 'Misc tweaks', false],
    ])('%o → %s', (pr, type, scope, subject, breaking) => {
      expect(classify(pr)).toEqual({ type, scope, subject, breaking });
    });
  });

  function setupRelease() {
    const github = new FakeGitHubClient();
    github.commits.set('acme/web@v1.0.0', { sha: 'aaa', date: '2026-10-01T00:00:00Z' });
    github.commits.set('acme/web@v1.1.0', { sha: 'bbb', date: '2026-10-10T00:00:00Z' });
    github.prSearch = () => ({
      totalCount: 4,
      items: [
        makeSearchItem(3, {
          title: 'fix: crash on empty list',
          mergedAt: '2026-10-04T00:00:00Z',
          author: 'bob',
        }),
        makeSearchItem(1, {
          title: 'feat(ui)!: new dashboard',
          mergedAt: '2026-10-02T00:00:00Z',
          author: 'amy',
        }),
        makeSearchItem(4, {
          title: 'Bump lodash',
          mergedAt: '2026-10-05T00:00:00Z',
          author: 'dependabot[bot]',
        }),
        makeSearchItem(2, {
          title: 'feat: export CSV',
          mergedAt: '2026-10-03T00:00:00Z',
          author: 'amy',
        }),
      ],
    });
    return github;
  }

  it('resolves refs to a merge window and groups, orders and renders the PRs', async () => {
    const github = setupRelease();
    const notes = await generateReleaseNotes(github, {
      repo: REPO,
      from: 'v1.0.0',
      to: 'v1.1.0',
      base: 'main',
      limit: 100,
    });

    expect(github.prSearchCalls[0]?.qualifiers).toEqual([
      'is:pr',
      'is:merged',
      'repo:acme/web',
      'merged:2026-10-01T00:00:01Z..2026-10-10T00:00:00Z',
      'base:main',
    ]);
    expect(notes.from).toEqual({ input: 'v1.0.0', date: '2026-10-01T00:00:00.000Z', sha: 'aaa' });
    expect(notes.sections.map((s) => [s.type, s.items.map((i) => i.number)])).toEqual([
      ['feat', [1, 2]],
      ['fix', [3]],
      ['deps', [4]],
    ]);
    expect(notes.breakingChanges.map((i) => i.number)).toEqual([1]);
    expect(notes.contributors).toEqual(['amy', 'bob']);
    expect(notes.truncated).toBe(false);
    expect(notes.markdown).toContain('## acme/web: v1.0.0 → v1.1.0');
    expect(notes.markdown).toContain('### ⚠️ Breaking changes');
    expect(notes.markdown).toContain(
      '- **ui:** New dashboard ([#1](https://github.com/acme/web/pull/1)) by @amy',
    );
    expect(notes.markdown.indexOf('### Features')).toBeLessThan(
      notes.markdown.indexOf('### Bug fixes'),
    );
  });

  it('accepts dates, defaults "to" to now, and reports truncation', async () => {
    const github = setupRelease();
    const notes = await generateReleaseNotes(github, {
      repo: REPO,
      from: '2026-10-01',
      limit: 2,
      now: new Date('2026-10-20T00:00:00Z'),
    });
    expect(notes.to.input).toBe('now');
    expect(github.prSearchCalls[0]?.perPage).toBe(2);
    expect(notes.truncated).toBe(true);
    expect(notes.markdown).toContain('_Showing 2 of 4 pull requests._');
  });

  it('pages through results up to the limit', async () => {
    const github = new FakeGitHubClient();
    github.prSearch = ({ page, perPage }) => ({
      totalCount: 250,
      items: Array.from({ length: perPage }, (_, i) =>
        makeSearchItem((page - 1) * perPage + i + 1),
      ),
    });
    const notes = await generateReleaseNotes(github, {
      repo: REPO,
      from: '2026-01-01',
      limit: 250,
      now: new Date('2026-10-20T00:00:00Z'),
    });
    expect(github.prSearchCalls.map((c) => c.page)).toEqual([1, 2, 3]);
    expect(notes.sections.flatMap((s) => s.items)).toHaveLength(250);
    expect(MAX_RELEASE_PRS).toBe(300);
  });

  it('rejects an empty or inverted range and unknown refs', async () => {
    const github = setupRelease();
    await expect(
      generateReleaseNotes(github, { repo: REPO, from: 'v1.1.0', to: 'v1.0.0', limit: 10 }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(
      generateReleaseNotes(github, { repo: REPO, from: 'v9', limit: 10 }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      generateReleaseNotes(github, { repo: REPO, from: '2026-13-45', limit: 10 }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('renders an empty range clearly', async () => {
    const notes = await generateReleaseNotes(new FakeGitHubClient(), {
      repo: REPO,
      from: '2026-10-01',
      to: '2026-10-02',
      limit: 10,
    });
    expect(notes.markdown).toContain('No pull requests were merged in this range.');
  });
});

describe('repo guidelines', () => {
  it('picks the highest-priority existing file and truncates long ones', async () => {
    const github = new FakeGitHubClient();
    github.fileTexts.set('acme/web:CONTRIBUTING.md', 'root guide');
    github.fileTexts.set('acme/web:.github/CONTRIBUTING.md', 'github-folder guide');
    github.fileTexts.set('acme/web:.github/PULL_REQUEST_TEMPLATE.md', 'y'.repeat(9000));

    const guidelines = await getRepoGuidelines(github, REPO);
    expect(guidelines.contributing).toEqual({
      path: '.github/CONTRIBUTING.md',
      text: 'github-folder guide',
      truncated: false,
    });
    expect(guidelines.prTemplate?.truncated).toBe(true);
    expect(guidelines.prTemplate?.text).toHaveLength(MAX_GUIDELINE_CHARS);

    const markdown = renderGuidelines(guidelines);
    expect(markdown).toContain('_Source: `.github/CONTRIBUTING.md`_');
    expect(markdown).toContain('(truncated)');
  });

  it('explains when nothing was found', async () => {
    const markdown = renderGuidelines(await getRepoGuidelines(new FakeGitHubClient(), REPO));
    expect(markdown).toContain('No CONTRIBUTING guide or pull-request template was found');

    const github = new FakeGitHubClient();
    github.fileTexts.set('acme/web:CONTRIBUTING.md', 'guide');
    expect(renderGuidelines(await getRepoGuidelines(github, REPO))).toContain('_Not found._');
  });
});

describe('ReviewQueueSuggestions', () => {
  function setup() {
    const github = new FakeGitHubClient();
    github.reviewRequests = {
      totalCount: 2,
      items: [
        makeReviewItem(1, '2026-10-01T00:00:00Z'),
        makeReviewItem(22, '2026-10-02T00:00:00Z'),
      ],
    };
    let clock = 0;
    const suggestions = new ReviewQueueSuggestions(github, createSilentLogger(), 1000, () => clock);
    return { github, suggestions, tick: (ms: number) => (clock += ms) };
  }

  it('filters cached refs by substring and refreshes after the TTL', async () => {
    const { github, suggestions, tick } = setup();
    expect(await suggestions.suggest('')).toEqual(['acme/web#1', 'acme/web#22']);
    expect(await suggestions.suggest('#2')).toEqual(['acme/web#22']);
    expect(github.searchCalls).toHaveLength(1);
    tick(1001);
    await suggestions.suggest('');
    expect(github.searchCalls).toHaveLength(2);
  });

  it('shares one request between concurrent keystrokes and offers nothing on failure', async () => {
    const { github, suggestions } = setup();
    await Promise.all([suggestions.suggest('a'), suggestions.suggest('ac')]);
    expect(github.searchCalls).toHaveLength(1);

    const failing = new FakeGitHubClient();
    failing.searchReviewRequests = () => Promise.reject(new Error('offline'));
    const empty = new ReviewQueueSuggestions(failing, createSilentLogger());
    expect(await empty.suggest('')).toEqual([]);
  });
});
