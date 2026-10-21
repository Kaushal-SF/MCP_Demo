/**
 * Builds the Claude Desktop installer: build/devflow.mcpb.
 *
 *   npm run bundle
 *
 * An .mcpb file is a zip of manifest.json plus the server. Claude Desktop installs it on
 * double-click and asks for the settings declared in the manifest. Because tsup bundles every
 * dependency into dist/index.js, the zip needs no node_modules (see Decisions.md D37, D38).
 */
/* eslint-disable no-console -- this script is a CLI, not the server; stdout is fine here. */
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Pinned so the installer is reproducible; run through npx so the tool's own dependencies stay out
// of this project's dependency tree and audit.
const MCPB = '@anthropic-ai/mcpb@2.1.2';

const root = join(import.meta.dirname, '..');
const stage = join(root, 'build', 'mcpb');
const output = join(root, 'build', 'devflow.mcpb');

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
  name: string;
  version: string;
};
const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8')) as {
  version: string;
};
// One source of truth for the version: package.json.
manifest.version = pkg.version;

rmSync(join(root, 'build'), { recursive: true, force: true });
mkdirSync(join(stage, 'dist'), { recursive: true });
writeFileSync(join(stage, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
cpSync(join(root, 'dist', 'index.js'), join(stage, 'dist', 'index.js'));
cpSync(join(root, 'checklists'), join(stage, 'checklists'), { recursive: true });
cpSync(join(root, 'LICENSE'), join(stage, 'LICENSE'));
// The server needs a package.json next to it: "type": "module" makes Node load dist/index.js as an
// ES module, and findPackageRoot() uses it to locate the bundled checklists.
writeFileSync(
  join(stage, 'package.json'),
  `${JSON.stringify({ name: pkg.name, version: pkg.version, type: 'module', private: true }, null, 2)}\n`,
);

const run = (args: string[]) => {
  execFileSync('npx', ['-y', MCPB, ...args], { stdio: 'inherit' });
};
run(['validate', join(stage, 'manifest.json')]);
run(['pack', stage, output]);
console.log(`\nClaude Desktop installer ready: ${output}`);
