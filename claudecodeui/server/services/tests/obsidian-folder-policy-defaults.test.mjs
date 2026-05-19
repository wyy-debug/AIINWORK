import { describe, expect, it } from 'vitest';

describe('Obsidian folder policy defaults', () => {
  it('defaults bridge readback to Wiki and indexes instead of AIMemory', async () => {
    const service = await import('../obsidian-bridge-service.js');

    expect(service.DEFAULT_OBSIDIAN_BRIDGE_CONFIG.readableVaultFolders).toEqual([
      'Argus/Wiki',
      'Argus/_Indexes',
    ]);
    expect(service.DEFAULT_OBSIDIAN_BRIDGE_CONFIG.aiMemoryReadbackEnabled).toBe(false);
  });
});
