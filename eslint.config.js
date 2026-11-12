import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';
import ts from 'typescript-eslint';
import { defineConfig } from 'eslint/config';

const layerRule =
  'src/sim is the pure rules layer: it must not import the renderer, the interface, or the app wiring.';

export default defineConfig(
  { ignores: ['dist', 'captures', 'playwright-report', 'test-results'] },
  js.configs.recommended,
  ts.configs.strict,
  svelte.configs.recommended,
  prettier,
  svelte.configs.prettier,
  {
    files: ['src/**'],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ['scripts/**', 'e2e/**', '*.config.ts', '*.config.js'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['**/*.svelte', '**/*.svelte.ts'],
    languageOptions: {
      parserOptions: { parser: ts.parser, extraFileExtensions: ['.svelte'] },
    },
  },
  {
    files: ['src/sim/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'pixi.js', message: layerRule },
            { name: 'svelte', message: layerRule },
          ],
          patterns: [
            { group: ['pixi.js/*', 'svelte/*'], message: layerRule },
            {
              group: ['**/render', '**/render/**', '**/ui', '**/ui/**', '**/app', '**/app/**'],
              message: layerRule,
            },
          ],
        },
      ],
    },
  },
);
