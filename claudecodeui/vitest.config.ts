import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'src/**/*.test.ts',
      'scripts/**/*.test.mjs',
      'server/services/tests/openmythos-runtime-env.test.ts',
      'obsidian-plugins/**/*.test.mjs',
      'server/services/tests/artifact-service.test.mjs',
      'server/services/tests/chat-knowledge-capture-service.test.mjs',
      'server/services/tests/obsidian-auto-capture-orchestrator.test.mjs',
      'server/services/tests/knowledge-document-service.test.mjs',
      'server/services/tests/obsidian-context-service.test.mjs',
      'server/services/tests/obsidian-bridge-installer-service.test.mjs',
      'server/services/tests/obsidian-bridge-service.test.mjs',
      'server/services/tests/obsidian-bridge-ingress-service.test.mjs',
      'server/services/tests/obsidian-memory-service.test.mjs',
      'server/services/tests/session-goal-service.test.mjs',
    ],
  },
});
