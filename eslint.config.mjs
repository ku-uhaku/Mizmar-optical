import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  { ignores: ['**/node_modules/**', '**/dist/**', '**/.next/**', '**/.turbo/**', 'apps/api/src/generated/**', '**/next-env.d.ts', 'apps/api/prisma/migrations/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off', // Prisma extension / dynamic delegates need it; the API boundary is DTO-validated
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true }],
      '@typescript-eslint/no-empty-object-type': 'off',
    },
  },
  {
    files: ['apps/admin/**/*.{ts,tsx}', 'apps/web/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: { ...reactHooks.configs.recommended.rules },
  },
  { files: ['**/*.spec.ts', '**/*.e2e-spec.ts'], rules: { '@typescript-eslint/no-require-imports': 'off' } },
  { files: ['**/*.js', '**/*.cjs'], languageOptions: { sourceType: 'commonjs', globals: { module: 'writable', require: 'readonly', __dirname: 'readonly', process: 'readonly' } }, rules: { '@typescript-eslint/no-require-imports': 'off' } },
);
