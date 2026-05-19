export const RECIPE_CATALOG_VERSION = 1;

export const BUILT_IN_RECIPES = Object.freeze([
  Object.freeze({
    id: 'crashsight-analysis',
    title: 'CrashSight Analysis',
    description: 'Turn crash logs, stack traces, and recent changes into a root-cause brief.',
    tags: Object.freeze(['debug', 'crash', 'analysis']),
    defaultProfile: 'debug',
    permissionPreset: 'suggest',
    outputArtifactKind: 'recipe-crash-analysis',
    dependencies: Object.freeze({
      skills: Object.freeze([{ kind: 'skill', name: 'backend-architect', optional: true }]),
      mcpServers: Object.freeze([]),
      modelProfiles: Object.freeze([]),
    }),
    inputs: Object.freeze([
      Object.freeze({ id: 'crashLog', label: 'Crash log or stack trace', type: 'textarea', required: true }),
      Object.freeze({ id: 'suspectedArea', label: 'Suspected module', type: 'text', required: false }),
    ]),
    promptTemplate: [
      'Analyze this crash and produce a concise root-cause report.',
      'Include: likely cause, evidence, impacted files, immediate fix, regression tests.',
      '',
      'Suspected area: {{suspectedArea}}',
      '',
      'Crash log:',
      '{{crashLog}}',
    ].join('\n'),
  }),
  Object.freeze({
    id: 'redmine-review',
    title: 'Redmine Review',
    description: 'Summarize a ticket, acceptance criteria, implementation risk, and next actions.',
    tags: Object.freeze(['ticket', 'review']),
    defaultProfile: 'review',
    permissionPreset: 'suggest',
    outputArtifactKind: 'recipe-ticket-review',
    dependencies: Object.freeze({
      skills: Object.freeze([]),
      mcpServers: Object.freeze([{ kind: 'mcp-server', name: 'redmine', optional: true }]),
      modelProfiles: Object.freeze([]),
    }),
    inputs: Object.freeze([
      Object.freeze({ id: 'ticket', label: 'Ticket content or URL', type: 'textarea', required: true }),
      Object.freeze({ id: 'diff', label: 'Related diff or notes', type: 'textarea', required: false }),
    ]),
    promptTemplate: [
      'Review this Redmine ticket context.',
      'Return: scope, acceptance criteria, risk areas, test checklist, open questions.',
      '',
      'Ticket:',
      '{{ticket}}',
      '',
      'Related diff or notes:',
      '{{diff}}',
    ].join('\n'),
  }),
  Object.freeze({
    id: 'code-impact-analysis',
    title: 'Code Impact Analysis',
    description: 'Map a requested change to files, modules, risk surfaces, and tests.',
    tags: Object.freeze(['impact', 'architecture']),
    defaultProfile: 'explore',
    permissionPreset: 'suggest',
    outputArtifactKind: 'recipe-impact-analysis',
    dependencies: Object.freeze({
      skills: Object.freeze([{ kind: 'skill', name: 'software-architecture', optional: true }]),
      mcpServers: Object.freeze([{ kind: 'mcp-server', name: 'ainwork-code-search', optional: true }]),
      modelProfiles: Object.freeze([]),
    }),
    inputs: Object.freeze([
      Object.freeze({ id: 'changeRequest', label: 'Change request', type: 'textarea', required: true }),
    ]),
    promptTemplate: [
      'Perform code impact analysis for this change request.',
      'Return: modules touched, likely files, data contracts, risks, tests, rollout notes.',
      '',
      '{{changeRequest}}',
    ].join('\n'),
  }),
  Object.freeze({
    id: 'pr-description',
    title: 'PR Description',
    description: 'Create a delivery-ready PR body from the current diff or supplied notes.',
    tags: Object.freeze(['git', 'delivery']),
    defaultProfile: 'review',
    permissionPreset: 'suggest',
    outputArtifactKind: 'recipe-pr-description',
    dependencies: Object.freeze({ skills: Object.freeze([]), mcpServers: Object.freeze([]), modelProfiles: Object.freeze([]) }),
    inputs: Object.freeze([
      Object.freeze({ id: 'summary', label: 'Summary or diff notes', type: 'textarea', required: true }),
      Object.freeze({ id: 'tests', label: 'Tests run', type: 'textarea', required: false }),
    ]),
    promptTemplate: [
      'Write a GitHub pull request body.',
      'Include summary, risks, validation, and follow-ups. Do not invent tests.',
      '',
      'Summary or diff notes:',
      '{{summary}}',
      '',
      'Tests:',
      '{{tests}}',
    ].join('\n'),
  }),
  Object.freeze({
    id: 'release-note',
    title: 'Release Note',
    description: 'Turn implementation notes into user-facing release notes and migration guidance.',
    tags: Object.freeze(['docs', 'release']),
    defaultProfile: 'docs',
    permissionPreset: 'suggest',
    outputArtifactKind: 'recipe-release-note',
    dependencies: Object.freeze({ skills: Object.freeze([]), mcpServers: Object.freeze([]), modelProfiles: Object.freeze([]) }),
    inputs: Object.freeze([
      Object.freeze({ id: 'changes', label: 'Changes', type: 'textarea', required: true }),
      Object.freeze({ id: 'audience', label: 'Audience', type: 'text', required: false }),
    ]),
    promptTemplate: [
      'Write release notes for the target audience.',
      'Use clear sections: Highlights, Breaking Changes, Migration, Validation.',
      '',
      'Audience: {{audience}}',
      '',
      'Changes:',
      '{{changes}}',
    ].join('\n'),
  }),
]);

const RECIPE_BY_ID = new Map(BUILT_IN_RECIPES.map((recipe) => [recipe.id, recipe]));

export function getBuiltInRecipe(id) {
  return RECIPE_BY_ID.get(String(id || '').trim()) || null;
}

export function listBuiltInRecipes() {
  return BUILT_IN_RECIPES.map((recipe) => ({
    ...recipe,
    tags: [...recipe.tags],
    inputs: recipe.inputs.map((input) => ({ ...input })),
    dependencies: {
      skills: [...(recipe.dependencies.skills || [])],
      mcpServers: [...(recipe.dependencies.mcpServers || [])],
      modelProfiles: [...(recipe.dependencies.modelProfiles || [])],
    },
  }));
}

export function renderRecipePrompt(recipe, values = {}) {
  let prompt = recipe?.promptTemplate || '';
  for (const input of recipe?.inputs || []) {
    const value = values?.[input.id];
    prompt = prompt.replaceAll(`{{${input.id}}}`, typeof value === 'string' ? value.trim() : '');
  }
  return prompt.trim();
}

export function validateRecipeManifest(recipe) {
  const errors = [];
  if (!recipe || typeof recipe !== 'object') {
    return { valid: false, errors: ['Recipe manifest must be an object.'] };
  }
  for (const key of ['id', 'title', 'promptTemplate', 'outputArtifactKind']) {
    if (typeof recipe[key] !== 'string' || !recipe[key].trim()) {
      errors.push(`${key} is required.`);
    }
  }
  if (!Array.isArray(recipe.inputs)) {
    errors.push('inputs must be an array.');
  }
  return { valid: errors.length === 0, errors };
}
