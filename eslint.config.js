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
    files: ['src/web/public/**/*.js'],
    languageOptions: {
      globals: globals.browser,
    },
  },
  {
    // The menu bar item is JavaScript for Automation, run by osascript: its
    // globals are the ObjC bridge, not Node's.
    files: ['menubar/**/*.js'],
    languageOptions: {
      sourceType: 'script',
      globals: { $: 'readonly', ObjC: 'readonly', Ref: 'readonly', console: 'readonly' },
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
