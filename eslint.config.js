import js from '@eslint/js';
import globals from 'globals';

export default [
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      '.git/**'
    ]
  },
  js.configs.recommended,
  {
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.webextensions,
        ...globals.node
      }
    },
    rules: {
      complexity: ['error', 10],
      'max-lines': ['error', { max: 350, skipBlankLines: true, skipComments: true }],
      'max-lines-per-function': ['error', { max: 70, skipBlankLines: true, skipComments: true }],
      'no-console': 'off'
    }
  },
  // Legacy source files predate strict rules — exempt from size + complexity
  {
    files: ['background.js', 'content.js', 'popup.js'],
    rules: {
      'max-lines': 'off',
      'max-lines-per-function': 'off',
      complexity: 'off',
      'no-control-regex': 'off'
    }
  },
  // Build tooling scripts
  {
    files: ['scripts/**/*.mjs', 'scripts/**/*.js'],
    rules: {
      'max-lines': 'off',
      'max-lines-per-function': 'off',
      complexity: 'off'
    }
  }
];
