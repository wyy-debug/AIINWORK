import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';

const chatDir = dirname(fileURLToPath(import.meta.url));

test('chat markdown file references are clickable and expose local context actions', async () => {
  const [markdownSource, messageSource, toolRendererSource, planDisplaySource] = await Promise.all([
    readFile(join(chatDir, 'subcomponents', 'Markdown.tsx'), 'utf8'),
    readFile(join(chatDir, 'subcomponents', 'MessageComponent.tsx'), 'utf8'),
    readFile(join(chatDir, '..', 'tools', 'ToolRenderer.tsx'), 'utf8'),
    readFile(join(chatDir, '..', 'tools', 'components', 'PlanDisplay.tsx'), 'utf8'),
  ]);

  expect(markdownSource).toContain('parseInlineFileReference');
  expect(markdownSource).toContain('InlineFileReference');
  expect(markdownSource).toContain('onContextMenu');
  expect(markdownSource).toContain('api.openLocalToolFile');
  expect(markdownSource).toContain('api.localTools');
  expect(markdownSource).toContain('api.openLocalPath');
  expect(markdownSource).toContain('copyTextToClipboard');
  expect(markdownSource).toContain('openInDefaultLocalEditor');
  expect(markdownSource).toContain('FileReferenceIcon');
  expect(markdownSource).toContain('formatInlineFileReferenceLabel');
  expect(markdownSource).toContain('openInVSCode');
  expect(markdownSource).toContain('copyPath');
  expect(markdownSource).toContain('revealInExplorer');
  expect(messageSource).toContain('onFileOpen={onFileOpen}');
  expect(messageSource).toContain('projectName={selectedProject?.name}');
  expect(toolRendererSource).toContain('projectName={selectedProject?.name}');
  expect(planDisplaySource).toContain('projectName={projectName}');
});
