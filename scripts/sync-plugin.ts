/**
 * Stages the Claude Code plugin under plugins/devflow/server/.
 *
 *   npm run plugin
 *
 * Why the server is committed instead of installed: a plugin is delivered by cloning the
 * marketplace repository, so whatever the server needs has to be in the repository. DevFlow is not
 * on npm, so `npx devflow-pr-mcp` is not an option, and asking Claude Code to run a build at install
 * time would need a toolchain on every user's machine. tsup already bundles every dependency into
 * one file (Decisions.md D37), so committing that file makes installation a clone and nothing else
 * (Decisions.md D39).
 *
 * Layout, which findPackageRoot() relies on to locate the checklists:
 *   plugins/devflow/server/package.json   "type": "module", so Node loads index.js as an ES module
 *   plugins/devflow/server/index.js       the bundle from dist/
 *   plugins/devflow/server/checklists/    the bundled review checklists
 *
 * Run this after every change to src/ or checklists/, and commit the result. `npm run verify:plugin`
 * (used by CI) re-runs it and fails if the committed files were left behind.
 */
/* eslint-disable no-console -- this script is a CLI, not the server; stdout is fine here. */
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { format, resolveConfig } from 'prettier';

const root = join(import.meta.dirname, '..');
const pluginDir = join(root, 'plugins', 'devflow');
const serverDir = join(pluginDir, 'server');

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
  name: string;
  version: string;
};

// One source of truth for the version: package.json. Claude Code pins users to the plugin's
// version, so a stale number here would keep them on an old copy of the server.
const manifestPath = join(pluginDir, '.claude-plugin', 'plugin.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { version: string };
manifest.version = pkg.version;
// Written through Prettier, not JSON.stringify alone: this file is committed and `format:check`
// covers it, so raw stringify output would fail CI the moment the version changed.
writeFileSync(
  manifestPath,
  await format(JSON.stringify(manifest, null, 2), {
    ...(await resolveConfig(manifestPath)),
    filepath: manifestPath,
  }),
);

// Replaced wholesale rather than copied over, so a checklist deleted from checklists/ also
// disappears from the plugin.
rmSync(serverDir, { recursive: true, force: true });
mkdirSync(serverDir, { recursive: true });
cpSync(join(root, 'dist', 'index.js'), join(serverDir, 'index.js'));
cpSync(join(root, 'checklists'), join(serverDir, 'checklists'), { recursive: true });
writeFileSync(
  join(serverDir, 'package.json'),
  `${JSON.stringify({ name: pkg.name, version: pkg.version, type: 'module', private: true }, null, 2)}\n`,
);

// The authoritative check on the manifest and the marketplace entry; it is what users' Claude Code
// runs when they install, so failing here beats failing on their machine. Skipped where the CLI is
// absent (CI runners), because the staleness check this script backs is still worth running there.
try {
  execFileSync('claude', ['plugin', 'validate', root], { stdio: 'inherit' });
} catch (error) {
  const missing = (error as NodeJS.ErrnoException).code === 'ENOENT';
  if (!missing) throw error;
  console.log('Claude Code CLI not found; skipped `claude plugin validate`.');
}

console.log(`\nPlugin staged: ${pluginDir}`);
console.log(`Install locally with: claude plugin marketplace add ${root}`);
