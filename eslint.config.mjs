import js from '@eslint/js';
import tseslint from 'typescript-eslint';

const scriptFiles = ['scripts/**/*.mjs'];
const typescriptFiles = [
  'apps/*/src/**/*.ts',
  'apps/*/tests/**/*.ts',
  'packages/*/src/**/*.ts',
  'packages/*/tests/**/*.ts',
  'scripts/**/*.ts',
];

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**'],
  },
  {
    ...js.configs.recommended,
    files: scriptFiles,
    languageOptions: {
      globals: {
        console: 'readonly',
        process: 'readonly',
        URL: 'readonly',
        AbortController: 'readonly',
        Buffer: 'readonly',
        clearTimeout: 'readonly',
        fetch: 'readonly',
        setTimeout: 'readonly',
      },
    },
  },
  ...tseslint.configs.recommended.map((config) => ({
    ...config,
    files: typescriptFiles,
  })),
);
