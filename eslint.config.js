import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  { ignores: ['dist/', 'build/', 'coverage/', 'node_modules/', 'plugins/*/server/'] },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      // stdout is the JSON-RPC channel in stdio mode — any stray console.log corrupts the protocol.
      'no-console': 'error',
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
    },
  },
  {
    // Asymmetric matchers such as expect.stringContaining() are typed `any` by design.
    files: ['test/**/*.ts'],
    rules: { '@typescript-eslint/no-unsafe-assignment': 'off' },
  },
  { files: ['*.config.{js,ts}'], ...tseslint.configs.disableTypeChecked },
  prettier,
);
