import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';

const sourcePath = join(dirname(fileURLToPath(import.meta.url)), 'ChatInterface.tsx');
const claudeSdkSourcePath = join(dirname(fileURLToPath(import.meta.url)), '../../../../server/claude-sdk.js');
const serverIndexSourcePath = join(dirname(fileURLToPath(import.meta.url)), '../../../../server/index.js');

test('project binding load does not rerun just because the selected model profile changes', async () => {
  const source = await readFile(sourcePath, 'utf8');
  const effectStart = source.indexOf("if (!projectSkillBindingEnabled || !activeConversationSessionId)");
  const effectEnd = source.indexOf("previousProjectSkillCurrentSessionIdRef.current = currentSessionId", effectStart + 1);
  const effectBlock = source.slice(effectStart, effectEnd);

  expect(effectBlock).toContain('selectedModelProfileIdRef.current');
  expect(effectBlock).not.toContain('selectedModelProfileId))');
  expect(effectBlock).not.toContain('selectedModelProfileId, selectedSession?.id');
});

test('project skill selection survives concrete session id hydration but resets for a new conversation', async () => {
  const source = (await readFile(sourcePath, 'utf8')).replace(/\r\n/g, '\n');
  const clearEffectStart = source.indexOf('useEffect(() => {\n    if (agentBindingEnabled) {\n      return;\n    }\n    setSelectedProjectSkillNames([]);');
  const clearEffectEnd = source.indexOf('useEffect(() => {\n    if (!isWorktreeProject', clearEffectStart);
  const clearEffectBlock = source.slice(clearEffectStart, clearEffectEnd);

  expect(clearEffectBlock).toContain('setSelectedProjectSkillNames([])');
  expect(clearEffectBlock).toContain('selectedProject?.name');
  expect(clearEffectBlock).not.toContain('selectedSession?.id');

  const newConversationEffectStart = source.indexOf('const requestId = isConversationSpace ? newConversationRequestId : newProjectSessionRequestId;');
  const newConversationEffectEnd = source.indexOf('useEffect(() => {\n    if (agentBindingEnabled)', newConversationEffectStart);
  const newConversationEffectBlock = source.slice(newConversationEffectStart, newConversationEffectEnd);

  expect(newConversationEffectBlock).toContain('newProjectSessionRequestId');
  expect(newConversationEffectBlock).toContain('setSelectedProjectSkillNames([])');
});

test('conversation agent binding loader does not rerun from local Agent or Skill edits', async () => {
  const source = (await readFile(sourcePath, 'utf8')).replace(/\r\n/g, '\n');
  const loadStart = source.indexOf('const loadSessionAgent = async () => {');
  const effectStart = source.lastIndexOf('useEffect(() => {', loadStart);
  const effectEnd = source.indexOf('useEffect(() => {\n    if (!selectedAgentId)', effectStart);
  const effectBlock = source.slice(effectStart, effectEnd);
  const dependencyStart = effectBlock.lastIndexOf('}, [');
  const dependencies = effectBlock.slice(dependencyStart);

  expect(effectBlock).toContain('loadSessionAgent');
  expect(dependencies).not.toContain('selectedAgentId');
  expect(dependencies).not.toContain('selectedSessionSkillNames.length');
  expect(dependencies).not.toContain('agentChoiceState');
});

test('Argus launch args use the model resolved from the selected profile env', async () => {
  const source = await readFile(claudeSdkSourcePath, 'utf8');
  const argsBlock = source.slice(
    source.indexOf('function buildMtlCodeArgs'),
    source.indexOf('function getMtlCodeConfigDir'),
  );

  expect(argsBlock).toContain('resolvedSessionModel');
  expect(argsBlock).toContain('ANTHROPIC_MODEL_ENV_KEYS.model');
  expect(argsBlock).toContain('OPENAI_MODEL_ENV_KEYS.model');
  expect(argsBlock).toContain("args.push('--model', resolvedSessionModel)");
});

test('chat runtime diagnostics and command options use the resolved model profile', async () => {
  const source = await readFile(serverIndexSourcePath, 'utf8');

  expect(source).toContain('const resolvedSessionModel');
  expect(source).toContain("model: resolvedSessionModel || data?.options?.model || ''");
  expect(source).toContain('options.model = resolvedSessionModel;');
});

test('MCP diagnostics validate selected MCP servers against runtime config', async () => {
  const source = await readFile(serverIndexSourcePath, 'utf8');

  expect(source).toContain('collectConfiguredMcpServerNames');
  expect(source).toContain('summarizeMcpBindings(bindings = [], projectPath =');
  expect(source).toContain('runtimeToolsStatus: configuredServers.has(serverName)');
  expect(source).toContain('selected MCP server is not present in the runtime config');
});
