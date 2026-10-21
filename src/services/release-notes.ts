import type { GitHubClient, PullRequestSearchItem } from '../clients/github.js';
import { DevflowError } from '../lib/errors.js';
import type { RepoRef } from '../lib/pr-ref.js';

/** Sections in the order they appear in the notes: what users care about most comes first. */
export const SECTIONS = [
  { type: 'feat', title: 'Features' },
  { type: 'fix', title: 'Bug fixes' },
  { type: 'perf', title: 'Performance' },
  { type: 'docs', title: 'Documentation' },
  { type: 'deps', title: 'Dependencies' },
  { type: 'maintenance', title: 'Maintenance' },
  { type: 'revert', title: 'Reverts' },
  { type: 'other', title: 'Other changes' },
] as const;

export type ChangeType = (typeof SECTIONS)[number]['type'];

/** Conventional-commit types (https://www.conventionalcommits.org) → our sections. */
const CONVENTIONAL_TYPES: Record<string, ChangeType> = {
  feat: 'feat',
  feature: 'feat',
  fix: 'fix',
  bugfix: 'fix',
  perf: 'perf',
  docs: 'docs',
  deps: 'deps',
  revert: 'revert',
  refactor: 'maintenance',
  chore: 'maintenance',
  build: 'maintenance',
  ci: 'maintenance',
  test: 'maintenance',
  style: 'maintenance',
};

/** Common GitHub label names → our sections, used when the title has no conventional prefix. */
const LABEL_TYPES: Record<string, ChangeType> = {
  feature: 'feat',
  enhancement: 'feat',
  feat: 'feat',
  bug: 'fix',
  fix: 'fix',
  bugfix: 'fix',
  performance: 'perf',
  perf: 'perf',
  documentation: 'docs',
  docs: 'docs',
  dependencies: 'deps',
  deps: 'deps',
  refactor: 'maintenance',
  chore: 'maintenance',
  maintenance: 'maintenance',
  ci: 'maintenance',
  tests: 'maintenance',
  test: 'maintenance',
};

const BREAKING_LABELS = new Set(['breaking', 'breaking change', 'breaking-change', 'semver-major']);
const DEPENDENCY_BOTS = new Set(['dependabot[bot]', 'renovate[bot]']);

// "feat(api)!: add thing" → type "feat", scope "api", breaking "!", subject "add thing"
const CONVENTIONAL_TITLE = /^(\w+)(?:\(([^)]+)\))?(!)?:\s*(.+)$/;
const DATE_INPUT =
  /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

/** GitHub search caps results at 1000; we stop well before that. */
export const MAX_RELEASE_PRS = 300;

export interface ReleaseNoteItem {
  number: number;
  /** Title without the conventional prefix, first letter capitalised. */
  title: string;
  scope: string | null;
  author: string;
  url: string;
  mergedAt: string | null;
  labels: string[];
  breaking: boolean;
}

export interface ReleaseNoteSection {
  type: ChangeType;
  title: string;
  items: ReleaseNoteItem[];
}

export interface RangeBound {
  /** What the caller passed: a tag, branch, SHA or date. */
  input: string;
  /** The resolved instant (ISO 8601). */
  date: string;
  /** Present when the input was resolved through git. */
  sha?: string;
}

export interface ReleaseNotes {
  repo: RepoRef;
  from: RangeBound;
  to: RangeBound;
  base: string | null;
  totalCount: number;
  /** True when more PRs matched than `limit` allowed us to include. */
  truncated: boolean;
  breakingChanges: ReleaseNoteItem[];
  sections: ReleaseNoteSection[];
  contributors: string[];
  /** Ready-to-paste Markdown rendering of everything above. */
  markdown: string;
}

export interface ReleaseNotesOptions {
  repo: RepoRef;
  from: string;
  /** Defaults to now. */
  to?: string;
  /** Only PRs merged into this branch (e.g. main). Omit for any branch. */
  base?: string;
  limit: number;
  now?: Date;
}

export function classify(pr: Pick<PullRequestSearchItem, 'title' | 'labels' | 'author'>): {
  type: ChangeType;
  scope: string | null;
  subject: string;
  breaking: boolean;
} {
  const labels = pr.labels.map((label) => label.toLowerCase());
  const labelBreaking = labels.some((label) => BREAKING_LABELS.has(label));
  const match = CONVENTIONAL_TITLE.exec(pr.title.trim());
  const conventionalType = match ? CONVENTIONAL_TYPES[(match[1] ?? '').toLowerCase()] : undefined;

  // Precedence: an explicit conventional prefix is the author's own statement of intent, so it
  // beats labels; labels beat guessing; a dependency bot is a strong signal on its own.
  if (match && conventionalType) {
    return {
      type: conventionalType,
      scope: match[2] ?? null,
      subject: capitalise(match[4] ?? pr.title),
      breaking: match[3] === '!' || labelBreaking,
    };
  }
  const labelType = labels.map((label) => LABEL_TYPES[label]).find(Boolean);
  const type = labelType ?? (DEPENDENCY_BOTS.has(pr.author) ? 'deps' : 'other');
  return { type, scope: null, subject: capitalise(pr.title.trim()), breaking: labelBreaking };
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** GitHub search wants second-precision UTC timestamps. */
function toSearchTimestamp(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

async function resolveBound(
  github: GitHubClient,
  repo: RepoRef,
  input: string,
): Promise<RangeBound> {
  if (DATE_INPUT.test(input)) {
    const date = new Date(input);
    if (Number.isNaN(date.getTime())) {
      throw new DevflowError('INVALID_INPUT', `"${input}" is not a valid date.`);
    }
    return { input, date: date.toISOString() };
  }
  const commit = await github.getCommit(repo, input);
  return { input, date: new Date(commit.date).toISOString(), sha: commit.sha };
}

/**
 * Builds release notes from pull requests merged between two points in history.
 *
 * The range is a merge-time window (from a tag/branch/SHA's commit date, or a plain date) rather
 * than an exact git ancestry walk. It needs 1–3 searches instead of one API call per commit, and
 * matches how teams think about releases. The cost is edge-case imprecision, e.g. PRs merged into
 * another branch in the same window; `base` narrows that. See Decisions.md D29.
 */
export async function generateReleaseNotes(
  github: GitHubClient,
  options: ReleaseNotesOptions,
): Promise<ReleaseNotes> {
  const { repo } = options;
  const now = options.now ?? new Date();
  const [from, to] = await Promise.all([
    resolveBound(github, repo, options.from),
    options.to
      ? resolveBound(github, repo, options.to)
      : Promise.resolve<RangeBound>({ input: 'now', date: now.toISOString() }),
  ]);
  if (new Date(from.date) >= new Date(to.date)) {
    throw new DevflowError(
      'INVALID_INPUT',
      `"from" (${from.input}, ${from.date}) must be earlier than "to" (${to.input}, ${to.date}).`,
    );
  }

  // Start one second after `from`: the commit `from` points at is already in the previous release.
  const windowStart = toSearchTimestamp(new Date(new Date(from.date).getTime() + 1000));
  const windowEnd = toSearchTimestamp(new Date(to.date));
  const qualifiers = [
    'is:pr',
    'is:merged',
    `repo:${repo.owner}/${repo.repo}`,
    `merged:${windowStart}..${windowEnd}`,
    ...(options.base ? [`base:${options.base}`] : []),
  ];

  const limit = Math.min(options.limit, MAX_RELEASE_PRS);
  const perPage = Math.min(limit, 100);
  const prs: PullRequestSearchItem[] = [];
  let totalCount = 0;
  for (let page = 1; prs.length < limit; page++) {
    const result = await github.searchPullRequests({
      qualifiers,
      sort: 'updated',
      order: 'desc',
      page,
      perPage,
    });
    totalCount = result.totalCount;
    prs.push(...result.items);
    if (result.items.length < perPage || page * perPage >= totalCount) break;
  }
  const included = prs.slice(0, limit);

  // Search cannot sort by merge time, so order chronologically here.
  included.sort((a, b) => (a.mergedAt ?? '').localeCompare(b.mergedAt ?? ''));

  const grouped = new Map<ChangeType, ReleaseNoteItem[]>();
  const breakingChanges: ReleaseNoteItem[] = [];
  for (const pr of included) {
    const { type, scope, subject, breaking } = classify(pr);
    const item: ReleaseNoteItem = {
      number: pr.ref.number,
      title: subject,
      scope,
      author: pr.author,
      url: pr.url,
      mergedAt: pr.mergedAt,
      labels: pr.labels,
      breaking,
    };
    if (breaking) breakingChanges.push(item);
    grouped.set(type, [...(grouped.get(type) ?? []), item]);
  }

  const sections = SECTIONS.filter(({ type }) => grouped.has(type)).map(({ type, title }) => ({
    type,
    title,
    items: grouped.get(type) ?? [],
  }));
  const contributors = [
    ...new Set(included.map((pr) => pr.author).filter((author) => !author.endsWith('[bot]'))),
  ].sort((a, b) => a.localeCompare(b));

  const notes: Omit<ReleaseNotes, 'markdown'> = {
    repo,
    from,
    to,
    base: options.base ?? null,
    totalCount,
    truncated: totalCount > included.length,
    breakingChanges,
    sections,
    contributors,
  };
  return { ...notes, markdown: renderReleaseNotes(notes) };
}

export function renderReleaseNotes(notes: Omit<ReleaseNotes, 'markdown'>): string {
  const day = (iso: string) => iso.slice(0, 10);
  const line = (item: ReleaseNoteItem) =>
    `- ${item.scope ? `**${item.scope}:** ` : ''}${item.title} ([#${item.number}](${item.url})) by @${item.author}`;

  const count = notes.sections.reduce((sum, section) => sum + section.items.length, 0);
  const out = [
    `## ${notes.repo.owner}/${notes.repo.repo}: ${notes.from.input} → ${notes.to.input}`,
    `_${count} pull request${count === 1 ? '' : 's'} merged between ${day(notes.from.date)} and ${day(notes.to.date)}${notes.base ? ` into \`${notes.base}\`` : ''}._`,
  ];
  if (count === 0) {
    out.push('No pull requests were merged in this range.');
    return out.join('\n\n');
  }
  if (notes.breakingChanges.length > 0) {
    out.push(`### ⚠️ Breaking changes\n\n${notes.breakingChanges.map(line).join('\n')}`);
  }
  for (const section of notes.sections) {
    out.push(`### ${section.title}\n\n${section.items.map(line).join('\n')}`);
  }
  if (notes.contributors.length > 0) {
    out.push(`### Contributors\n\n${notes.contributors.map((name) => `@${name}`).join(', ')}`);
  }
  if (notes.truncated) {
    out.push(`_Showing ${count} of ${notes.totalCount} pull requests._`);
  }
  return out.join('\n\n');
}
