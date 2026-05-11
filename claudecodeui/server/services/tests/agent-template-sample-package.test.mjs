import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { normalizeAgentTemplateManifest } from '../agent-template-manifest-service.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');

describe('sample agent-template package', () => {
  it('ships a valid distributable subagent review package', async () => {
    const manifestPath = path.join(repoRoot, 'examples/agent-templates/subagent-review-pack/manifest.json');
    const manifest = normalizeAgentTemplateManifest(JSON.parse(await readFile(manifestPath, 'utf8')));

    expect(manifest).toMatchObject({
      id: 'subagent-review-pack',
      kind: 'agent-template',
      runtime: {
        tools: ['Read', 'Grep', 'Bash'],
      },
    });
    expect(manifest.dialogs.setup?.presets?.length).toBeGreaterThan(0);
    expect(manifest.dialogs.launch?.presets?.length).toBeGreaterThan(0);
    expect(manifest.dialogs.result?.presets?.length).toBeGreaterThan(0);
    expect(manifest.dependencies.skills?.[0]).toMatchObject({ name: 'code-review-security' });
  });
});
