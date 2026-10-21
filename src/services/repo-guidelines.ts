import type { GitHubClient } from '../clients/github.js';
import type { RepoRef } from '../lib/pr-ref.js';

/** Where GitHub itself looks for these files, in GitHub's priority order. */
const CONTRIBUTING_PATHS = ['.github/CONTRIBUTING.md', 'CONTRIBUTING.md', 'docs/CONTRIBUTING.md'];
const PR_TEMPLATE_PATHS = [
  '.github/pull_request_template.md',
  '.github/PULL_REQUEST_TEMPLATE.md',
  'pull_request_template.md',
  'PULL_REQUEST_TEMPLATE.md',
  'docs/pull_request_template.md',
  'docs/PULL_REQUEST_TEMPLATE.md',
];

/** Roughly 2k tokens per document: enough for real guidelines, bounded for the context window. */
export const MAX_GUIDELINE_CHARS = 8000;

export interface GuidelineDoc {
  path: string;
  text: string;
  truncated: boolean;
}

export interface RepoGuidelines {
  repo: RepoRef;
  contributing: GuidelineDoc | null;
  prTemplate: GuidelineDoc | null;
}

/**
 * Finds a repository's CONTRIBUTING guide and pull-request template.
 *
 * All candidate paths are requested in parallel and the highest-priority hit wins. That costs a
 * few 404s but finishes in one round-trip; probing one path at a time would take up to nine.
 * See Decisions.md D33.
 */
export async function getRepoGuidelines(
  github: GitHubClient,
  repo: RepoRef,
): Promise<RepoGuidelines> {
  const [contributing, prTemplate] = await Promise.all([
    firstExisting(github, repo, CONTRIBUTING_PATHS),
    firstExisting(github, repo, PR_TEMPLATE_PATHS),
  ]);
  return { repo, contributing, prTemplate };
}

async function firstExisting(
  github: GitHubClient,
  repo: RepoRef,
  paths: readonly string[],
): Promise<GuidelineDoc | null> {
  const texts = await Promise.all(paths.map((path) => github.getFileText(repo, path)));
  const index = texts.findIndex((text) => text !== null);
  const text = texts[index];
  const path = paths[index];
  if (text === undefined || text === null || path === undefined) return null;
  const truncated = text.length > MAX_GUIDELINE_CHARS;
  return { path, text: truncated ? text.slice(0, MAX_GUIDELINE_CHARS) : text, truncated };
}

/** Renders guidelines as one Markdown document, with the source path of each part. */
export function renderGuidelines(guidelines: RepoGuidelines): string {
  const { owner, repo } = guidelines.repo;
  const parts = [`# Contribution guidelines for ${owner}/${repo}`];

  if (!guidelines.contributing && !guidelines.prTemplate) {
    parts.push(
      'No CONTRIBUTING guide or pull-request template was found (or the repository is not ' +
        'accessible with this token). Fall back to general good practice.',
    );
    return parts.join('\n\n');
  }

  const section = (heading: string, doc: GuidelineDoc | null) =>
    doc
      ? `## ${heading}\n\n_Source: \`${doc.path}\`${doc.truncated ? ' (truncated)' : ''}_\n\n${doc.text.trim()}`
      : `## ${heading}\n\n_Not found._`;

  parts.push(
    section('Contributing guide', guidelines.contributing),
    section('Pull request template', guidelines.prTemplate),
  );
  return parts.join('\n\n');
}
