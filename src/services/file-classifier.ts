/**
 * Path-based heuristics shared by analysis services. Deliberately simple and language-agnostic;
 * they only need to be right "most of the time" to be useful review signals.
 */

const TEST_PATTERNS = [
  /(^|\/)(__tests__|__mocks__|tests?|spec|e2e|cypress)\//i,
  /\.(test|spec|cy|e2e)\.[cm]?[jt]sx?$/i,
  /_test\.(go|py|rb|exs?)$/i,
  /(^|\/)test_[^/]+\.py$/i,
  /(Test|Tests|IT)\.(java|kt|cs|swift)$/,
  /_spec\.rb$/i,
];

const SOURCE_EXTENSIONS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'vue', 'svelte',
  'py', 'go', 'java', 'kt', 'kts', 'scala', 'rb', 'rs', 'cs', 'php', 'swift', 'dart',
  'c', 'cc', 'cpp', 'h', 'hpp', 'm', 'mm', 'ex', 'exs', 'sql',
]); // prettier-ignore

const GENERATED_PATTERNS = [
  /(^|\/)(dist|build|out|vendor|node_modules|\.next|coverage)\//,
  /\.min\.(js|css)$/,
  /\.snap$/,
  /(^|\/)__snapshots__\//,
  /\.generated\.\w+$/,
  /\.pb\.go$/,
];

const LOCKFILES = new Set([
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lockb',
  'npm-shrinkwrap.json',
  'Gemfile.lock',
  'poetry.lock',
  'Pipfile.lock',
  'uv.lock',
  'Cargo.lock',
  'go.sum',
  'composer.lock',
  'pubspec.lock',
  'Podfile.lock',
  'gradle.lockfile',
]);

const MANIFESTS = new Set([
  'package.json',
  'requirements.txt',
  'pyproject.toml',
  'Pipfile',
  'Gemfile',
  'Cargo.toml',
  'go.mod',
  'composer.json',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'pubspec.yaml',
  'Podfile',
]);

function basename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

export function isTestFile(path: string): boolean {
  return TEST_PATTERNS.some((pattern) => pattern.test(path));
}

export function isLockfile(path: string): boolean {
  return LOCKFILES.has(basename(path));
}

export function isManifest(path: string): boolean {
  return MANIFESTS.has(basename(path));
}

export function isGenerated(path: string): boolean {
  return isLockfile(path) || GENERATED_PATTERNS.some((pattern) => pattern.test(path));
}

/** Production code: a source-language file that is neither a test nor generated. */
export function isSourceFile(path: string): boolean {
  const name = basename(path);
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return false;
  const extension = name.slice(dot + 1).toLowerCase();
  if (name.endsWith('.d.ts')) return false;
  return SOURCE_EXTENSIONS.has(extension) && !isTestFile(path) && !isGenerated(path);
}
