import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';

const hooksDir = dirname(fileURLToPath(import.meta.url));

test('background stream deltas are accumulated instead of appended as standalone messages', async () => {
  const source = (await readFile(join(hooksDir, 'useChatRealtimeHandlers.ts'), 'utf8')).replace(/\r\n/g, '\n');
  const streamDeltaStart = source.indexOf("if (msg.kind === 'stream_delta')");
  const streamDeltaEnd = source.indexOf("if (msg.kind === 'stream_end')", streamDeltaStart);
  const streamDeltaBlock = source.slice(streamDeltaStart, streamDeltaEnd);

  expect(streamDeltaBlock).toContain('sessionStreamBuffersRef');
  expect(streamDeltaBlock).toContain('flushSessionStream(sid)');
  expect(streamDeltaBlock).not.toContain('sessionStore.appendRealtime(sid, msg as NormalizedMessage)');
});

test('session message loading ignores stale responses after switching sessions', async () => {
  const source = (await readFile(join(hooksDir, 'useChatSessionState.ts'), 'utf8')).replace(/\r\n/g, '\n');
  const effectStart = source.indexOf('// Main session loading effect - store-based');
  const effectEnd = source.indexOf('// External message update', effectStart);
  const effectBlock = source.slice(effectStart, effectEnd);

  expect(effectBlock).toContain('const requestSessionId = selectedSession.id');
  expect(effectBlock).toContain('let cancelled = false');
  expect(effectBlock).toContain('if (cancelled || activeSessionIdRef.current !== requestSessionId) return');
  expect(effectBlock).toContain('cancelled = true');
});

test('websocket reconnect resyncs active Claude permission approvals', async () => {
  const source = (await readFile(join(hooksDir, '..', 'view', 'ChatInterface.tsx'), 'utf8')).replace(/\r\n/g, '\n');
  const reconnectStart = source.indexOf('const handleWebSocketReconnect');
  const reconnectEnd = source.indexOf('useChatRealtimeHandlers', reconnectStart);
  const reconnectBlock = source.slice(reconnectStart, reconnectEnd);

  expect(reconnectBlock).toContain("type: 'check-session-status'");
  expect(reconnectBlock).toContain("type: 'get-pending-permissions'");
  expect(reconnectBlock).toContain("provider: 'claude'");
});

test('pending Claude permissions are reconsidered when global permission settings change', async () => {
  const source = (await readFile(join(hooksDir, '..', 'view', 'ChatInterface.tsx'), 'utf8')).replace(/\r\n/g, '\n');

  expect(source).toContain('claudeSettingsVersion');
  expect(source).toContain("window.addEventListener('claudeSettingsChanged'");

  const autoAllowStart = source.indexOf('const settings = getClaudeSettings()');
  const autoAllowEnd = source.indexOf('const permissionContextValue', autoAllowStart);
  const autoAllowBlock = source.slice(autoAllowStart, autoAllowEnd);

  expect(autoAllowBlock).toContain("permissionMode === 'bypassPermissions'");
  expect(autoAllowBlock).toContain('claudeSettingsVersion');
});
