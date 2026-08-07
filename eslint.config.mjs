import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'coverage/**',
      'src/core/agent-icons.generated.ts',
    ],
  },
  ...tseslint.configs.recommended,
  eslintConfigPrettier,
  {
    rules: {
      // Hyper's plugin API is untyped; explicit `any` is the pragmatic contract
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
);
