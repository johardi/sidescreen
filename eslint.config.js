import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['node_modules/**', 'openspec/**', 'test-results/**'] },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: globals.node,
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true, caughtErrors: 'none' }],
    },
  },
  {
    files: ['src/public/**/*.js'],
    languageOptions: {
      globals: globals.browser,
    },
  },
  {
    // Tests drive a real browser and evaluate snippets inside it.
    files: ['test/**/*.js'],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
  },
];
