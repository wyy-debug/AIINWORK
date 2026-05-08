import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

describe('Small model settings content', () => {
  it('adds a dedicated small model tab to Agent settings', () => {
    const currentFile = fileURLToPath(import.meta.url);
    const settingsTypes = readFileSync(resolve(dirname(currentFile), '../../../../../types/types.ts'), 'utf8');
    const constants = readFileSync(resolve(dirname(currentFile), '../../../../../constants/constants.ts'), 'utf8');
    const tabs = readFileSync(resolve(dirname(currentFile), '../AgentCategoryTabsSection.tsx'), 'utf8');
    const content = readFileSync(resolve(dirname(currentFile), '../AgentCategoryContentSection.tsx'), 'utf8');

    expect(settingsTypes).toContain("'small-model'");
    expect(constants).toContain("'small-model'");
    expect(tabs).toContain('小模型');
    expect(content).toContain('SmallModelConfigContent');
    expect(content).toContain("selectedCategory === 'small-model'");
  });

  it('exposes the expected small model controls and test API', () => {
    const currentFile = fileURLToPath(import.meta.url);
    const source = readFileSync(resolve(dirname(currentFile), 'SmallModelConfigContent.tsx'), 'utf8');

    expect(source).toContain('/api/settings/mtl-code-model');
    expect(source).toContain('/api/settings/small-model/test');
    expect(source).not.toContain('Protocol');
    expect(source).not.toContain('Anthropic-compatible (/v1/messages)');
    expect(source).not.toContain('OpenAI-compatible (/v1/chat/completions)');
    expect(source).not.toContain('请求模型名覆盖');
    expect(source).toContain('启用小模型');
    expect(source).toContain('自动选择');
    expect(source).toContain('用于 Wiki/Obsidian 自动分类');
    expect(source).toContain('用于 Wiki 回读注入筛选');
    expect(source).toContain('测试小模型');
  });
});
