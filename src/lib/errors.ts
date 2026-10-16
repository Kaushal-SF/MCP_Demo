export type ErrorCode =
  | 'INVALID_INPUT'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'RATE_LIMITED'
  | 'UPSTREAM_ERROR'
  | 'INTERNAL';

/**
 * An error whose message is safe and useful to show to the model/user.
 * Tool handlers convert these into `isError: true` tool results.
 */
export class DevflowError extends Error {
  override name = 'DevflowError';

  constructor(
    readonly code: ErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }
}

interface HttpLikeError {
  status: number;
  message?: string;
  response?: { headers?: Record<string, string | number | undefined> };
}

// Duck-typed instead of `instanceof RequestError` so we do not depend on an Octokit-internal
// package; any HTTP client error with a numeric `status` is handled the same way.
function isHttpLikeError(error: unknown): error is HttpLikeError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    typeof error.status === 'number'
  );
}

/**
 * Translates GitHub API failures (Octokit `RequestError`s) into actionable `DevflowError`s.
 * `what` describes the thing being accessed, e.g. "pull request acme/web#42".
 */
export function mapGitHubError(error: unknown, what: string): DevflowError {
  if (error instanceof DevflowError) return error;
  if (!isHttpLikeError(error)) {
    return new DevflowError('INTERNAL', `Unexpected error while accessing ${what}.`, {
      cause: error,
    });
  }

  const headers = error.response?.headers ?? {};
  switch (error.status) {
    case 401:
      return new DevflowError(
        'UNAUTHORIZED',
        'GitHub rejected the token (401). Check that GITHUB_TOKEN is set and not expired.',
        { cause: error },
      );
    // GitHub signals rate limits with 403 + `x-ratelimit-remaining: 0` (and secondary limits
    // sometimes with 429), so a 403 must be told apart from a real permission problem.
    case 403:
    case 429: {
      if (headers['x-ratelimit-remaining'] === '0' || error.status === 429) {
        const reset = Number(headers['x-ratelimit-reset']);
        const when = Number.isFinite(reset)
          ? ` Limit resets at ${new Date(reset * 1000).toISOString()}.`
          : '';
        return new DevflowError('RATE_LIMITED', `GitHub API rate limit exceeded.${when}`, {
          cause: error,
        });
      }
      return new DevflowError(
        'FORBIDDEN',
        `GitHub denied access to ${what} (403). The token may lack the required permission or SSO authorization.`,
        { cause: error },
      );
    }
    case 404:
      return new DevflowError(
        'NOT_FOUND',
        `Could not find ${what}. Check the owner/repo/number, and that the token can access this repository.`,
        { cause: error },
      );
    case 422:
      return new DevflowError('INVALID_INPUT', `GitHub rejected the request for ${what} (422).`, {
        cause: error,
      });
    default:
      return new DevflowError(
        'UPSTREAM_ERROR',
        `GitHub returned HTTP ${error.status} while accessing ${what}. Try again shortly.`,
        { cause: error },
      );
  }
}
