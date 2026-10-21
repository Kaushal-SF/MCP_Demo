import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  outDir: 'dist',
  clean: true,
  // Bundle every dependency into one file, so `npx devflow-pr-mcp` and the Claude Desktop bundle
  // start without installing anything. That is why the runtime libraries are devDependencies.
  // See Decisions.md D37.
  noExternal: [/.*/],
  banner: {
    js: [
      // Makes `dist/index.js` directly executable.
      '#!/usr/bin/env node',
      // Some bundled libraries are CommonJS and call require() for Node built-ins, which an ES module
      // does not have; give them one.
      "import { createRequire as __devflowCreateRequire } from 'node:module';",
      'const require = __devflowCreateRequire(import.meta.url);',
    ].join('\n'),
  },
});
