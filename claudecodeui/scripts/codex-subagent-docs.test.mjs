import { describe, expect, test } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(__dirname, '..', '..');

const docsToCheck = [
  'claude-code/docs/agent/sub-agents.mdx',
  'claude-code/docs/agent/coordinator-and-swarm.mdx',
  'claude-code/docs/features/coordinator-mode.md',
  'claudecodeui/docs/knowledge/2026-05-05-codex-subagent-source-migration.md',
];

const legacyProtocolTerms = [
  'AgentDispatchPlan',
  'dispatch_ticket',
  'DispatchTicket',
  'AgentSpawn',
  'AgentWait',
  'AgentResult',
  'AgentCancel',
  'AgentSendInput',
  'visible plan',
  '可见计划',
];

function readDoc(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

describe('Codex subagent documentation alignment', () => {
  test('docs do not present legacy dispatch protocols as the current model', () => {
    for (const relativePath of docsToCheck) {
      const text = readDoc(relativePath);
      for (const term of legacyProtocolTerms) {
        expect(text, `${relativePath} should not contain ${term}`).not.toContain(term);
      }
    }
  });

  test('source migration document contains a Codex compatibility matrix', () => {
    const text = readDoc('claudecodeui/docs/knowledge/2026-05-05-codex-subagent-source-migration.md');

    expect(text).toContain('## Codex Alignment Matrix');
    for (const toolName of [
      'spawn_agent',
      'list_agents',
      'wait_agent',
      'send_message',
      'close_agent',
      'resume_agent',
    ]) {
      expect(text).toContain(`\`${toolName}\``);
    }
    expect(text).toContain('Mailbox');
    expect(text).toContain('Thread graph');
  });
});
