import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Finds the folder containing this package's package.json, starting from a module URL.
 *
 * Needed because the same code runs from two depths: bundled as `dist/index.js` (one level down)
 * and from source as `src/<dir>/<file>.ts` in dev and tests (two levels down). Walking up instead of
 * hard-coding `../` works for both, and for an `npx` install inside node_modules.
 */
export function findPackageRoot(fromUrl: string): string {
  let dir = dirname(fileURLToPath(fromUrl));
  for (;;) {
    if (existsSync(join(dir, 'package.json'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`No package.json found above ${fromUrl}`);
    dir = parent;
  }
}
