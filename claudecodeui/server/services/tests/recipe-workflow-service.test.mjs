import { describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  createRecipeCatalogStore,
  getBuiltInRecipeCatalog,
  normalizeRecipeManifest,
  validateRecipePackage,
} from '../recipe-workflow-service.js';

describe('recipe workflow service', () => {
  it('normalizes a recipe manifest with dependencies, permissions, inputs, outputs, and steps', () => {
    const manifest = normalizeRecipeManifest({
      id: ' CrashSight Analysis ',
      name: 'CrashSight Analysis',
      description: 'Analyze mobile crash reports.',
      requiredSkills: ['crash-analysis', 'code-search'],
      requiredMcpServers: ['crashsight', 'gitnexus'],
      permissionPreset: 'enterprise-safe',
      inputs: [
        { id: 'crash_id', label: 'Crash ID', type: 'text', required: true },
        { id: 'build', label: 'Build', type: 'text' },
      ],
      outputs: [
        { id: 'summary', label: 'Root cause summary', type: 'markdown' },
      ],
      steps: [
        { id: 'collect', title: 'Collect crash context', prompt: 'Fetch CrashSight stack and symbols.' },
        { id: 'impact', title: 'Find impacted code', agentProfile: 'explore', uses: ['gitnexus'] },
      ],
    });

    expect(manifest.id).toBe('crashsight-analysis');
    expect(manifest.kind).toBe('recipe');
    expect(manifest.dependencies.skills).toEqual(['crash-analysis', 'code-search']);
    expect(manifest.dependencies.mcpServers).toEqual(['crashsight', 'gitnexus']);
    expect(manifest.permissionPreset).toBe('enterprise-safe');
    expect(manifest.inputs[0]).toMatchObject({ id: 'crash_id', type: 'text', required: true });
    expect(manifest.outputs[0]).toMatchObject({ id: 'summary', type: 'markdown' });
    expect(manifest.steps[1]).toMatchObject({ id: 'impact', agentProfile: 'explore', uses: ['gitnexus'] });
  });

  it('rejects broad version-plan recipe identifiers', () => {
    expect(() => normalizeRecipeManifest({ id: 'V1', name: 'V1' })).toThrow(/specific recipe id/i);
    expect(() => normalizeRecipeManifest({ id: 'REQ-003 V2', name: 'V2' })).toThrow(/specific recipe id/i);
  });

  it('ships built-in recipes for local enterprise workflows', () => {
    const catalog = getBuiltInRecipeCatalog();
    const ids = catalog.items.map((item) => item.id);

    expect(ids).toContain('crashsight-analysis');
    expect(ids).toContain('redmine-review');
    expect(ids).toContain('code-impact-analysis');
    expect(ids).toContain('publish-pr');
    for (const item of catalog.items) {
      expect(item.dependencies).toBeTruthy();
      expect(item.inputs.length).toBeGreaterThan(0);
      expect(item.outputs.length).toBeGreaterThan(0);
      expect(item.steps.length).toBeGreaterThan(0);
    }
  });

  it('validates shareable recipe packages', () => {
    const recipe = normalizeRecipeManifest({
      id: 'release-pr',
      name: 'Release PR',
      inputs: [{ id: 'branch', label: 'Branch', type: 'text', required: true }],
      outputs: [{ id: 'pr', label: 'PR', type: 'link' }],
      steps: [{ id: 'draft', title: 'Draft PR', prompt: 'Create PR description.' }],
    });

    const packaged = validateRecipePackage({
      schemaVersion: 1,
      recipes: [recipe],
    });

    expect(packaged.schemaVersion).toBe(1);
    expect(packaged.recipes).toHaveLength(1);
    expect(packaged.recipes[0].id).toBe('release-pr');
  });

  it('imports and exports local recipe packages', async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mtl-recipes-'));
    const store = createRecipeCatalogStore({ rootDir });
    const recipePackage = validateRecipePackage({
      schemaVersion: 1,
      recipes: [{
        id: 'local-release-pr',
        name: 'Local Release PR',
        inputs: [{ id: 'branch', label: 'Branch', type: 'text', required: true }],
        outputs: [{ id: 'pr', label: 'PR', type: 'link' }],
        steps: [{ id: 'draft', title: 'Draft PR', prompt: 'Create PR description.' }],
      }],
    });

    const imported = await store.importPackage(recipePackage);
    const catalog = await store.listCatalog();
    const exported = await store.exportPackage(['local-release-pr']);

    expect(imported.imported).toEqual(['local-release-pr']);
    expect(catalog.items.some((item) => item.id === 'local-release-pr')).toBe(true);
    expect(exported.recipes).toHaveLength(1);
    expect(exported.recipes[0].id).toBe('local-release-pr');
    await fs.rm(rootDir, { recursive: true, force: true });
  });
});
