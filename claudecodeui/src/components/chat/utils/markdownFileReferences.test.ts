import { describe, expect, it } from 'vitest';

import {
  formatInlineFileReferenceLabel,
  parseInlineFileReference,
  selectDefaultFileOpenTool,
} from './markdownFileReferences';

describe('parseInlineFileReference', () => {
  it('detects project-relative file references with line and column', () => {
    expect(parseInlineFileReference('src/utils/queryContext.ts:61:7')).toEqual({
      path: 'src/utils/queryContext.ts',
      line: 61,
      column: 7,
    });
  });

  it('detects Windows absolute file references', () => {
    expect(parseInlineFileReference('E:/AIINWORK/workspace/vendor/electron-dist/build-manifest.json')).toEqual({
      path: 'E:/AIINWORK/workspace/vendor/electron-dist/build-manifest.json',
      line: null,
      column: null,
    });
  });

  it('detects plain filename references with known source/document extensions', () => {
    expect(parseInlineFileReference('build-manifest.json')).toEqual({
      path: 'build-manifest.json',
      line: null,
      column: null,
    });
  });

  it('extracts the path value from simple assignment-like inline snippets', () => {
    expect(parseInlineFileReference('AdsChangeMaterial = Weapon/Accessory/Scope/AIM_Universal_LV1_HS/Materials/M_AIM_Sight_lenses_HS_Adson.mat')).toEqual({
      path: 'Weapon/Accessory/Scope/AIM_Universal_LV1_HS/Materials/M_AIM_Sight_lenses_HS_Adson.mat',
      line: null,
      column: null,
    });

    expect(parseInlineFileReference('"AdsChangeMaterial": "Weapon/Accessory/Scope/AIM_Universal_LV1_HS/Materials/M_AIM_Sight_lenses_HS_Adson.mat"')).toEqual({
      path: 'Weapon/Accessory/Scope/AIM_Universal_LV1_HS/Materials/M_AIM_Sight_lenses_HS_Adson.mat',
      line: null,
      column: null,
    });
  });

  it('does not treat function calls or identifiers as file references', () => {
    expect(parseInlineFileReference('getSystemPrompt()')).toBeNull();
    expect(parseInlineFileReference('systemPrompt')).toBeNull();
    expect(parseInlineFileReference('cache_control')).toBeNull();
  });

  it('does not treat localhost URLs as file references', () => {
    expect(parseInlineFileReference('http://127.0.0.1:5173')).toBeNull();
    expect(parseInlineFileReference('https://localhost:3000/app')).toBeNull();
  });

  it('repairs Windows paths when backslash-t was decoded as a tab character', () => {
    expect(parseInlineFileReference('D:\\SOC\trunk\\src\\MainContent.tsx:42')).toEqual({
      path: 'D:\\SOC\\trunk\\src\\MainContent.tsx',
      line: 42,
      column: null,
    });
  });
});

describe('formatInlineFileReferenceLabel', () => {
  it('renders plain file references as compact basename labels with location suffixes', () => {
    expect(formatInlineFileReferenceLabel({
      path: 'claude-code/packages/builtin-tools/src/tools/FileReadTool/prompt.ts',
      line: 27,
      column: null,
    })).toBe('.../tools/FileReadTool/prompt.ts:27');

    expect(formatInlineFileReferenceLabel({
      path: 'src/components/main-content/view/MainContent.tsx',
      line: null,
      column: null,
    })).toBe('.../main-content/view/MainContent.tsx');

    expect(formatInlineFileReferenceLabel({
      path: 'claudecodeui/server/services/argus-collaboration-mode-service.js',
      line: 3,
      column: null,
    })).toBe('claudecodeui/server/services/argus-collaboration-mode-service.js:3');
  });

  it('keeps Unity/Addressables-style asset paths readable instead of collapsing to basename', () => {
    expect(formatInlineFileReferenceLabel({
      path: 'Weapon/Accessory/Scope/AIM_Universal_LV1_HS/Materials/M_AIM_Sight_lenses_HS_Adson.mat',
      line: null,
      column: null,
    })).toBe('.../AIM_Universal_LV1_HS/Materials/M_AIM_Sight_lenses_HS_Adson.mat');

    expect(formatInlineFileReferenceLabel({
      path: 'M_AIM_Sight_lenses_HS_Adson.mat',
      line: null,
      column: null,
    })).toBe('M_AIM_Sight_lenses_HS_Adson.mat');
  });
});

describe('selectDefaultFileOpenTool', () => {
  it('selects the first available editor in launcher order', () => {
    expect(selectDefaultFileOpenTool([
      { id: 'vscode', kind: 'editor', available: false },
      { id: 'visualstudio', kind: 'editor', available: false },
      { id: 'cursor', kind: 'editor', available: true },
      { id: 'explorer', kind: 'system', available: true },
    ])).toBe('cursor');
  });

  it('falls back to VS Code when diagnostics are missing', () => {
    expect(selectDefaultFileOpenTool()).toBe('vscode');
  });
});
