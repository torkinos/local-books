import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Explicit imports from 'vitest' in every test file rather than globals: it keeps
    // the core package's type surface empty (tsconfig has `types: []`), which is part
    // of how platform-free-ness is enforced.
    globals: false,
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
