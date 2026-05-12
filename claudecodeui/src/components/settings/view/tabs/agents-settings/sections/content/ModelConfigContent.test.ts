import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

describe('ModelConfigContent', () => {
  it('exposes a per-profile request model override for relay routing', () => {
    const currentFile = fileURLToPath(import.meta.url);
    const source = readFileSync(resolve(dirname(currentFile), 'ModelConfigContent.tsx'), 'utf8');

    expect(source).toContain('protocol');
    expect(source).toContain('请求协议');
    expect(source).toContain('Anthropic-compatible (/v1/messages)');
    expect(source).toContain('OpenAI-compatible (/v1/chat/completions)');
    expect(source).toContain('OpenAI Responses (/v1/responses)');
    expect(source).toContain('requestModel');
    expect(source).toContain('请求模型名覆盖');
    expect(source).toContain('中转站按模型名分流');
    expect(source).toContain('claudeNativeMemoryEnabled');
    expect(source).toContain('Claude 原生记忆');
    expect(source).toContain('Claude 原生记忆不可用');
  });
});
