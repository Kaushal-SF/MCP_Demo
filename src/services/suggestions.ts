import type { GitHubClient } from '../clients/github.js';
import type { Logger } from '../lib/logger.js';
import { formatPullRequestRef } from '../lib/pr-ref.js';

const MAX_SUGGESTIONS = 20;

/**
 * Suggests PR references (owner/repo#123) from the user's review queue, for prompt-argument
 * completion: typing `/review-pr` in a host offers the PRs waiting for you.
 *
 * Hosts call completion on every keystroke, so results are cached for `ttlMs` (default 60 s).
 * One search per minute at most stays far below GitHub's 30 searches/minute limit.
 * See Decisions.md D31.
 */
export class ReviewQueueSuggestions {
  private cache: { refs: string[]; expiresAt: number } | undefined;
  private inFlight: Promise<string[]> | undefined;

  constructor(
    private readonly github: GitHubClient,
    private readonly logger: Logger,
    private readonly ttlMs = 60_000,
    private readonly now: () => number = Date.now,
  ) {}

  async suggest(prefix: string): Promise<string[]> {
    const refs = await this.load();
    const needle = prefix.trim().toLowerCase();
    return refs.filter((ref) => ref.toLowerCase().includes(needle)).slice(0, MAX_SUGGESTIONS);
  }

  private async load(): Promise<string[]> {
    if (this.cache && this.cache.expiresAt > this.now()) return this.cache.refs;
    // Share one in-flight request between keystrokes that arrive before it finishes.
    this.inFlight ??= this.fetch().finally(() => {
      this.inFlight = undefined;
    });
    return this.inFlight;
  }

  private async fetch(): Promise<string[]> {
    try {
      const login = await this.github.getAuthenticatedLogin();
      const page = await this.github.searchReviewRequests({
        login,
        page: 1,
        perPage: MAX_SUGGESTIONS,
      });
      const refs = page.items.map((item) => formatPullRequestRef(item.ref));
      this.cache = { refs, expiresAt: this.now() + this.ttlMs };
      return refs;
    } catch (error) {
      // Completion is a convenience: on failure offer nothing rather than break the host's UI.
      this.logger.debug({ err: error }, 'review-queue suggestions unavailable');
      return [];
    }
  }
}
