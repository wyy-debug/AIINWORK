import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';

const currentDir = dirname(fileURLToPath(import.meta.url));
const chatRoot = resolve(currentDir, '..');

const readChatFile = (relativePath: string) =>
  readFile(join(chatRoot, relativePath), 'utf8');

test('chat sends prompt injection debug flag and renders the right-side debug panel', async () => {
  const [types, composerState, realtimeHandlers, chatInterface, debugSettings, webSocketContext] = await Promise.all([
    readChatFile('types/types.ts'),
    readChatFile('hooks/useChatComposerState.ts'),
    readChatFile('hooks/useChatRealtimeHandlers.ts'),
    readChatFile('view/ChatInterface.tsx'),
    readChatFile('utils/debugSettings.ts'),
    readFile(resolve(currentDir, '../../../contexts/WebSocketContext.tsx'), 'utf8'),
  ]);

  expect(types).toContain('PromptInjectionDebugPayload');
  expect(types).toContain('appendSystemPromptLength');
  expect(types).toContain('originalCommand');
  expect(types).toContain('effectiveCommand');
  expect(types).toContain('commandChanged');
  expect(composerState).toContain('debugPromptInjection');
  expect(composerState).toContain('getArgusDebugSettings');
  expect(composerState).toContain('buildPendingPromptInjectionDebug');
  expect(composerState).toContain('setPromptInjectionDebug');
  expect(composerState).toContain('Waiting for backend final launch');
  expect(composerState).toContain('ARGUS_PROMPT_INJECTION_DEBUG_EVENT');
  expect(composerState).toContain('window.dispatchEvent');
  expect(realtimeHandlers).toContain("prompt_injection_debug");
  expect(chatInterface).toContain('PromptInjectionDebugPanel');
  expect(chatInterface).toContain('showPromptInjectionPanel');
  expect(chatInterface).toContain('ARGUS_PROMPT_INJECTION_DEBUG_EVENT');
  expect(chatInterface).toContain('addEventListener');
  expect(debugSettings).toContain('ARGUS_PROMPT_INJECTION_DEBUG_EVENT');
  expect(webSocketContext).toContain('ARGUS_WEBSOCKET_MESSAGE_EVENT');
  expect(webSocketContext).toContain('window.dispatchEvent');
});

test('prompt injection debug panel renders original and effective commands', async () => {
  const panel = await readChatFile('view/subcomponents/PromptInjectionDebugPanel.tsx');

  expect(panel).toContain('effectiveCommand');
  expect(panel).toContain('originalCommand');
  expect(panel).toContain('Command sent to Claude');
  expect(panel).toContain('Original user command');
  expect(panel).toContain('Command changed');
  expect(panel).toContain('Command captured');
  expect(panel).toContain('copyValue');
  expect(panel).toContain('effectiveCommand || appendSystemPrompt');
});

test('local prompt debug events are filtered by active session', async () => {
  const chatInterface = (await readChatFile('view/ChatInterface.tsx')).replace(/\r\n/g, '\n');
  const handlerStart = chatInterface.indexOf('const handlePromptInjectionDebugEvent = (event: Event) => {');
  const handlerEnd = chatInterface.indexOf('const handleWebSocketMessageEvent = (event: Event) => {', handlerStart);
  const handlerBlock = chatInterface.slice(handlerStart, handlerEnd);

  expect(handlerBlock).toContain('payload.sessionId');
  expect(handlerBlock).toContain('activeViewSessionId');
  expect(handlerBlock).toContain('sid !== activeViewSessionId');
  expect(handlerBlock).toContain('!isTemporarySessionId(activeViewSessionId)');
  expect(handlerBlock).toContain('return;');
});
