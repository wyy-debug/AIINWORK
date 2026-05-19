import { describe, expect, test, vi } from 'vitest';

import { MARKETPLACE_CATEGORIES, getMarketplaceDependencyHealth } from '../../../shared/marketplaceCatalog.js';
import { getBuiltInRecipe, validateRecipeManifest } from '../../../shared/recipes.js';
import { createRecipeService } from '../recipe-service.js';

describe('recipe workflow packages', () => {
  test('ships the expected built-in recipes without V1 naming', () => {
    const service = createRecipeService();
    const ids = service.listRecipes().map((recipe) => recipe.id);

    expect(ids).toEqual(expect.arrayContaining([
      'crashsight-analysis',
      'redmine-review',
      'code-impact-analysis',
      'pr-description',
      'release-note',
    ]));
    expect(service.listRecipes().some((recipe) => /v1/i.test(recipe.title))).toBe(false);
  });

  test('renders slash-command prompts and validates required inputs', () => {
    const service = createRecipeService();

    expect(() => service.buildPrompt({ recipeId: 'crashsight-analysis', values: {} })).toThrow(/Missing required/);
    const built = service.buildPrompt({
      recipeId: 'crashsight-analysis',
      values: { crashLog: 'SIGSEGV at Renderer.cpp:9', suspectedArea: 'renderer' },
    });

    expect(built.prompt).toContain('SIGSEGV at Renderer.cpp:9');
    expect(built.profile).toBe('debug');
    expect(built.permissionPreset).toBe('suggest');
  });

  test('creates a recipe artifact with recipe metadata', async () => {
    const createArtifact = vi.fn(async (artifact) => ({ artifact: { id: 'artifact-1', ...artifact } }));
    const service = createRecipeService({ createArtifact });

    const result = await service.runRecipe({
      recipeId: 'pr-description',
      projectName: 'App',
      sessionId: 'session-1',
      values: { summary: 'Updated checkpoint support', tests: 'vitest' },
    });

    expect(result.artifact.kind).toBe('recipe-pr-description');
    expect(result.artifact.metadata).toMatchObject({
      source: 'recipe',
      recipeId: 'pr-description',
      permissionPreset: 'suggest',
    });
  });

  test('exposes marketplace categories and dependency blockers', () => {
    expect(MARKETPLACE_CATEGORIES.map((category) => category.label)).toEqual([
      'Agents',
      'Recipes',
      'Skills',
      'MCP Servers',
      'Swarms',
    ]);
    expect(validateRecipeManifest(getBuiltInRecipe('release-note')).valid).toBe(true);

    const health = getMarketplaceDependencyHealth(
      { kind: 'mcp-server', dependencies: { skills: [{ name: 'sec', status: 'missing' }] } },
      { blockedKinds: ['mcp-server'] },
    );
    expect(health.unavailable).toBe(true);
    expect(health.missing).toHaveLength(1);
  });
});
