import { describe, expect, test } from 'vitest';

import {
  buildPermissionPresetRuntimeSnapshot,
  getPermissionPreset,
  mergeToolSettingsWithPermissionPreset,
  normalizePermissionPresetId,
} from '../../../shared/permissionPresets.js';

describe('permission presets', () => {
  test('maps product presets to provider permission modes', () => {
    expect(getPermissionPreset('suggest')).toMatchObject({
      name: 'Suggest',
      permissionMode: 'plan',
      skipPermissions: false,
    });
    expect(getPermissionPreset('auto-edit')).toMatchObject({
      name: 'Auto Edit',
      permissionMode: 'acceptEdits',
      skipPermissions: false,
    });
    expect(getPermissionPreset('full-auto')).toMatchObject({
      name: 'Full Auto',
      permissionMode: 'bypassPermissions',
      skipPermissions: true,
    });
    expect(getPermissionPreset('enterprise-safe')).toMatchObject({
      name: 'Enterprise Safe',
      permissionMode: 'default',
      skipPermissions: false,
    });
  });

  test('keeps legacy low-level permission names compatible', () => {
    expect(normalizePermissionPresetId('plan')).toBe('suggest');
    expect(normalizePermissionPresetId('acceptEdits')).toBe('auto-edit');
    expect(normalizePermissionPresetId('bypassPermissions')).toBe('full-auto');
    expect(normalizePermissionPresetId('default')).toBe('enterprise-safe');
  });

  test('merges preset tools without dropping explicit local policy', () => {
    const merged = mergeToolSettingsWithPermissionPreset({
      allowedTools: ['Read', 'Bash(npm test:*)'],
      disallowedTools: ['Bash(rm:*)'],
      skipPermissions: false,
    }, 'suggest');

    expect(merged.allowedTools).toEqual(expect.arrayContaining(['Read', 'Grep', 'Glob', 'Bash(npm test:*)']));
    expect(merged.disallowedTools).toEqual(expect.arrayContaining(['Edit', 'Write', 'Bash', 'Bash(rm:*)']));
    expect(merged.skipPermissions).toBe(false);
  });

  test('exposes runtime diagnostics for the active preset', () => {
    expect(buildPermissionPresetRuntimeSnapshot('full-auto')).toMatchObject({
      id: 'full-auto',
      permissionMode: 'bypassPermissions',
      risk: 'high',
      skipPermissions: true,
    });
  });
});
