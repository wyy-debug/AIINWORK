import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  createCapabilityMarketplaceStore,
  getBuiltInEnterpriseCapabilities,
  normalizeCapabilityMarketplaceItem,
} from '../capability-marketplace-service.js';

describe('capability marketplace service', () => {
  let rootDir;

  beforeEach(async () => {
    rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mtl-capability-marketplace-'));
  });

  afterEach(async () => {
    await fs.rm(rootDir, { recursive: true, force: true });
  });

  it('normalizes skills and MCP servers into one marketplace item shape', () => {
    const skill = normalizeCapabilityMarketplaceItem({
      kind: 'skill',
      id: 'code-review',
      name: 'Code Review',
      description: 'Review code changes',
      dependencies: { mcpServers: ['gitnexus'] },
    });
    const mcp = normalizeCapabilityMarketplaceItem({
      kind: 'mcp-server',
      id: 'redmine',
      name: 'Redmine',
      setupFields: [{ key: 'REDMINE_URL', label: 'URL', required: true }],
    });

    expect(skill).toMatchObject({
      id: 'skill-code-review',
      kind: 'skill',
      installState: 'available',
      enabled: false,
    });
    expect(skill.dependencies.mcpServers).toEqual(['gitnexus']);
    expect(mcp).toMatchObject({
      id: 'mcp-server-redmine',
      kind: 'mcp-server',
      setupRequired: true,
    });
  });

  it('includes built-in local enterprise capabilities', () => {
    const ids = getBuiltInEnterpriseCapabilities().map((item) => item.id);

    expect(ids).toContain('mcp-server-redmine');
    expect(ids).toContain('mcp-server-wechat');
    expect(ids).toContain('mcp-server-crashsight');
    expect(ids).toContain('mcp-server-internal-code-search');
  });

  it('combines built-in, repository, installed skill, and installed MCP entries', async () => {
    const store = createCapabilityMarketplaceStore({ rootDir });
    const catalog = await store.listMarketplace({
      repositoryItems: [
        { kind: 'skill', id: 'skill-code-review', name: 'Code Review', repoId: 'local' },
        { kind: 'mcp-server', id: 'mcp-server-redmine', name: 'Redmine', repoId: 'local' },
      ],
      installedSkills: [
        { name: 'code-review', title: 'Code Review', provider: 'codex', scope: 'user', callable: true },
      ],
      installedMcpServers: [
        { name: 'redmine', provider: 'claude', scope: 'user' },
      ],
    });

    const codeReview = catalog.items.find((item) => item.id === 'skill-code-review');
    const redmine = catalog.items.find((item) => item.id === 'mcp-server-redmine');
    expect(codeReview.installState).toBe('installed');
    expect(codeReview.enabled).toBe(true);
    expect(redmine.installState).toBe('installed');
    expect(redmine.enabled).toBe(true);
  });

  it('persists enable and disable state by marketplace item id', async () => {
    const store = createCapabilityMarketplaceStore({ rootDir });

    await store.setEnabled('mcp-server-crashsight', true);
    expect((await store.getState()).enabled['mcp-server-crashsight']).toBe(true);
    await store.setEnabled('mcp-server-crashsight', false);
    expect((await store.getState()).enabled['mcp-server-crashsight']).toBe(false);
  });

  it('persists install and configuration state for marketplace items', async () => {
    const store = createCapabilityMarketplaceStore({ rootDir });

    await store.installCapability('mcp-server-crashsight', {
      scope: 'project',
      configuration: { CRASHSIGHT_TOKEN: 'configured-token' },
    });
    const state = await store.getState();
    expect(state.installed['mcp-server-crashsight']).toMatchObject({ scope: 'project' });
    expect(state.configurations['mcp-server-crashsight']).toEqual({ CRASHSIGHT_TOKEN: 'configured-token' });

    const catalog = await store.listMarketplace();
    const crashsight = catalog.items.find((item) => item.id === 'mcp-server-crashsight');
    expect(crashsight.installState).toBe('installed');
    expect(crashsight.configurationStatus).toBe('ready');
  });

  it('keeps installed marketplace items disabled when the user turns them off', async () => {
    const store = createCapabilityMarketplaceStore({ rootDir });

    await store.installCapability('mcp-server-crashsight', {
      configuration: { CRASHSIGHT_TOKEN: 'configured-token' },
    });
    await store.setEnabled('mcp-server-crashsight', false);

    const catalog = await store.listMarketplace();
    const crashsight = catalog.items.find((item) => item.id === 'mcp-server-crashsight');
    expect(crashsight.installState).toBe('installed');
    expect(crashsight.enabled).toBe(false);
  });
});
