import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'src/**/*.test.ts',
      'scripts/**/*.test.mjs',
      'server/services/tests/openmythos-runtime-env.test.ts',
      'server/services/tests/session-goal-service.test.mjs',
    ],
  },
});
