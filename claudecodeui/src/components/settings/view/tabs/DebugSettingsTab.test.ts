import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';

const currentDir = dirname(fileURLToPath(import.meta.url));
const settingsRoot = resolve(currentDir, '../..');

const readSettingsFile = (relativePath: string) =>
  readFile(join(settingsRoot, relativePath), 'utf8');

test('settings expose a top-level Debug tab for runtime panel visibility', async () => {
  const [types, constants, sidebar, settings, controller, debugTab, debugSettings] = await Promise.all([
    readSettingsFile('types/types.ts'),
    readSettingsFile('constants/constants.ts'),
    readSettingsFile('view/SettingsSidebar.tsx'),
    readSettingsFile('view/Settings.tsx'),
    readSettingsFile('hooks/useSettingsController.ts'),
    readFile(resolve(currentDir, 'DebugSettingsTab.tsx'), 'utf8'),
    readFile(resolve(currentDir, '../../../chat/utils/debugSettings.ts'), 'utf8'),
  ]);

  expect(types).toContain("'debug'");
  expect(constants).toContain("'debug'");
  expect(sidebar).toContain("defaultLabel: 'Debug'");
  expect(settings).toContain('DebugSettingsTab');
  expect(controller).toContain('argusDebugSettings');
  expect(debugTab).toContain('saveArgusDebugSettings');
  expect(debugTab).toContain('Runtime panel visibility');
  expect(debugTab).toContain('Prompt Debug');
  expect(debugTab).toContain('Runtime Timeline');
  expect(debugTab).toContain('Checkpoints');
  expect(debugTab).toContain('Argus Brain Diagnostics');
  expect(debugSettings).toContain('showPromptInjectionPanel');
  expect(debugSettings).toContain('showRuntimeTimelinePanel');
  expect(debugSettings).toContain('showCheckpointPanel');
  expect(debugSettings).toContain('showArgusBrainDiagnosticsPanel');
  expect(debugSettings).toContain('argus-debug-settings');
  expect(debugSettings).toContain('argusDebugSettingsChanged');
});
