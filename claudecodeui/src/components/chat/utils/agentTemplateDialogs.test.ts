import { describe, expect, it } from 'vitest';

import {
  collectDialogAnswersWithPreset,
  collectDialogDefaults,
  getDefaultDialogPresetId,
  hasDialogFields,
  hasDialogInteraction,
  isDialogAnswersComplete,
  normalizeDialogAnswersForSubmit,
} from './agentTemplateDialogs';

describe('agentTemplateDialogs', () => {
  const schema = {
    fields: [
      { id: 'repo', label: 'Repository', type: 'text' as const, required: true, defaultValue: 'frontend' },
      { id: 'depth', label: 'Depth', type: 'select' as const, options: ['fast', 'deep'], defaultValue: 'fast' },
      { id: 'include_tests', label: 'Include tests', type: 'boolean' as const, defaultValue: true },
    ],
    defaultPresetId: 'deep',
    presets: [
      { id: 'fast', label: 'Fast', answers: { depth: 'fast', include_tests: false } },
      { id: 'deep', label: 'Deep', answers: { depth: 'deep', include_tests: true } },
    ],
  };

  it('collects defaults and validates required manifest dialog fields', () => {
    expect(hasDialogFields(schema)).toBe(true);
    expect(hasDialogInteraction(schema)).toBe(true);
    expect(getDefaultDialogPresetId(schema)).toBe('deep');
    expect(collectDialogDefaults(schema)).toEqual({
      repo: 'frontend',
      depth: 'deep',
      include_tests: true,
    });
    expect(isDialogAnswersComplete(schema, { repo: 'frontend' })).toBe(true);
    expect(isDialogAnswersComplete(schema, { repo: '' })).toBe(false);
  });

  it('applies selected presets before user answer overrides', () => {
    expect(collectDialogAnswersWithPreset(schema, 'fast', { repo: 'backend' })).toEqual({
      repo: 'backend',
      depth: 'fast',
      include_tests: false,
    });
  });

  it('drops nested objects before dialog answers are submitted', () => {
    expect(normalizeDialogAnswersForSubmit({
      repo: 'frontend',
      include_tests: true,
      nested: { value: 'ignored' },
    })).toEqual({
      repo: 'frontend',
      include_tests: true,
    });
  });
});
