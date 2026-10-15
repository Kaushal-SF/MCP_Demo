import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  // Makes `dist/index.js` directly executable (`npx devflow-mcp`).
  banner: { js: '#!/usr/bin/env node' },
});
