import type { GitHubClient } from '../clients/github.js';
import type { Logger } from '../lib/logger.js';

/** Dependencies handed to every tool registration function. */
export interface ToolContext {
  github: GitHubClient;
  logger: Logger;
  extraSensitivePaths: readonly string[];
}
