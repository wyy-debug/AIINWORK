import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const MAX_FIELDS = 24;
const MAX_STEPS = 32;
const ALLOWED_INPUT_TYPES = new Set(['text', 'textarea', 'select', 'multiselect', 'boolean', 'number', 'path', 'mcpServer', 'skill']);
const ALLOWED_OUTPUT_TYPES = new Set(['markdown', 'link', 'file', 'json', 'checklist']);
const ALLOWED_PERMISSION_PRESETS = new Set(['suggest', 'auto-edit', 'full-auto', 'enterprise-safe']);

function normalizeString(value, fallback = '', maxLength = 500) {
  const text = typeof value === 'string' ? value.trim() : '';
  return (text || fallback).slice(0, maxLength);
}

function sanitizeSlug(value, fallback = 'recipe') {
  const slug = normalizeString(value, fallback, 120)
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return slug || fallback;
}

function assertSpecificRecipeId(id) {
  if (/^v\d+$/i.test(id) || /(^|[-_])v\d+$/i.test(id)) {
    throw new Error('Recipe packages must use a specific recipe id, not broad V1/V2/V3 planning labels');
  }
}

function normalizeStringArray(value, maxItems = 40) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const result = [];
  for (const item of value) {
    const text = normalizeString(item, '', 120);
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    result.push(text);
    if (result.length >= maxItems) break;
  }
  return result;
}

function normalizeDependencies(raw = {}) {
  return {
    skills: normalizeStringArray(raw.skills || raw.requiredSkills || raw.skillDependencies),
    mcpServers: normalizeStringArray(raw.mcpServers || raw.requiredMcpServers || raw.mcp),
    agentProfiles: normalizeStringArray(raw.agentProfiles || raw.requiredAgentProfiles),
  };
}

function normalizeField(field, allowedTypes, fallbackType) {
  if (!field || typeof field !== 'object') return null;
  const id = sanitizeSlug(field.id || field.key || field.name || field.label, '');
  const label = normalizeString(field.label || field.title || id, id, 160);
  if (!id || !label) return null;
  const type = normalizeString(field.type, fallbackType, 40);
  if (!allowedTypes.has(type)) {
    throw new Error(`Unsupported recipe field type: ${type}`);
  }
  const normalized = {
    id,
    label,
    type,
    required: Boolean(field.required),
  };
  const description = normalizeString(field.description || field.help, '', 500);
  const placeholder = normalizeString(field.placeholder, '', 240);
  const options = normalizeStringArray(field.options, 48);
  if (description) normalized.description = description;
  if (placeholder) normalized.placeholder = placeholder;
  if (options.length > 0) normalized.options = options;
  return normalized;
}

function normalizeFields(value, allowedTypes, fallbackType) {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, MAX_FIELDS)
    .map((field) => normalizeField(field, allowedTypes, fallbackType))
    .filter(Boolean);
}

function normalizeStep(step, index) {
  if (!step || typeof step !== 'object') return null;
  const id = sanitizeSlug(step.id || step.title || `step-${index + 1}`, `step-${index + 1}`);
  const title = normalizeString(step.title || step.name || id, id, 160);
  const prompt = normalizeString(step.prompt || step.instruction || step.description || title, title, 4000);
  if (!title || !prompt) {
    throw new Error(`Recipe step ${id} requires title and prompt`);
  }
  return {
    id,
    title,
    prompt,
    agentProfile: sanitizeSlug(step.agentProfile || step.profile || 'build', 'build'),
    uses: normalizeStringArray(step.uses || step.mcpServers || step.skills, 24),
  };
}

function normalizeSteps(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('Recipe manifest requires at least one step');
  }
  return value
    .slice(0, MAX_STEPS)
    .map((step, index) => normalizeStep(step, index))
    .filter(Boolean);
}

function normalizePermissionPreset(value) {
  const preset = normalizeString(value, 'suggest', 40).toLowerCase();
  return ALLOWED_PERMISSION_PRESETS.has(preset) ? preset : 'suggest';
}

export function normalizeRecipeManifest(value = {}) {
  if (!value || typeof value !== 'object') {
    throw new Error('Recipe manifest must be an object');
  }
  const id = sanitizeSlug(value.id || value.slug || value.name || value.title, 'recipe');
  assertSpecificRecipeId(id);
  const name = normalizeString(value.name || value.title || id, id, 160);
  const description = normalizeString(value.description || value.summary, '', 1000);
  const dependencies = normalizeDependencies({
    ...value.dependencies,
    requiredSkills: value.requiredSkills,
    requiredMcpServers: value.requiredMcpServers,
    agentProfiles: value.agentProfiles,
  });
  const inputs = normalizeFields(value.inputs || value.parameters, ALLOWED_INPUT_TYPES, 'text');
  const outputs = normalizeFields(value.outputs || value.results, ALLOWED_OUTPUT_TYPES, 'markdown');
  const steps = normalizeSteps(value.steps);
  if (inputs.length === 0) {
    throw new Error('Recipe manifest requires at least one input');
  }
  if (outputs.length === 0) {
    throw new Error('Recipe manifest requires at least one output');
  }

  return {
    schemaVersion: 1,
    kind: 'recipe',
    id,
    name,
    description,
    permissionPreset: normalizePermissionPreset(value.permissionPreset),
    dependencies,
    inputs,
    outputs,
    steps,
  };
}

const BUILT_IN_RECIPES = [
  {
    id: 'crashsight-analysis',
    name: 'CrashSight Analysis',
    description: 'Analyze a CrashSight issue, connect the stack to code ownership, and produce a fix brief.',
    requiredSkills: ['crash-analysis', 'code-search'],
    requiredMcpServers: ['crashsight', 'gitnexus'],
    permissionPreset: 'enterprise-safe',
    inputs: [
      { id: 'crash_id', label: 'Crash ID', type: 'text', required: true },
      { id: 'build_version', label: 'Build Version', type: 'text' },
    ],
    outputs: [
      { id: 'root_cause', label: 'Root Cause', type: 'markdown' },
      { id: 'fix_plan', label: 'Fix Plan', type: 'checklist' },
    ],
    steps: [
      { id: 'collect-crash', title: 'Collect CrashSight Context', agentProfile: 'explore', uses: ['crashsight'], prompt: 'Fetch stack, device, build, frequency, and symbolication context for the crash.' },
      { id: 'map-code', title: 'Map Impacted Code', agentProfile: 'explore', uses: ['gitnexus'], prompt: 'Trace stack frames into repository files and identify likely owners and recent changes.' },
      { id: 'write-brief', title: 'Write Fix Brief', agentProfile: 'review', prompt: 'Summarize root cause, confidence, impacted modules, and recommended fix path.' },
    ],
  },
  {
    id: 'redmine-review',
    name: 'Redmine Review',
    description: 'Review a Redmine ticket against code changes and produce risk and acceptance notes.',
    requiredSkills: ['code-review'],
    requiredMcpServers: ['redmine', 'gitnexus'],
    permissionPreset: 'suggest',
    inputs: [
      { id: 'issue_id', label: 'Redmine Issue', type: 'text', required: true },
      { id: 'branch', label: 'Branch', type: 'text' },
    ],
    outputs: [
      { id: 'review_notes', label: 'Review Notes', type: 'markdown' },
      { id: 'acceptance', label: 'Acceptance Checklist', type: 'checklist' },
    ],
    steps: [
      { id: 'read-ticket', title: 'Read Ticket', agentProfile: 'explore', uses: ['redmine'], prompt: 'Read the Redmine issue, comments, attachments, and acceptance criteria.' },
      { id: 'compare-code', title: 'Compare Code', agentProfile: 'review', uses: ['gitnexus'], prompt: 'Compare implementation against ticket requirements and list risks.' },
    ],
  },
  {
    id: 'code-impact-analysis',
    name: 'Code Impact Analysis',
    description: 'Analyze a proposed change and explain affected modules, tests, and downstream risks.',
    requiredSkills: ['code-search', 'architecture-review'],
    requiredMcpServers: ['gitnexus', 'code-search'],
    permissionPreset: 'suggest',
    inputs: [
      { id: 'change_summary', label: 'Change Summary', type: 'textarea', required: true },
      { id: 'target_files', label: 'Target Files', type: 'textarea' },
    ],
    outputs: [
      { id: 'impact_map', label: 'Impact Map', type: 'markdown' },
      { id: 'tests', label: 'Test Recommendations', type: 'checklist' },
    ],
    steps: [
      { id: 'scan-references', title: 'Scan References', agentProfile: 'explore', uses: ['code-search'], prompt: 'Find callers, data flow, configs, and related tests for the proposed change.' },
      { id: 'risk-report', title: 'Risk Report', agentProfile: 'review', prompt: 'Produce impacted modules, blast radius, regression risk, and test recommendations.' },
    ],
  },
  {
    id: 'publish-pr',
    name: 'Publish PR',
    description: 'Prepare a Git-native PR summary with tests, risks, and reviewer-ready notes.',
    requiredSkills: ['git-review'],
    requiredMcpServers: ['github', 'gitnexus'],
    permissionPreset: 'auto-edit',
    inputs: [
      { id: 'base_branch', label: 'Base Branch', type: 'text', required: true },
      { id: 'title', label: 'PR Title', type: 'text' },
    ],
    outputs: [
      { id: 'pr_description', label: 'PR Description', type: 'markdown' },
      { id: 'review_checklist', label: 'Review Checklist', type: 'checklist' },
    ],
    steps: [
      { id: 'summarize-diff', title: 'Summarize Diff', agentProfile: 'review', uses: ['gitnexus'], prompt: 'Summarize changed files, behavior changes, risks, and verification evidence.' },
      { id: 'draft-pr', title: 'Draft PR', agentProfile: 'docs', uses: ['github'], prompt: 'Prepare PR title/body, testing section, risk notes, and reviewer guidance.' },
    ],
  },
];

export function getBuiltInRecipeCatalog() {
  return {
    schemaVersion: 1,
    name: 'MTL-Code Recipes',
    items: BUILT_IN_RECIPES.map((recipe) => normalizeRecipeManifest(recipe)),
  };
}

export function validateRecipePackage(value = {}) {
  if (!value || typeof value !== 'object') {
    throw new Error('Recipe package must be an object');
  }
  const recipes = Array.isArray(value.recipes)
    ? value.recipes.map((recipe) => normalizeRecipeManifest(recipe))
    : [];
  if (recipes.length === 0) {
    throw new Error('Recipe package requires at least one recipe');
  }
  return {
    schemaVersion: 1,
    recipes,
  };
}

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), { mode: 0o600 });
}

function mergeRecipeLists(...lists) {
  const byId = new Map();
  for (const list of lists) {
    for (const recipe of list || []) {
      byId.set(recipe.id, recipe);
    }
  }
  return Array.from(byId.values()).sort((left, right) => left.name.localeCompare(right.name));
}

export function createRecipeCatalogStore({ rootDir = path.join(os.homedir(), '.mtl-code-ui', 'recipes') } = {}) {
  const catalogPath = path.join(rootDir, 'catalog.json');

  const readLocalRecipes = async () => {
    const payload = await readJson(catalogPath, { schemaVersion: 1, recipes: [] });
    const recipes = Array.isArray(payload.recipes)
      ? payload.recipes.map((recipe) => normalizeRecipeManifest(recipe))
      : [];
    return recipes;
  };

  const writeLocalRecipes = async (recipes) => {
    await writeJson(catalogPath, {
      schemaVersion: 1,
      recipes: recipes.map((recipe) => normalizeRecipeManifest(recipe)),
    });
  };

  return {
    async listCatalog() {
      const builtIn = getBuiltInRecipeCatalog().items;
      const local = await readLocalRecipes();
      return {
        schemaVersion: 1,
        name: 'MTL-Code Recipes',
        items: mergeRecipeLists(builtIn, local),
      };
    },

    async importPackage(recipePackage) {
      const normalizedPackage = validateRecipePackage(recipePackage);
      const existing = await readLocalRecipes();
      const merged = mergeRecipeLists(existing, normalizedPackage.recipes);
      await writeLocalRecipes(merged);
      return {
        imported: normalizedPackage.recipes.map((recipe) => recipe.id),
      };
    },

    async exportPackage(recipeIds = []) {
      const catalog = await this.listCatalog();
      const requested = new Set(normalizeStringArray(recipeIds, 100));
      const recipes = requested.size > 0
        ? catalog.items.filter((recipe) => requested.has(recipe.id))
        : catalog.items;
      return validateRecipePackage({
        schemaVersion: 1,
        recipes,
      });
    },
  };
}
