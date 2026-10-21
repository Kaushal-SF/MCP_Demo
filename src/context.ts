import type { GitHubClient } from './clients/github.js';
import type { Logger } from './lib/logger.js';
import type { ChecklistStore } from './services/checklists.js';
import type { ReviewQueueSuggestions } from './services/suggestions.js';

/**
 * Dependencies handed to every tool, resource and prompt registration function.
 * Built once in the composition root (index.ts) or by tests, then passed down; nothing below this
 * point creates its own clients, so tests can substitute any of them.
 */
export interface ServerContext {
  github: GitHubClient;
  logger: Logger;
  checklists: ChecklistStore;
  /** Cached review-queue lookups that power argument completion for `pr` prompt arguments. */
  suggestions: ReviewQueueSuggestions;
  extraSensitivePaths: readonly string[];
}
