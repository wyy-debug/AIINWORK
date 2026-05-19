import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const indexSource = () => readFileSync(path.resolve(__dirname, '../../index.js'), 'utf8');

describe('context fusion runtime order', () => {
  it('applies uploaded files, profile/runtime prompt, and Argus Brain before final prompt dispatch', () => {
    const source = indexSource();

    expect(source).toMatch(/applyUploadedFilesToChatCommand/);
    expect(source).toMatch(/applyAgentRuntimeToChatCommand/);
    expect(source).toMatch(/applyAgentProfileRuntimeToChatCommand/);
    expect(source).toMatch(/applyBrainRuntimeToChatCommand/);
    expect(source).not.toMatch(/applyCodeGraphRuntimeToChatCommand/);
    expect(source).not.toMatch(/applyObsidianContextToChatCommand/);
  });
});
