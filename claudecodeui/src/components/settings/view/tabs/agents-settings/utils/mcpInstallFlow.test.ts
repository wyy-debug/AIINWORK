import { describe, expect, it } from 'vitest';

import { emptyMcpConfiguration, shouldPromptForMcpSetup } from './mcpInstallFlow';

describe('mcpInstallFlow', () => {
  it('prompts for setup only on first install, not on update', () => {
    const setupFields = [{ key: 'CRASHSIGHT_OPENAPI_KEY' }];

    expect(shouldPromptForMcpSetup('install', setupFields)).toBe(true);
    expect(shouldPromptForMcpSetup('update', setupFields)).toBe(false);
  });

  it('uses empty MCP values so the backend can reuse existing config or process env', () => {
    expect(emptyMcpConfiguration()).toEqual({ mcpValues: {} });
  });
});
