import assert from 'node:assert/strict';
import { test } from 'vitest';

import { resolveWorktreeSessionBinding } from '../worktrees.js';

test('worktree dispatch inherits Agent, Skill, MCP, and model binding from source conversation', () => {
  const sourceBinding = {
    agentId: 'soc-review-agent',
    configuration: {
      skills: ['crashsight-single-crash-analysis'],
      appBindings: [
        { slot: 'CrashSight', app: 'MCP: crashsight-triage', status: 'connected' },
      ],
      modelProfileId: 'mimo-v2-5',
    },
  };

  const resolved = resolveWorktreeSessionBinding({
    body: {
      sourceSessionId: 'source-session',
      sessionId: 'worktree-session',
    },
    sourceBinding,
    provider: 'claude',
  });

  assert.deepEqual(resolved, {
    provider: 'claude',
    agentId: 'soc-review-agent',
    skills: ['crashsight-single-crash-analysis'],
    appBindings: [
      { slot: 'CrashSight', app: 'MCP: crashsight-triage', status: 'connected' },
    ],
    configuration: {
      skills: ['crashsight-single-crash-analysis'],
      appBindings: [
        { slot: 'CrashSight', app: 'MCP: crashsight-triage', status: 'connected' },
      ],
      modelProfileId: 'mimo-v2-5',
    },
  });
});

test('explicit worktree dispatch choices override inherited conversation binding', () => {
  const resolved = resolveWorktreeSessionBinding({
    body: {
      agentId: 'explicit-agent',
      skills: ['explicit-skill'],
      appBindings: [
        { slot: 'Search', app: 'MCP: ainwork-code-search', status: 'connected' },
      ],
    },
    sourceBinding: {
      agentId: 'source-agent',
      configuration: {
        skills: ['source-skill'],
        appBindings: [
          { slot: 'CrashSight', app: 'MCP: crashsight-triage', status: 'connected' },
        ],
        modelProfileId: 'deepseek-default',
      },
    },
    provider: 'claude',
  });

  assert.deepEqual(resolved, {
    provider: 'claude',
    agentId: 'explicit-agent',
    skills: ['explicit-skill'],
    appBindings: [
      { slot: 'Search', app: 'MCP: ainwork-code-search', status: 'connected' },
    ],
    configuration: {
      skills: ['explicit-skill'],
      appBindings: [
        { slot: 'Search', app: 'MCP: ainwork-code-search', status: 'connected' },
      ],
      modelProfileId: 'deepseek-default',
    },
  });
});
