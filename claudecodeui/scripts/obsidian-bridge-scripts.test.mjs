import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('Obsidian bridge scripts', () => {
  it('ships install, package, and smoke scripts through npm commands', async () => {
    const packageJson = JSON.parse(await readFile('package.json', 'utf8'));

    expect(packageJson.scripts).toMatchObject({
      'obsidian:install-bridge': 'node scripts/install-obsidian-bridge.mjs',
      'obsidian:package-bridge': 'node scripts/package-obsidian-bridge.mjs',
      'obsidian:smoke-bridge': 'node scripts/smoke-obsidian-bridge.mjs',
      'obsidian:mcp': 'node scripts/obsidian-bridge-mcp.mjs',
    });

    await expect(readFile('scripts/install-obsidian-bridge.mjs', 'utf8')).resolves.toContain("target: 'core.js'");
    await expect(readFile('scripts/package-obsidian-bridge.mjs', 'utf8')).resolves.toContain("target: 'core.js'");
    await expect(readFile('scripts/install-obsidian-bridge.mjs', 'utf8')).resolves.toContain('buildBundledMain');
    await expect(readFile('scripts/package-obsidian-bridge.mjs', 'utf8')).resolves.toContain('buildBundledMain');
    await expect(readFile('scripts/smoke-obsidian-bridge.mjs', 'utf8')).resolves.toContain('/argus/v1/status');
    await expect(readFile('scripts/obsidian-bridge-mcp.mjs', 'utf8')).resolves.toContain('@modelcontextprotocol/sdk');
    await expect(readFile('scripts/obsidian-bridge-mcp.mjs', 'utf8')).resolves.toContain('obsidian_active');
    await expect(readFile('scripts/obsidian-bridge-mcp.mjs', 'utf8')).resolves.toContain('obsidian_patch');
  });
});
