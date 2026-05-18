import {
  getBuiltInRecipe,
  listBuiltInRecipes,
  renderRecipePrompt,
  validateRecipeManifest,
} from '../../shared/recipes.js';

import { createArtifact as defaultCreateArtifact } from './artifact-service.js';

const dependencyStatus = (dependency) => ({
  ...dependency,
  status: dependency.optional ? 'optional' : 'needs-configuration',
  message: dependency.optional
    ? 'Optional dependency. Configure it to improve the recipe output.'
    : 'Required dependency is missing or not configured.',
});

export function summarizeRecipeDependencies(recipe) {
  const deps = recipe?.dependencies || {};
  const required = [
    ...(deps.skills || []),
    ...(deps.mcpServers || []),
    ...(deps.modelProfiles || []),
  ].filter((dependency) => !dependency.optional).map(dependencyStatus);
  const optional = [
    ...(deps.skills || []),
    ...(deps.mcpServers || []),
    ...(deps.modelProfiles || []),
  ].filter((dependency) => dependency.optional).map(dependencyStatus);

  return {
    required,
    optional,
    blockingMissing: required.filter((dependency) => dependency.status !== 'installed'),
  };
}

export function createRecipeService({ createArtifact = defaultCreateArtifact } = {}) {
  const listRecipes = () => listBuiltInRecipes().map((recipe) => ({
    ...recipe,
    dependencyHealth: summarizeRecipeDependencies(recipe),
  }));

  const getRecipe = (id) => {
    const recipe = getBuiltInRecipe(id);
    if (!recipe) return null;
    return {
      ...recipe,
      dependencyHealth: summarizeRecipeDependencies(recipe),
    };
  };

  const validateManifest = (recipe) => validateRecipeManifest(recipe);

  const buildPrompt = ({ recipeId, values = {} }) => {
    const recipe = getBuiltInRecipe(recipeId);
    if (!recipe) {
      const error = new Error('Recipe not found');
      error.statusCode = 404;
      throw error;
    }

    const missing = (recipe.inputs || [])
      .filter((input) => input.required)
      .filter((input) => !String(values?.[input.id] || '').trim())
      .map((input) => input.id);
    if (missing.length > 0) {
      const error = new Error(`Missing required recipe inputs: ${missing.join(', ')}`);
      error.statusCode = 400;
      throw error;
    }

    return {
      recipe,
      prompt: renderRecipePrompt(recipe, values),
      profile: recipe.defaultProfile,
      permissionPreset: recipe.permissionPreset,
    };
  };

  const runRecipe = async ({
    recipeId,
    values = {},
    projectName = '',
    sessionId = '',
  } = {}) => {
    const built = buildPrompt({ recipeId, values });
    const title = `${built.recipe.title} - ${projectName || 'Recipe Output'}`;
    const result = await createArtifact({
      kind: built.recipe.outputArtifactKind,
      title,
      projectName,
      sessionId,
      content: built.prompt,
      metadata: {
        source: 'recipe',
        recipeId: built.recipe.id,
        profile: built.profile,
        permissionPreset: built.permissionPreset,
      },
    }, { autoExport: false });

    return {
      recipe: built.recipe,
      prompt: built.prompt,
      artifact: result.artifact,
    };
  };

  return {
    buildPrompt,
    getRecipe,
    listRecipes,
    runRecipe,
    validateManifest,
  };
}

export const recipeService = createRecipeService();

export const listRecipes = (...args) => recipeService.listRecipes(...args);
export const getRecipe = (...args) => recipeService.getRecipe(...args);
export const buildRecipePrompt = (...args) => recipeService.buildPrompt(...args);
export const runRecipe = (...args) => recipeService.runRecipe(...args);
export const validateRecipe = (...args) => recipeService.validateManifest(...args);
