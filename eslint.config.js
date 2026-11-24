import javascript from '@eslint/js';
import typescript from 'typescript-eslint';
import house from './tools/eslint-plugin-house/index.js';

export default typescript.config(
  { ignores: ['dist/', 'node_modules/', 'coverage/'] },
  javascript.configs.recommended,
  ...typescript.configs.recommended,
  {
    plugins: { house },
    rules: {
      'id-length': ['error', { min: 2, properties: 'never' }],
      'no-empty': ['error', { allowEmptyCatch: false }],
      'house/no-swallowed-catch': 'error',
      'house/no-return-in-loop': 'error',
      'house/no-foreach-return': 'error',
      'no-restricted-properties': ['error', {
        object: 'process',
        property: 'env',
        message: 'Read configuration from the config object. Only src/config.ts reads process.env.',
      }],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^unused' }],
    },
  },
  {
    files: ['src/config.ts'],
    rules: { 'no-restricted-properties': 'off' },
  },
);
