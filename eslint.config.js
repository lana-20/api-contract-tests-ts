// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['allurerc.mjs', 'node_modules', 'src/generated', 'allure-results', 'allure-report', 'reports', 'pacts', 'site'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // Tests and scripts sometimes need `any` for deliberately malformed data.
      '@typescript-eslint/no-explicit-any': 'off',
      // Allow `const { secret, ...rest } = obj` to drop a field.
      '@typescript-eslint/no-unused-vars': ['error', { ignoreRestSiblings: true }],
    },
  },
);
