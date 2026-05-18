import { describe, expect, it } from 'vitest';

import {
  listPermissionPresets,
  normalizePermissionPreset,
  resolvePermissionPresetRuntime,
} from '../permission-preset-service.js';

describe('permission preset service', () => {
  it('lists user-facing permission presets', () => {
    const ids = listPermissionPresets().map((preset) => preset.id);

    expect(ids).toEqual(['suggest', 'auto-edit', 'full-auto', 'enterprise-safe']);
  });

  it('normalizes aliases to stable preset ids', () => {
    expect(normalizePermissionPreset('Suggest')).toBe('suggest');
    expect(normalizePermissionPreset('Auto Edit')).toBe('auto-edit');
    expect(normalizePermissionPreset('Full Auto')).toBe('full-auto');
    expect(normalizePermissionPreset('Enterprise Safe')).toBe('enterprise-safe');
    expect(normalizePermissionPreset('V1')).toBe('suggest');
  });

  it('maps presets to provider runtime permissions', () => {
    expect(resolvePermissionPresetRuntime('suggest')).toMatchObject({
      permissionPreset: 'suggest',
      permissionMode: 'default',
      skipPermissions: false,
    });
    expect(resolvePermissionPresetRuntime('auto-edit')).toMatchObject({
      permissionPreset: 'auto-edit',
      permissionMode: 'acceptEdits',
      skipPermissions: false,
    });
    expect(resolvePermissionPresetRuntime('full-auto')).toMatchObject({
      permissionPreset: 'full-auto',
      permissionMode: 'bypassPermissions',
      skipPermissions: true,
    });
  });

  it('keeps enterprise-safe from bypassing permissions', () => {
    const runtime = resolvePermissionPresetRuntime('enterprise-safe', {
      permissionMode: 'bypassPermissions',
      toolsSettings: {
        allowedTools: ['Bash'],
        disallowedTools: [],
        skipPermissions: true,
      },
    });

    expect(runtime.permissionPreset).toBe('enterprise-safe');
    expect(runtime.permissionMode).toBe('default');
    expect(runtime.skipPermissions).toBe(false);
    expect(runtime.toolsSettings.skipPermissions).toBe(false);
    expect(runtime.toolsSettings.disallowedTools).toContain('Bash(git reset --hard)');
    expect(runtime.toolsSettings.disallowedTools).toContain('Bash(rm -rf *)');
  });
});
