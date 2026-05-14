import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const currentDir = dirname(fileURLToPath(import.meta.url));

describe('ChatInterface interactive permission tools', () => {
  it('keeps request_user_input out of auto-allow permission flows', () => {
    const source = readFileSync(resolve(currentDir, 'ChatInterface.tsx'), 'utf8');

    expect(source).toContain("const INTERACTIVE_PERMISSION_TOOLS = new Set([");
    expect(source).toContain("'request_user_input'");
    expect(source).toContain("!INTERACTIVE_PERMISSION_TOOLS.has(request.toolName)");
  });
});
