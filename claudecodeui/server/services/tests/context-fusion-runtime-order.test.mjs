import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const indexSource = () => readFileSync(path.resolve(__dirname, '../../index.js'), 'utf8');

describe('context fusion runtime order', () => {
  it('applies Obsidian Wiki Context before CodeGraph and Argus Brain before final prompt dispatch', () => {
    const source = indexSource();

    expect(source).toMatch(/applyCodeGraphRuntimeToChatCommand\(\s*await applyObsidianContextToChatCommand\(withWikiIntent\)/);
    expect(source).toMatch(/applyBrainRuntimeToChatCommand\(await applyObsidianKnowledgeRuntimeToChatCommand/);
  });
});
