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

test('Argus launch args use the model resolved from the selected profile env', async () => {
  const source = await readFile(claudeSdkSourcePath, 'utf8');
  const argsBlock = source.slice(
    source.indexOf('function buildMtlCodeArgs'),
    source.indexOf('function getMtlCodeConfigDir'),
  );

  expect(argsBlock).toContain('resolvedSessionModel');
  expect(argsBlock).toContain('env.ANTHROPIC_MODEL');
  expect(argsBlock).toContain("args.push('--model', resolvedSessionModel)");
});

test('chat runtime diagnostics and command options use the resolved model profile', async () => {
  const source = await readFile(serverIndexSourcePath, 'utf8');

  expect(source).toContain('const resolvedSessionModel');
  expect(source).toContain("model: resolvedSessionModel || data?.options?.model || ''");
  expect(source).toContain('options.model = resolvedSessionModel;');
});
