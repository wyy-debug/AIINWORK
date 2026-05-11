function normalizeString(value, fallback = '', maxLength = 160) {
  const text = typeof value === 'string' ? value.trim() : '';
  return (text || fallback).slice(0, maxLength);
}

function normalizeSlug(value, maxLength = 160) {
  return normalizeString(value, '', maxLength)
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function isImplementedAppBinding(app) {
  return String(app || '').trim().startsWith('MCP: ');
}

export function normalizeAppBindings(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((binding) => {
      const item = binding && typeof binding === 'object' ? binding : {};
      const slot = normalizeString(item.slot, '', 80);
      const app = normalizeString(item.app, '', 120);
      if (!slot || !app) return null;
      if (!isImplementedAppBinding(app)) return null;
      const status = ['connected', 'optional', 'disabled'].includes(item.status)
        ? item.status
        : 'optional';
      return { slot, app, status };
    })
    .filter(Boolean)
    .slice(0, 30);
}

export function normalizeSkillNames(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value
    .map((skill) => normalizeString(skill, '', 120))
    .filter(Boolean)
    .filter((skill) => {
      const key = skill.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 30);
}

function normalizeAnswerValue(value) {
  if (typeof value === 'string') return value.slice(0, 4000);
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'boolean') return value;
  if (Array.isArray(value)) {
    return value
      .map((item) => normalizeAnswerValue(item))
      .filter((item) => item !== undefined)
      .slice(0, 40);
  }
  return undefined;
}

export function normalizeDialogAnswers(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const answers = {};
  for (const [rawKey, rawValue] of Object.entries(value)) {
    const key = normalizeString(rawKey, '', 80).replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
    const normalizedValue = normalizeAnswerValue(rawValue);
    if (!key || normalizedValue === undefined) continue;
    answers[key] = normalizedValue;
    if (Object.keys(answers).length >= 80) break;
  }
  return answers;
}

function normalizeDependencySelections(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    skills: normalizeSkillNames(source.skills),
    mcpServers: normalizeSkillNames(source.mcpServers),
    modelProfiles: normalizeSkillNames(source.modelProfiles).map((profile) => normalizeSlug(profile)).filter(Boolean),
  };
}

export function normalizeSessionAgentConfiguration(value) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    appBindings: normalizeAppBindings(source.appBindings),
    skills: normalizeSkillNames(source.skills),
    modelProfileId: normalizeSlug(source.modelProfileId),
    packageId: normalizeSlug(source.packageId, 120),
    packageVersion: normalizeString(source.packageVersion, '', 80),
    setupAnswers: normalizeDialogAnswers(source.setupAnswers),
    setupPresetId: normalizeSlug(source.setupPresetId, 120),
    launchAnswers: normalizeDialogAnswers(source.launchAnswers),
    launchPresetId: normalizeSlug(source.launchPresetId, 120),
    resultPresetId: normalizeSlug(source.resultPresetId, 120),
    selectedDependencies: normalizeDependencySelections(source.selectedDependencies),
    dialogInstanceId: normalizeString(source.dialogInstanceId, '', 120),
  };
}
