/**
 * Purity guard for @local-books/core.
 *
 * PROJECT.md line 61: all domain logic lives in a pure-TypeScript core package with
 * zero UI/platform dependencies, so the future desktop surface (line 60) reuses it
 * unchanged. That is only true if it is enforced -- an aspiration in a README decays
 * the first time someone reaches for `Date.now()` or a React hook.
 *
 * Node builtins are banned alongside UI packages: core must not touch fs, net, or
 * crypto directly. Those arrive through ports (see src/ports/) so the same code runs
 * on a phone, on a desktop, and in a Node test process against fixtures.
 *
 * There is a test that verifies this guard actually fires -- see the `check:purity`
 * script. A guard nobody has watched fail is not known to work.
 */
const RESTRICTED_PATTERNS = [
  {
    group: ['react', 'react/*', 'react-dom', 'react-dom/*'],
    message: 'core is UI-free (PROJECT.md line 61). Keep React in apps/mobile.',
  },
  {
    group: ['react-native', 'react-native/*', 'react-native-*'],
    message: 'core is platform-free (PROJECT.md line 61). Keep RN in apps/mobile.',
  },
  {
    group: ['expo', 'expo-*', 'expo/*', '@expo/*'],
    message: 'core is platform-free (PROJECT.md line 61). Keep Expo in apps/mobile.',
  },
  {
    group: ['@op-engineering/*'],
    message: 'core does not know about SQLite. Persist through StoragePort.',
  },
  {
    group: ['@solana/*', '@solana-*'],
    message:
      'core does not open sockets. Chain access goes through RpcPort; keep the web3.js ' +
      'adapter in apps/mobile so ingestion stays testable against fixtures.',
  },
];

/** Node builtins, bare and node:-prefixed. */
const NODE_BUILTINS = [
  'fs', 'path', 'os', 'net', 'http', 'https', 'crypto', 'child_process',
  'worker_threads', 'stream', 'zlib', 'dns', 'tls', 'cluster', 'perf_hooks',
];

module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  env: { es2022: true },
  rules: {
    'no-restricted-imports': [
      'error',
      {
        patterns: RESTRICTED_PATTERNS,
        paths: [
          ...NODE_BUILTINS.map((name) => ({
            name,
            message: `core is runtime-agnostic: reach ${name} through a port instead.`,
          })),
          ...NODE_BUILTINS.map((name) => ({
            name: `node:${name}`,
            message: `core is runtime-agnostic: reach ${name} through a port instead.`,
          })),
        ],
      },
    ],

    // Ambient time and randomness are platform reads in disguise, and they make
    // backfill windows and reference-key generation untestable. ClockPort and the
    // caller supply both. See DECISIONS.md D3.
    'no-restricted-globals': [
      'error',
      { name: 'fetch', message: 'Network belongs to RpcPort/RatePort, not core.' },
      { name: 'localStorage', message: 'Persistence belongs to StoragePort.' },
      { name: 'window', message: 'core is UI-free.' },
      { name: 'document', message: 'core is UI-free.' },
    ],
    'no-restricted-properties': [
      'error',
      {
        object: 'Date',
        property: 'now',
        message: 'Inject time via ClockPort so time-window logic is deterministic in tests.',
      },
      {
        object: 'Math',
        property: 'random',
        message: 'Inject randomness so reference-key generation is reproducible in tests.',
      },
    ],

    '@typescript-eslint/no-unused-vars': [
      'error',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
    ],
    '@typescript-eslint/consistent-type-imports': 'error',
  },
  overrides: [
    {
      // Tests may construct fixed dates as fixture data; they still may not import
      // platform packages, so the import restrictions above continue to apply.
      files: ['test/**/*.ts'],
      rules: { 'no-restricted-properties': 'off' },
    },
  ],
};
