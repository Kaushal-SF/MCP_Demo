/**
 * Minimal glob → RegExp conversion for path matching (no dependency needed).
 *
 * Supported syntax:
 *   `**`  any number of path segments (including none)
 *   `*`   anything except `/`
 *   `?`   one character except `/`
 * Patterns without a `/` match the basename anywhere in the tree (like .gitignore),
 * e.g. `Dockerfile` matches `services/api/Dockerfile`.
 */
export function globToRegExp(pattern: string): RegExp {
  const anchored = pattern.includes('/');
  const source = pattern.replace(/^\.?\//, '');

  let regex = '';
  for (let i = 0; i < source.length; i++) {
    const char = source.charAt(i);
    if (char === '*') {
      if (source.charAt(i + 1) === '*') {
        const followedBySlash = source.charAt(i + 2) === '/';
        regex += followedBySlash ? '(?:.*/)?' : '.*';
        i += followedBySlash ? 2 : 1;
      } else {
        regex += '[^/]*';
      }
    } else if (char === '?') {
      regex += '[^/]';
    } else {
      regex += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }

  return new RegExp(anchored ? `^${regex}$` : `(?:^|/)${regex}$`);
}

export function createPathMatcher(patterns: readonly string[]): (path: string) => boolean {
  const regexes = patterns.map(globToRegExp);
  return (path) => regexes.some((regex) => regex.test(path));
}
