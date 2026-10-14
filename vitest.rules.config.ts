import { defineConfig } from 'vitest/config';

// Security-rules tests. Run through `npm run test:rules`, which starts the emulators first.
export default defineConfig({
  test: { include: ['tests/rules/**/*.test.ts'], environment: 'node', testTimeout: 20000, fileParallelism: false },
});
