import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createBuildManifest } from './package-manifest.mjs';

describe('createBuildManifest', () => {
  it('marks debug portable packages with debug channel metadata', () => {
    const manifest = createBuildManifest({
      version: '1.30.4',
      commit: 'abc123',
      channel: 'debug',
      artifact: 'portable',
      outputPath: 'E:/AIINWORK/workspace/vendor/debug/Argus-Debug-1.30.4',
      nodeVersion: 'v22.0.0',
      bunVersion: '1.2.3',
      builtAt: '2026-05-05T00:00:00.000Z',
    });

    expect(manifest.channel).toBe('debug');
    expect(manifest.debug).toBe(true);
    expect(manifest.artifact).toBe('portable');
  });

  it('marks release installers as non-debug release builds', () => {
    const manifest = createBuildManifest({
      version: '1.30.4',
      commit: 'def456',
      channel: 'release',
      artifact: 'nsis',
      outputPath: 'E:/AIINWORK/workspace/vendor/electron-dist/Argus-1.30.4-x64.exe',
      nodeVersion: 'v22.0.0',
      bunVersion: '1.2.3',
      builtAt: '2026-05-05T00:00:00.000Z',
    });

    expect(manifest.channel).toBe('release');
    expect(manifest.debug).toBe(false);
    expect(manifest.artifact).toBe('nsis');
  });

  it('keeps preview portable packages separate from release metadata', () => {
    const manifest = createBuildManifest({
      version: '1.30.4',
      commit: 'ghi789',
      channel: 'preview',
      artifact: 'portable',
      outputPath: 'E:/AIINWORK/workspace/vendor/bundle',
      nodeVersion: 'v22.0.0',
      bunVersion: '1.2.3',
      builtAt: '2026-05-05T00:00:00.000Z',
    });

    expect(manifest.channel).toBe('preview');
    expect(manifest.debug).toBe(false);
  });

  it('generates a debug launcher that does not fail on native stderr diagnostics', () => {
    const currentDir = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(resolve(currentDir, 'package-preview-win.mjs'), 'utf8');

    expect(source).toContain('$ErrorActionPreference = "Continue"');
    expect(source).toContain('$global:PSNativeCommandUseErrorActionPreference = $false');
    expect(source).toContain('$env:ARGUS_OBSIDIAN_DEBUG = "1"');
    expect(source).toContain('$env:ARGUS_CODEGRAPH_DEBUG = "1"');
  });
});
