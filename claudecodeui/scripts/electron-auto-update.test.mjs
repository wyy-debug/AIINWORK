import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  findLatestInstaller,
  readUpdateManifest,
  maybePromptForStartupUpdate,
  resolveConfiguredUpdateDir,
} from '../electron/auto-update-service.mjs';

describe('electron auto update service', () => {
  it('skips startup update checks when no update directory is configured', async () => {
    const opened = [];
    const result = await maybePromptForStartupUpdate({
      currentVersion: '1.30.5',
      env: {},
      app: { isPackaged: true, quit: () => opened.push('quit') },
      dialog: { showMessageBox: async () => ({ response: 0 }) },
      shell: { openPath: async (target) => opened.push(target) },
    });

    expect(result).toEqual({ checked: false, reason: 'not_configured' });
    expect(opened).toEqual([]);
  });

  it('finds the newest installer above the current version', async () => {
    const updateDir = await makeUpdateDir([
      'Argus-1.30.4-x64.exe',
      'Argus-1.30.6-x64.exe',
      'Argus-1.31.0-x64.exe.blockmap',
      'Argus-1.30.7-x64.exe',
      'notes.txt',
    ]);

    const latest = await findLatestInstaller({ updateDir, currentVersion: '1.30.5' });

    expect(latest).toMatchObject({
      version: '1.30.7',
      fileName: 'Argus-1.30.7-x64.exe',
      filePath: path.join(updateDir, 'Argus-1.30.7-x64.exe'),
    });
  });

  it('reads update metadata from JSON and XML manifests', async () => {
    const json = await readUpdateManifest({
      manifestLocation: 'memory://latest.json',
      fetchText: async () => JSON.stringify({
        version: '1.30.6',
        url: 'file:///releases/Argus-1.30.6-x64.exe',
        sha256: 'abc123',
      }),
    });
    const xml = await readUpdateManifest({
      manifestLocation: 'memory://latest.xml',
      fetchText: async () => [
        '<release>',
        '<version>1.30.7</version>',
        '<url>file:///releases/Argus-1.30.7-x64.exe</url>',
        '<sha256>def456</sha256>',
        '</release>',
      ].join(''),
    });

    expect(json).toMatchObject({
      version: '1.30.6',
      installerUrl: 'file:///releases/Argus-1.30.6-x64.exe',
      sha256: 'abc123',
    });
    expect(xml).toMatchObject({
      version: '1.30.7',
      installerUrl: 'file:///releases/Argus-1.30.7-x64.exe',
      sha256: 'def456',
    });
  });

  it('downloads the manifest installer to a local cache before launching it', async () => {
    const releaseDir = await fsTempDir();
    const userDataDir = await fsTempDir();
    const installerPath = path.join(releaseDir, 'Argus-1.30.6-x64.exe');
    const installerBytes = 'fake installer bytes';
    await writeFile(installerPath, installerBytes);
    const manifestPath = path.join(releaseDir, 'latest.json');
    await writeFile(manifestPath, JSON.stringify({
      version: '1.30.6',
      url: installerPath,
      sha256: createHash('sha256').update(installerBytes).digest('hex'),
    }));
    const calls = [];

    const result = await maybePromptForStartupUpdate({
      currentVersion: '1.30.5',
      env: { ARGUS_UPDATE_MANIFEST_PATH: manifestPath },
      app: {
        isPackaged: true,
        getPath: (name) => {
          expect(name).toBe('userData');
          return userDataDir;
        },
        quit: () => calls.push(['quit']),
      },
      dialog: {
        showMessageBox: async () => ({ response: 0 }),
      },
      shell: { openPath: async (target) => calls.push(['openPath', target]) },
    });

    const cachedInstaller = path.join(userDataDir, 'updates', 'Argus-1.30.6-x64.exe');
    expect(result).toMatchObject({ checked: true, updateAvailable: true, launched: true });
    expect(calls).toEqual([
      ['openPath', cachedInstaller],
      ['quit'],
    ]);
    expect(await readFile(cachedInstaller, 'utf8')).toBe(installerBytes);
  });

  it('prompts once and launches the newer installer when the user accepts', async () => {
    const updateDir = await makeUpdateDir(['Argus-1.30.6-x64.exe']);
    const userDataDir = await fsTempDir();
    const calls = [];

    const result = await maybePromptForStartupUpdate({
      currentVersion: '1.30.5',
      env: { ARGUS_UPDATE_DIR: updateDir },
      app: {
        isPackaged: true,
        getPath: () => userDataDir,
        quit: () => calls.push(['quit']),
      },
      dialog: {
        showMessageBox: async (...args) => {
          expect(args).toHaveLength(1);
          const [options] = args;
          calls.push(['dialog', options.message]);
          return { response: 0 };
        },
      },
      shell: { openPath: async (target) => calls.push(['openPath', target]) },
    });

    const cachedInstaller = path.join(userDataDir, 'updates', 'Argus-1.30.6-x64.exe');
    expect(result).toMatchObject({ checked: true, updateAvailable: true, launched: true });
    expect(calls).toEqual([
      ['dialog', '发现 Argus 新版本 1.30.6'],
      ['openPath', cachedInstaller],
      ['quit'],
    ]);
    expect(await readFile(cachedInstaller, 'utf8')).toBe('');
  });

  it('normalizes the configured update directory from supported env names', () => {
    expect(resolveConfiguredUpdateDir({ ARGUS_UPDATE_DIR: '  Z:\\Argus  ' })).toBe('Z:\\Argus');
    expect(resolveConfiguredUpdateDir({ ARGUS_AUTO_UPDATE_DIR: '\\\\nas\\argus' })).toBe('\\\\nas\\argus');
  });
});

async function makeUpdateDir(fileNames) {
  const dir = await fsTempDir();
  await Promise.all(fileNames.map((fileName) => writeFile(path.join(dir, fileName), '')));
  return dir;
}

async function fsTempDir() {
  const dir = path.join(os.tmpdir(), `argus-auto-update-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  await mkdir(dir, { recursive: true });
  return dir;
}
