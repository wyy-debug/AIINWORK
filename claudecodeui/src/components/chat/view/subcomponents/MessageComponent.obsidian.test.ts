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
    expect(source).not.toContain('\u7531\u4f60\u51b3\u5b9a\u662f\u5426\u843d\u5e93');
    expect(source).toContain('obsidianBridgeEnabled');
    expect(source).toContain('isLatestAssistantReply');
    expect(source).not.toContain('session-summary');
    expect(source).not.toContain('chat-summary');
    expect(source).toContain('obsidianCaptureStatus');
    expect(source).toContain('obsidianContextStatus');
    expect(source).toContain('\u5df2\u6ce8\u5165');
    expect(source).toContain('Wiki \u4e0a\u4e0b\u6587');
    expect(source).toContain('obsidian://open');
    expect(source).toContain('vaultName');
    expect(source).toContain("params.set('vault'");
    expect(source).toContain("params.set('file'");
    expect(source).toContain('summaryType');
    expect(source).toContain('routingModes');
    expect(source).toContain('obsidianTargets');
    expect(source).toContain('\u672a\u4fdd\u5b58');
    expect(source).toContain('\u5185\u5bb9\u4e0d\u50cf\u77e5\u8bc6\u6c89\u6dc0');
    expect(source).toContain('aiRoutingReason');
    expect(source).not.toContain('Matched default mode');
  });

  it('only offers chat Wiki upload on the latest finished reply while Obsidian is enabled', () => {
    const currentDir = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(resolve(currentDir, 'MessageComponent.tsx'), 'utf8');

    expect(source).toMatch(/const shouldOfferWikiUpload = obsidianBridgeEnabled\s*&& isLatestAssistantReply[\s\S]*?message\.type === 'assistant'/);
    expect(source).toMatch(/const shouldShowObsidianContextStatus = obsidianBridgeEnabled[\s\S]*?message\.type === 'user'[\s\S]*?Boolean\(obsidianContextStatus\)/);
  });

  it('passes Obsidian visibility from the chat pane and hides attachment ingest UI when disabled', () => {
    const currentDir = dirname(fileURLToPath(import.meta.url));
    const paneSource = readFileSync(resolve(currentDir, 'ChatMessagesPane.tsx'), 'utf8');
    const composerSource = readFileSync(resolve(currentDir, 'ChatComposer.tsx'), 'utf8');
    const interfaceSource = readFileSync(resolve(currentDir, '..', 'ChatInterface.tsx'), 'utf8');
    const realtimeSource = readFileSync(resolve(currentDir, '..', '..', 'hooks', 'useChatRealtimeHandlers.ts'), 'utf8');
    const composerStateSource = readFileSync(resolve(currentDir, '..', '..', 'hooks', 'useChatComposerState.ts'), 'utf8');

    expect(paneSource).toContain('latestAssistantReplyKey');
    expect(paneSource).toContain('obsidianBridgeEnabled');
    expect(paneSource).toContain('isLatestAssistantReply={!isSessionRunning');
    expect(composerSource).toContain('obsidianBridgeEnabled && attachedFiles.length > 0');
    expect(interfaceSource).toContain('/settings/obsidian-bridge');
    expect(interfaceSource).toContain('obsidianBridgeEnabled={obsidianBridgeEnabled}');
    expect(composerStateSource).toContain('obsidianBridgeEnabled && ingestAttachmentsToObsidian');
    expect(realtimeSource).toContain("msg.text === 'obsidian_context_result'");
  });

  it('emits Obsidian context as a silent event rather than a visible runtime status', () => {
    const currentDir = dirname(fileURLToPath(import.meta.url));
    const serverSource = readFileSync(resolve(currentDir, '..', '..', '..', '..', '..', 'server', 'index.js'), 'utf8');

    expect(serverSource).toContain("event: 'obsidian_context_result'");
    expect(serverSource).not.toContain("text: 'obsidian_context_result'");
  });

  it('does not auto-submit assistant replies from the frontend pane', () => {
    const currentDir = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(resolve(currentDir, 'ChatMessagesPane.tsx'), 'utf8');

    expect(source).not.toContain('/api/obsidian-bridge/auto-capture-chat');
    expect(source).not.toContain('autoCaptureSentKeysRef');
  });
});
