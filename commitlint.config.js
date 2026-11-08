export default {
  extends: ['@commitlint/config-conventional'],
  plugins: [
    {
      rules: {
        'header-ascii': ({ header }) => [
          !header || /^[\x20-\x7e]+$/.test(header),
          'Use an English ASCII header',
        ],
      },
    },
  ],
  rules: {
    'header-ascii': [2, 'always'],
    'scope-case': [2, 'always', 'kebab-case'],
    // Preserve identifier casing such as IPC, QuickJS and AppErrorState in subjects.
    'subject-case': [0],
  },
}
