import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

describe('MessageComponent Obsidian Wiki upload controls', () => {
  it('shows a manual Wiki upload action with a routing suggestion on completed assistant replies', () => {
    const currentDir = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(resolve(currentDir, 'MessageComponent.tsx'), 'utf8');

    expect(source).not.toContain('Save to Obsidian');
    expect(source).not.toContain('Auto mode');
    expect(source).toContain('/api/obsidian-bridge/routing/preview');
    expect(source).toContain('/api/artifacts');
    expect(source).toContain('/send-to-obsidian');
    expect(source).toContain('\u5efa\u8bae\u4e0a\u4f20');
    expect(source).toContain('\u4e0d\u5efa\u8bae\u4e0a\u4f20');
    expect(source).toContain('\u4e0a\u4f20\u5230 Wiki');
    expect(source).toContain('\u5df2\u4e0a\u4f20\u5230 Wiki');
    expect(source).toContain('\u7531\u4f60\u51b3\u5b9a\u662f\u5426\u843d\u5e93');
    expect(source).not.toContain('session-summary');
    expect(source).not.toContain('chat-summary');
    expect(source).toContain('obsidianCaptureStatus');
    expect(source).toContain('routingModes');
    expect(source).toContain('obsidianTargets');
    expect(source).toContain('\u672a\u4fdd\u5b58');
    expect(source).toContain('\u5185\u5bb9\u4e0d\u50cf\u77e5\u8bc6\u6c89\u6dc0');
    expect(source).toContain('aiRoutingReason');
    expect(source).not.toContain('Matched default mode');
  });

  it('does not auto-submit assistant replies from the frontend pane', () => {
    const currentDir = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(resolve(currentDir, 'ChatMessagesPane.tsx'), 'utf8');

    expect(source).not.toContain('/api/obsidian-bridge/auto-capture-chat');
    expect(source).not.toContain('autoCaptureSentKeysRef');
  });
});
