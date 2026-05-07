import { describe, expect, it, vi } from 'vitest';

describe('obsidian bridge ingress service', () => {
  it('accepts loopback bearer-token imports and creates an Obsidian source artifact', async () => {
    const service = await import('../obsidian-bridge-ingress-service.js');
    const createArtifact = vi.fn(async (payload) => ({
      artifact: {
        id: 'artifact-1',
        ...payload,
      },
    }));
    const broadcast = vi.fn();

    const result = await service.handleObsidianIngress({
      action: 'send-selection',
      note: {
        vaultId: 'self',
        vaultName: 'Self',
        path: 'Argus/Projects/App/Plan.md',
        title: 'Plan',
        selection: 'Selected note text.',
        content: '# Plan\nFull note',
      },
    }, {
      createArtifact,
      broadcast,
    });

    expect(createArtifact).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'obsidian-selection',
      title: 'Plan',
      content: 'Selected note text.',
      metadata: expect.objectContaining({
        source: 'obsidian',
        action: 'send-selection',
        vaultName: 'Self',
        notePath: 'Argus/Projects/App/Plan.md',
      }),
    }), { autoExport: false });
    expect(broadcast).toHaveBeenCalledWith(expect.objectContaining({
      type: 'obsidian_inbox_item',
      action: 'send-selection',
      appendText: expect.stringContaining('Selected note text.'),
    }));
    expect(result).toMatchObject({
      success: true,
      artifact: { id: 'artifact-1' },
    });
  });

  it('rejects non-loopback ingress requests and wrong tokens', async () => {
    const service = await import('../obsidian-bridge-ingress-service.js');

    expect(() => service.assertLoopbackIngress({ ip: '10.0.0.5', socket: { remoteAddress: '10.0.0.5' } }))
      .toThrow(/loopback/i);
    expect(() => service.assertIngressToken({ authorization: 'Bearer wrong' }, 'right'))
      .toThrow(/Unauthorized/i);
    expect(() => service.assertIngressToken({ authorization: 'Bearer right' }, 'right')).not.toThrow();
  });
});
