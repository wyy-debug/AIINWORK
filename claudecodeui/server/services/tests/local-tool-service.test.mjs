import { describe, expect, it } from 'vitest';

import {
  buildEditorOpenArgs,
  createLocalToolProcess,
  getLocalToolCandidates,
  getLocalToolDefinitions,
  isEditorLocalTool,
  isTerminalLocalTool,
  normalizeLocalToolId,
} from '../local-tool-service.js';

describe('local tool service', () => {
  it('defines the project launcher tools shown in the header menu', () => {
    expect(getLocalToolDefinitions().map((tool) => tool.id)).toEqual([
      'vscode',
      'visualstudio',
      'cursor',
      'antigravity',
      'explorer',
      'git-bash',
    ]);
  });

  it('detects common Windows editor and terminal install locations', () => {
    const candidates = getLocalToolCandidates({
      platform: 'win32',
      env: {
        LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local',
        ProgramFiles: 'C:\\Program Files',
        'ProgramFiles(x86)': 'C:\\Program Files (x86)',
      },
    });

    expect(candidates.visualstudio.some((item) => item.command.endsWith('devenv.exe'))).toBe(true);
    expect(candidates.antigravity.some((item) => item.command.includes('Antigravity'))).toBe(true);
    expect(candidates['git-bash'].some((item) => item.command.endsWith('git-bash.exe'))).toBe(true);
    expect(candidates.explorer).toEqual([
      { command: 'explorer.exe', label: 'File Explorer', source: 'Windows' },
    ]);
  });

  it('normalizes unknown launch requests to VS Code while preserving known tools', () => {
    expect(normalizeLocalToolId('visualstudio')).toBe('visualstudio');
    expect(normalizeLocalToolId('antigravity')).toBe('antigravity');
    expect(normalizeLocalToolId('git-bash')).toBe('git-bash');
    expect(normalizeLocalToolId('missing-editor')).toBe('vscode');
  });

  it('classifies editor and terminal tools for safe launch routing', () => {
    expect(isEditorLocalTool('cursor')).toBe(true);
    expect(isEditorLocalTool('visualstudio')).toBe(true);
    expect(isEditorLocalTool('explorer')).toBe(false);
    expect(isTerminalLocalTool('git-bash')).toBe(true);
    expect(isTerminalLocalTool('vscode')).toBe(false);
  });

  it('builds goto arguments for VS Code-family editors and plain folder args for Visual Studio', () => {
    expect(buildEditorOpenArgs({ toolId: 'vscode', resolvedPath: 'C:\\repo\\src\\index.ts', line: 12, column: 4, isDirectory: false })).toEqual([
      '-g',
      'C:\\repo\\src\\index.ts:12:4',
    ]);
    expect(buildEditorOpenArgs({ toolId: 'visualstudio', resolvedPath: 'C:\\repo', isDirectory: true })).toEqual([
      'C:\\repo',
    ]);
  });

  it('uses a Windows-safe launcher for .cmd editor shims', () => {
    const spawnImpl = (...args) => args;

    expect(createLocalToolProcess('code.cmd', ['--version'], {
      platform: 'win32',
      spawnImpl,
    })).toEqual([
      'code.cmd',
      ['--version'],
      expect.objectContaining({ windowsHide: true }),
    ]);
  });
});
