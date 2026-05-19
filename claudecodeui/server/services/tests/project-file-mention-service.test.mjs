import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

describe('project file mention search', () => {
  it('returns matching folders alongside files and keeps folder mentions slash-terminated', async () => {
    const { searchProjectMentionEntries } = await import('../project-file-mention-service.js');
    const root = await mkdtemp(path.join(os.tmpdir(), 'argus-mention-folders-'));
    await mkdir(path.join(root, 'SocClient', 'Assets', 'Scripts'), { recursive: true });
    await mkdir(path.join(root, 'SocClient', 'Assets', 'Shaders'), { recursive: true });
    await writeFile(path.join(root, 'SocClient', 'Assets', 'Scripts', 'Player.cs'), 'class Player {}', 'utf8');

    const results = await searchProjectMentionEntries(root, 'Assets', 10);

    expect(results).toContainEqual(expect.objectContaining({
      name: 'Assets',
      type: 'directory',
      path: 'SocClient/Assets/',
      relativePath: 'SocClient/Assets/',
    }));
    expect(results).toContainEqual(expect.objectContaining({
      name: 'Player.cs',
      type: 'file',
      path: 'SocClient/Assets/Scripts/Player.cs',
      relativePath: 'SocClient/Assets/Scripts/Player.cs',
    }));
  });

  it('does not return ignored dependency folders as @ mention candidates', async () => {
    const { searchProjectMentionEntries } = await import('../project-file-mention-service.js');
    const root = await mkdtemp(path.join(os.tmpdir(), 'argus-mention-ignored-'));
    await mkdir(path.join(root, 'node_modules', 'pkg'), { recursive: true });
    await mkdir(path.join(root, 'src'), { recursive: true });
    await writeFile(path.join(root, 'src', 'index.ts'), 'export {};', 'utf8');

    const results = await searchProjectMentionEntries(root, '', 20);

    expect(results.map((entry) => entry.path)).not.toContain('node_modules/');
    expect(results.map((entry) => entry.path)).not.toContain('node_modules/pkg/');
  });

  it('resolves Unity-style logical asset paths by unique project suffix', async () => {
    const { findProjectPathsBySuffix } = await import('../project-file-mention-service.js');
    const root = await mkdtemp(path.join(os.tmpdir(), 'argus-mention-suffix-'));
    await mkdir(path.join(root, 'SocClient', 'Assets', 'Weapon', 'Accessory', 'Scope', 'Materials'), { recursive: true });
    await writeFile(
      path.join(root, 'SocClient', 'Assets', 'Weapon', 'Accessory', 'Scope', 'Materials', 'Aim.mat'),
      'material',
      'utf8',
    );

    const results = await findProjectPathsBySuffix(root, 'Weapon/Accessory/Scope/Materials/Aim.mat', 5);

    expect(results).toEqual([{
      absolutePath: path.join(root, 'SocClient', 'Assets', 'Weapon', 'Accessory', 'Scope', 'Materials', 'Aim.mat'),
      relativePath: 'SocClient/Assets/Weapon/Accessory/Scope/Materials/Aim.mat',
      type: 'file',
    }]);
  });

  it('does not silently choose one path when a basename suffix is ambiguous', async () => {
    const { findProjectPathsBySuffix } = await import('../project-file-mention-service.js');
    const root = await mkdtemp(path.join(os.tmpdir(), 'argus-mention-ambiguous-'));
    await mkdir(path.join(root, 'Assets', 'A'), { recursive: true });
    await mkdir(path.join(root, 'Assets', 'B'), { recursive: true });
    await writeFile(path.join(root, 'Assets', 'A', 'Config.mat'), 'a', 'utf8');
    await writeFile(path.join(root, 'Assets', 'B', 'Config.mat'), 'b', 'utf8');

    const results = await findProjectPathsBySuffix(root, 'Config.mat', 5);

    expect(results.map((entry) => entry.relativePath).sort()).toEqual([
      'Assets/A/Config.mat',
      'Assets/B/Config.mat',
    ]);
  });
});
