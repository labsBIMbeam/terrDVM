import js from '@eslint/js';
import tseslint from 'typescript-eslint';

const scriptFiles = ['scripts/**/*.mjs'];
const typescriptFiles = [
  'apps/napplet/src/**/*.ts',
  'apps/napplet/tests/**/*.ts',
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
      },
    },
  },
  ...tseslint.configs.recommended.map((config) => ({
    ...config,
    files: typescriptFiles,
  })),
);
