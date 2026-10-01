import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import eslintConfigPrettier from 'eslint-config-prettier';

export default [
  {
    ignores: ['dist/', 'coverage/', 'out-tsc/', '.angular/', '**/*.min.js'],
  },

  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        projectService: './tsconfig.json',
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
    },
    rules: {
      ...tseslint.configs.recommended.rules,
    },
  },
  {
    files: ['src/app/shared/**/*.ts'],
    ignores: ['**/*.spec.ts', '**/index.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '^@shared(/|$)',
              message: 'Inside shared, import from the file that declares the symbol, not an @shared barrel.',
            },
            {
              regex:
                '^(\\.{1,2}/)*(\\.{1,2}|shared|components|constants|directives|helpers|models|pipes|services|validators)(/index)?/?$',
              message: 'Inside shared, import from the file that declares the symbol, not a barrel (index.ts).',
            },
          ],
        },
      ],
    },
  },

  eslintConfigPrettier,
];
