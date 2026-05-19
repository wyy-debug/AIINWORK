import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';

const sourcePath = join(dirname(fileURLToPath(import.meta.url)), 'ChatInterface.tsx');

test('chat runtime drawer exposes Brain diagnostics and gates panels through Debug settings', async () => {
  const source = await readFile(sourcePath, 'utf8');

  expect(source).toContain('AgentRuntimeDiagnosticsPanel');
  expect(source).toContain('showRuntimeTimelinePanel');
  expect(source).toContain('showCheckpointPanel');
  expect(source).toContain('showArgusBrainDiagnosticsPanel');

  const drawerStart = source.indexOf('{showPromptInjectionPanel && (');
  const drawerEnd = source.indexOf('<ChatComposer', drawerStart);
  const drawer = source.slice(drawerStart, drawerEnd);

  expect(drawer).toContain('{showPromptInjectionPanel && (');
  expect(drawer).toContain('{showRuntimeTimelinePanel && (');
  expect(drawer).toContain('{showCheckpointPanel && (');
  expect(drawer).toContain('{showArgusBrainDiagnosticsPanel && (');
  expect(drawer).toContain('<AgentRuntimeDiagnosticsPanel');
  expect(drawer).toContain('sessionId={selectedSession?.id || currentSessionId}');
  expect(drawer).toContain('projectName={selectedProject.name ||');
});
