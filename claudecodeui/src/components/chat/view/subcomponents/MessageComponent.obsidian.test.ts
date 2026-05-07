import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

describe('MessageComponent Obsidian auto-capture status', () => {
  it('does not show manual Obsidian save controls on assistant replies', () => {
    const currentDir = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(resolve(currentDir, 'MessageComponent.tsx'), 'utf8');

    expect(source).not.toContain('Save to Obsidian');
    expect(source).not.toContain('Auto mode');
    expect(source).not.toContain('/api/artifacts');
    expect(source).not.toContain('session-summary');
    expect(source).not.toContain('chat-summary');
    expect(source).toContain('obsidianCaptureStatus');
    expect(source).toContain('routingModes');
    expect(source).toContain('obsidianTargets');
    expect(source).toContain('未保存');
    expect(source).toContain('内容不像知识沉淀');
    expect(source).not.toContain('Matched default mode');
  });

  it('does not auto-submit assistant replies from the frontend pane', () => {
    const currentDir = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(resolve(currentDir, 'ChatMessagesPane.tsx'), 'utf8');

    expect(source).not.toContain('/api/obsidian-bridge/auto-capture-chat');
    expect(source).not.toContain('autoCaptureSentKeysRef');
  });
});
