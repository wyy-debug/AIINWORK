import { describe, expect, test } from 'vitest';

import {
  normalizeAgentTemplateManifest,
  normalizeTemplatePackageFiles,
} from '../agent-template-manifest-service.js';

describe('agent template manifest service', () => {
  test('normalizes distributable dialogs, runtime, dependencies, and compatibility metadata', () => {
    const manifest = normalizeAgentTemplateManifest({
      schemaVersion: 1,
      id: 'review-pack',
      version: '2.1.0',
      kind: 'agent-template',
      runtime: {
        tools: ['Read', 'Grep'],
        model: 'sonnet',
        permissionMode: 'default',
      },
      dependencies: {
        required: {
          skills: ['security-review'],
          mcpServers: ['linear'],
          modelProfiles: ['sonnet-large'],
        },
        optional: {
          skills: ['perf-review'],
        },
      },
      dialogs: {
        setup: {
          title: 'Reviewer setup',
          fields: [
            { id: 'repo', label: 'Repository', type: 'text', required: true, defaultValue: 'frontend' },
            { id: 'review_depth', label: 'Depth', type: 'select', options: ['fast', 'deep'] },
          ],
        },
        launch: {
          defaultPresetId: 'deep',
          fields: [
            { id: 'scope', label: 'Scope', type: 'textarea', placeholder: 'Files or goals' },
          ],
          presets: [
            { id: 'deep', label: 'Deep review', answers: { scope: 'full diff' } },
          ],
        },
        result: {
          fields: [
            { id: 'export_format', label: 'Export format', type: 'select', options: ['markdown', 'json'] },
          ],
        },
      },
      examples: [{ title: 'Safe example', transcript: [{ role: 'user', content: 'Review this diff' }] }],
      compat: { claudeCode: '>=1.0.0', argusUi: '>=1.30.0' },
    });

    expect(manifest).toMatchObject({
      schemaVersion: 1,
      id: 'review-pack',
      version: '2.1.0',
      kind: 'agent-template',
      runtime: {
        tools: ['Read', 'Grep'],
        model: 'sonnet',
        permissionMode: 'default',
      },
      dependencies: {
        skills: [{ kind: 'skill', name: 'security-review', optional: false }, { kind: 'skill', name: 'perf-review', optional: true }],
        mcpServers: [{ kind: 'mcp-server', name: 'linear', optional: false }],
        modelProfiles: [{ kind: 'model-profile', name: 'sonnet-large', optional: false }],
      },
      dialogs: {
        setup: {
          title: 'Reviewer setup',
          fields: [
            { id: 'repo', label: 'Repository', type: 'text', required: true, defaultValue: 'frontend' },
            { id: 'review_depth', label: 'Depth', type: 'select', options: ['fast', 'deep'] },
          ],
        },
        launch: {
          defaultPresetId: 'deep',
          presets: [
            { id: 'deep', label: 'Deep review', answers: { scope: 'full diff' } },
          ],
        },
      },
      compat: { claudeCode: '>=1.0.0', argusUi: '>=1.30.0' },
    });
  });

  test('rejects dialog presets with invalid answers or too many entries', () => {
    expect(() => normalizeAgentTemplateManifest({
      id: 'bad-preset-field',
      kind: 'agent-template',
      dialogs: {
        launch: {
          fields: [{ id: 'scope', label: 'Scope', type: 'text' }],
          presets: [{ id: 'bad', label: 'Bad', answers: { missing: 'value' } }],
        },
      },
    })).toThrow(/unknown dialog field/i);

    expect(() => normalizeAgentTemplateManifest({
      id: 'bad-preset-type',
      kind: 'agent-template',
      dialogs: {
        launch: {
          fields: [{ id: 'count', label: 'Count', type: 'number' }],
          presets: [{ id: 'bad', label: 'Bad', answers: { count: 'many' } }],
        },
      },
    })).toThrow(/invalid preset answer/i);

    expect(() => normalizeAgentTemplateManifest({
      id: 'too-many-presets',
      kind: 'agent-template',
      dialogs: {
        launch: {
          fields: [{ id: 'scope', label: 'Scope', type: 'text' }],
          presets: Array.from({ length: 13 }, (_, index) => ({
            id: `preset-${index}`,
            label: `Preset ${index}`,
            answers: { scope: `scope-${index}` },
          })),
        },
      },
    })).toThrow(/at most 12 presets/i);
  });

  test('rejects remote executable dialog fields and case-only package path collisions', () => {
    expect(() => normalizeAgentTemplateManifest({
      id: 'bad-dialog',
      kind: 'agent-template',
      dialogs: {
        setup: {
          fields: [
            { id: 'danger', label: 'Danger', type: 'html', html: '<script>alert(1)</script>' },
          ],
        },
      },
    })).toThrow(/unsupported dialog field type/i);

    expect(() => normalizeTemplatePackageFiles([
      { path: 'skills/Foo/SKILL.md', content: 'a' },
      { path: 'skills/foo/skill.md', content: 'b' },
    ])).toThrow(/case-only package path collision/i);
  });
});
