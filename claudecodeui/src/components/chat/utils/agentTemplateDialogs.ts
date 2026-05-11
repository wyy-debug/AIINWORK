import type { AgentTemplateDialogSchema } from '../../../types/agent';

export type DialogAnswerValue = string | number | boolean | string[];
export type DialogAnswers = Record<string, DialogAnswerValue>;

export function hasDialogFields(schema?: AgentTemplateDialogSchema | null): boolean {
  return Boolean(schema && Array.isArray(schema.fields) && schema.fields.length > 0);
}

export function hasDialogPresets(schema?: AgentTemplateDialogSchema | null): boolean {
  return Boolean(schema && Array.isArray(schema.presets) && schema.presets.length > 0);
}

export function hasDialogInteraction(schema?: AgentTemplateDialogSchema | null): boolean {
  return hasDialogFields(schema) || hasDialogPresets(schema);
}

export function getDefaultDialogPresetId(schema?: AgentTemplateDialogSchema | null): string {
  if (!hasDialogPresets(schema)) return '';
  const requested = schema?.defaultPresetId || '';
  if (requested && schema!.presets!.some((preset) => preset.id === requested)) {
    return requested;
  }
  return schema!.presets![0]?.id || '';
}

export function getDialogPreset(schema: AgentTemplateDialogSchema | null | undefined, presetId?: string) {
  if (!hasDialogPresets(schema)) return null;
  const id = presetId || getDefaultDialogPresetId(schema);
  return schema!.presets!.find((preset) => preset.id === id) || schema!.presets![0] || null;
}

function defaultValueForField(field: AgentTemplateDialogSchema['fields'][number]): DialogAnswerValue {
  if (field.defaultValue !== undefined) {
    if (typeof field.defaultValue === 'string' || typeof field.defaultValue === 'number' || typeof field.defaultValue === 'boolean') {
      return field.defaultValue;
    }
  }
  if (field.type === 'boolean') return false;
  if (field.type === 'multiselect') return [];
  return '';
}

export function collectDialogDefaults(schema?: AgentTemplateDialogSchema | null, presetId?: string): DialogAnswers {
  if (!hasDialogFields(schema)) return {};
  const answers: DialogAnswers = {};
  for (const field of schema!.fields) {
    answers[field.id] = defaultValueForField(field);
  }
  const preset = getDialogPreset(schema, presetId);
  if (preset) {
    Object.assign(answers, normalizeDialogAnswersForSubmit(preset.answers));
  }
  return answers;
}

export function collectDialogAnswersWithPreset(
  schema: AgentTemplateDialogSchema | null | undefined,
  presetId?: string,
  answers: Record<string, unknown> = {},
): DialogAnswers {
  return {
    ...collectDialogDefaults(schema, presetId),
    ...normalizeDialogAnswersForSubmit(answers),
  };
}

export function normalizeDialogAnswersForSubmit(value: Record<string, unknown>): DialogAnswers {
  const answers: DialogAnswers = {};
  for (const [key, rawValue] of Object.entries(value || {})) {
    if (!key) continue;
    if (typeof rawValue === 'string' || typeof rawValue === 'number' || typeof rawValue === 'boolean') {
      answers[key] = rawValue;
    } else if (Array.isArray(rawValue)) {
      const values = rawValue
        .filter((item): item is string => typeof item === 'string')
        .slice(0, 40);
      if (values.length > 0) answers[key] = values;
    }
  }
  return answers;
}

export function isDialogAnswersComplete(
  schema: AgentTemplateDialogSchema | null | undefined,
  answers: Record<string, unknown>,
): boolean {
  if (!hasDialogFields(schema)) return true;
  for (const field of schema!.fields) {
    if (!field.required) continue;
    const value = answers[field.id];
    if (Array.isArray(value)) {
      if (value.length === 0) return false;
      continue;
    }
    if (value === undefined || value === null || String(value).trim() === '') {
      return false;
    }
  }
  return true;
}
