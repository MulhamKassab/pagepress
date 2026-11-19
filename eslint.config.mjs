import js from '@eslint/js';
import globals from 'globals';

const recommended = js.configs.recommended;
const rules = { 'no-unused-vars': ['warn', { argsIgnorePattern: '^_', caughtErrors: 'none' }] };

export default [
  { ignores: ['node_modules/**', 'extension/vendor/**', 'website/downloads/**', '.artifacts/**', '.cache/**', '.vercel/**', 'coverage/**'] },
  recommended,
  { rules },
  {
    files: ['extension/**/*.js'],
    languageOptions: { sourceType: 'module', globals: { ...globals.browser, ...globals.webextensions, ...globals.serviceworker } },
  },
  {
    // Classic scripts (no imports) injected into pages.
    files: ['extension/content.js'],
    languageOptions: { sourceType: 'script', globals: { ...globals.browser, ...globals.webextensions } },
  },
  { files: ['website/**/*.js'], languageOptions: { sourceType: 'script', globals: globals.browser } },
  { files: ['scripts/**/*.mjs', 'tests/**/*.mjs', '*.mjs'], languageOptions: { sourceType: 'module', globals: { ...globals.node, ...globals.browser, ...globals.webextensions } } },
  // The PDF footer sanitiser intentionally strips control characters.
  { files: ['extension/lib/geometry.js', 'tests/extension-geometry.test.mjs'], rules: { 'no-control-regex': 'off' } },
];
