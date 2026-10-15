const CLOSING_KEYWORDS = 'close|closes|closed|fix|fixes|fixed|resolve|resolves|resolved';

// "Fixes #12", "closes acme/api#34", "Resolves https://github.com/acme/api/issues/56"
const LINKED_ISSUE_PATTERN = new RegExp(
  `\\b(?:${CLOSING_KEYWORDS}):?\\s+(?:(?:https?://[^/\\s]+/)?([\\w.-]+/[\\w.-]+)(?:/issues/|#)|#)(\\d+)`,
  'gi',
);

/**
 * Extracts issues a PR says it closes, using GitHub's closing keywords.
 * Returns references like "#12" (same repo) or "owner/repo#34", de-duplicated, in order.
 */
export function extractLinkedIssues(text: string): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(LINKED_ISSUE_PATTERN)) {
    const [, repo, number] = match;
    found.add(repo ? `${repo}#${number ?? ''}` : `#${number ?? ''}`);
  }
  return [...found];
}
