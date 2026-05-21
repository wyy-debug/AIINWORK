import assert from 'node:assert/strict';
import { test } from 'vitest';

import { ClaudeSessionsProvider } from '../../modules/providers/list/claude/claude-sessions.provider.js';

test('Claude session provider hides Argus synthetic fallback user messages', () => {
  const provider = new ClaudeSessionsProvider();
  const messages = provider.normalizeMessage({
    type: 'user',
    isSynthetic: true,
    uuid: 'synthetic-1',
    message: {
      role: 'user',
      content: '<argus-internal-fallback>\nlegacy hidden internal marker',
    },
  }, 'session-1');

  assert.deepEqual(messages, []);
});

test('Claude session provider hides persisted Argus internal fallback prefixes', () => {
  const provider = new ClaudeSessionsProvider();
  const messages = provider.normalizeMessage({
    type: 'user',
    uuid: 'synthetic-2',
    message: {
      role: 'user',
      content: '<argus-internal-fallback>\nArgus performed a read-only repository preflight.',
    },
  }, 'session-1');

  assert.deepEqual(messages, []);
});

test('Claude session provider hides injected Skill instruction user records', () => {
  const provider = new ClaudeSessionsProvider();
  const messages = provider.normalizeMessage({
    type: 'user',
    uuid: 'skill-instructions-1',
    message: {
      role: 'user',
      content: [
        'Base directory for this skill: C:\\Users\\yckui\\.mtl-code\\skills\\trace-export-tool-skill',
        '',
        '# Trace Export Tool Skill',
        '',
        'Use this Skill for `.utrace` analysis workflows.',
      ].join('\n'),
    },
  }, 'session-1');

  assert.deepEqual(messages, []);
});

test('Claude session provider strips hidden screenshot analysis from visible user messages', () => {
  const provider = new ClaudeSessionsProvider();
  const messages = provider.normalizeMessage({
    type: 'user',
    uuid: 'screenshot-analysis-1',
    message: {
      role: 'user',
      content: [
        '你看看 你做的是什么东西?',
        '',
        '[Images provided at the following paths:]',
        '1. C:\\Users\\yckui\\Desktop\\image_0.png',
        '',
        '## Screenshot analysis',
        'The attached screenshot(s) were parsed by the configured vision-capable model before this agent turn.',
        'The screenshot shows a blue message bubble.',
      ].join('\n'),
    },
  }, 'session-1');

  assert.equal(messages.length, 1);
  assert.equal(messages[0].kind, 'text');
  assert.equal(messages[0].role, 'user');
  assert.equal(messages[0].content, '你看看 你做的是什么东西?');
});

test('Claude session provider marks compact summaries as lazy-loadable without embedding summary content', () => {
  const provider = new ClaudeSessionsProvider();
  const messages = provider.normalizeMessage({
    type: 'user',
    uuid: 'compact-summary-1',
    isCompactSummary: true,
    message: {
      role: 'user',
      content: 'This session is being continued from a previous conversation that ran out of context.\n\nSummary:\nLarge compacted summary body.',
    },
  }, 'session-1');

  assert.equal(messages.length, 1);
  assert.equal(messages[0].kind, 'context_compaction');
  assert.equal(messages[0].compactSummary, undefined);
  assert.equal(messages[0].compactSummaryAvailable, true);
});
