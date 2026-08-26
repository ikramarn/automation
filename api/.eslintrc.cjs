/** @type {import('eslint').Linter.Config} */
module.exports = {
  root: true,
  env: {
    node: true,
    es2022: true,
  },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    // Use tsconfig.eslint.json so test files are included in the project
    project: './tsconfig.eslint.json',
    tsconfigRootDir: __dirname,
  },
  plugins: ['@typescript-eslint'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:@typescript-eslint/recommended-requiring-type-checking',
  ],
  rules: {
    // TypeScript
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/explicit-function-return-type': 'off',
    '@typescript-eslint/explicit-module-boundary-types': 'off',
    '@typescript-eslint/no-non-null-assertion': 'warn',
    '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],

    // These fire on valid Fastify plugin patterns (async route registrars that
    // register handlers but don't themselves await) — downgrade to warn
    '@typescript-eslint/require-await': 'warn',

    // Fastify and Supabase clients use `any` internally — reduce noise
    '@typescript-eslint/no-unsafe-assignment': 'warn',
    '@typescript-eslint/no-unsafe-call': 'warn',
    '@typescript-eslint/no-unsafe-member-access': 'warn',
    '@typescript-eslint/no-unsafe-argument': 'warn',
    '@typescript-eslint/no-unsafe-return': 'warn',
    '@typescript-eslint/no-redundant-type-constituents': 'warn',
    '@typescript-eslint/no-unnecessary-type-assertion': 'warn',
    '@typescript-eslint/no-floating-promises': 'error',
    '@typescript-eslint/no-misused-promises': 'warn',
    '@typescript-eslint/restrict-template-expressions': 'warn',

    // General
    'no-console': ['warn', { allow: ['warn', 'error'] }],
    'no-control-regex': 'warn',
    'no-useless-escape': 'warn',
    'prefer-const': 'error',
    'no-var': 'error',
    eqeqeq: ['error', 'always'],
  },
  ignorePatterns: ['dist/', 'node_modules/', '*.cjs', '*.js'],
  overrides: [
    {
      // Test files — relax rules that fire on valid test scaffolding patterns
      files: ['**/*.test.ts', '**/*.integration.test.ts', '**/*-property.test.ts'],
      rules: {
        '@typescript-eslint/no-unused-vars': 'warn',
        'prefer-const': 'warn',
        '@typescript-eslint/consistent-type-imports': 'off',
      },
    },
  ],
};
