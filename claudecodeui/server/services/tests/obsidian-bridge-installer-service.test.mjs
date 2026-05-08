import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

describe('obsidian bridge installer service', () => {
  let service;
  let tempRoot;

  beforeEach(async () => {
    service = await import('../obsidian-bridge-installer-service.js');
    tempRoot = await mkdtemp(join(tmpdir(), 'argus-obsidian-installer-'));
  });

  it('discovers Obsidian vaults from the desktop config and reports install state', async () => {
    const vaultPath = join(tempRoot, 'Team Vault');
    await mkdir(join(vaultPath, '.obsidian', 'plugins', 'argus-bridge'), { recursive: true });
    await writeFile(join(vaultPath, '.obsidian', 'plugins', 'argus-bridge', 'manifest.json'), '{"version":"0.1.0"}', 'utf8');
    const configPath = join(tempRoot, 'obsidian.json');
    await writeFile(configPath, JSON.stringify({
      vaults: {
        one: {
          path: vaultPath,
          name: 'Team Vault',
          open: true,
        },
      },
    }), 'utf8');

    await expect(service.listObsidianVaults({ obsidianConfigPath: configPath })).resolves.toEqual([
      expect.objectContaining({
        name: 'Team Vault',
        path: resolve(vaultPath),
        open: true,
        hasObsidianConfig: true,
        pluginInstalled: true,
        pluginVersion: '0.1.0',
      }),
    ]);
  });

  it('installs the bundled plugin files, token, and community plugin entry into a vault', async () => {
    const vaultPath = join(tempRoot, 'Install Vault');
    await mkdir(join(vaultPath, '.obsidian'), { recursive: true });

    const result = await service.installObsidianBridgePlugin({
      vaultPath,
      token: 'install-token',
      enablePlugin: true,
    });

    expect(result).toMatchObject({
      pluginId: 'argus-bridge',
      token: 'install-token',
      tokenConfigured: true,
      installed: true,
      targetDir: join(resolve(vaultPath), '.obsidian', 'plugins', 'argus-bridge'),
    });

    await expect(readFile(join(result.targetDir, 'manifest.json'), 'utf8')).resolves.toContain('"argus-bridge"');
    await expect(readFile(join(result.targetDir, 'main.js'), 'utf8')).resolves.toContain('__argusBridgeCoreModule');
    await expect(readFile(join(result.targetDir, 'core.js'), 'utf8')).resolves.toContain('module.exports');
    await expect(readFile(join(result.targetDir, 'data.json'), 'utf8')).resolves.toContain('install-token');
    await expect(readFile(join(resolve(vaultPath), '.obsidian', 'community-plugins.json'), 'utf8')).resolves.toContain('argus-bridge');
  });

  it('assigns the next available local port when installing additional vaults', async () => {
    const vaultPath = join(tempRoot, 'Second Vault');
    await mkdir(join(vaultPath, '.obsidian'), { recursive: true });

    const result = await service.installObsidianBridgePlugin({
      vaultPath,
      token: 'second-token',
      usedPorts: [27177, 27178],
    });

    expect(result.endpoint).toBe('http://127.0.0.1:27179');
    await expect(readFile(join(result.targetDir, 'data.json'), 'utf8')).resolves.toContain('"port": 27179');
  });

  it('resolves the bundled plugin source from a packaged Electron app layout', async () => {
    const appRoot = join(tempRoot, 'resources', 'app');
    const pluginSource = join(appRoot, 'obsidian-plugins', 'argus-bridge');
    await mkdir(pluginSource, { recursive: true });

    expect(await service.resolveObsidianBridgePluginSource({
      serviceDirectory: join(appRoot, 'dist-server', 'server', 'services'),
    })).toBe(pluginSource);
  });

  it('includes the Obsidian plugin source directory in the Electron package files', async () => {
    const packageJson = JSON.parse(await readFile(resolve('package.json'), 'utf8'));
    expect(packageJson.build.files).toContain('obsidian-plugins/**');
  });

  afterEach(async () => {
    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});
