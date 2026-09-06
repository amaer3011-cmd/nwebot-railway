export default [
  {
    ignores: ['node_modules/**', 'data/**'],
    languageOptions: {
      globals: {
        process: 'readonly', console: 'readonly', Buffer: 'readonly', URL: 'readonly',
        fetch: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly',
        setInterval: 'readonly', clearInterval: 'readonly', document: 'readonly',
        window: 'readonly', requestAnimationFrame: 'readonly'
      }
    },
    rules: {
      'no-undef': 'off',
      'no-unused-vars': 'off',
      'no-constant-condition': 'warn'
    }
  }
];
