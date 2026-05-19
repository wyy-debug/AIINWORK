import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const knowledgeDir = path.join(repoRoot, 'docs/knowledge');
const readDoc = (relativePath) => readFileSync(path.join(repoRoot, relativePath), 'utf8');

describe('knowledge docs source smoke checks', () => {
  it('documents Brain, Obsidian semantic retrieval, troubleshooting, migration, and current route names', () => {
    const guide = readDoc('docs/knowledge/2026-05-19-brain-obsidian-context-guide.md');

    expect(guide).toContain('# Argus Brain + Obsidian Context Guide');
    expect(guide).toContain('## When To Use Which Memory');
    expect(guide).toContain('## Runtime Flow');
    expect(guide).toContain('## Storage Layers');
    expect(guide).toContain('## Troubleshooting Playbooks');
    expect(guide).toContain('## Migration Guide');
    expect(guide).toContain('```mermaid');
    expect(guide).toContain('/api/obsidian-bridge/health');
    expect(guide).toContain('/api/obsidian-bridge/semantic-index/status');
    expect(guide).toContain('/api/obsidian-bridge/wiki/migration-preview');
    expect(guide).toContain('/api/brain/session/:sessionId/inspector');
    expect(guide).toContain('/api/codegraph/status');
    expect(guide).toContain('disabled');
    expect(guide).toContain('not-installed');
    expect(guide).toContain('not-paired');
    expect(guide).toContain('indexing-missing');
    expect(guide).toContain('semantic-disabled');
    expect(guide).toContain('index-metadata-missing');
  });

  it('does not describe removed OpenMythos as a current capability', () => {
    const docs = readdirSync(knowledgeDir)
      .filter((file) => file.endsWith('.md'))
      .map((file) => ({ file, text: readFileSync(path.join(knowledgeDir, file), 'utf8') }));
    const combined = docs.map(({ file, text }) => `\n--- ${file} ---\n${text}`).join('\n');

    expect(combined).not.toMatch(/OpenMythos is the Argus strategy layer/i);
    expect(combined).not.toMatch(/Runtime owns both OpenMythos runtime controls/i);
    expect(combined).not.toMatch(/OpenMythos remains advisory/i);
    expect(combined).not.toMatch(/OpenMythos reminds/i);
  });

  it('keeps relative links in the updated knowledge docs resolvable', () => {
    const docs = [
      'docs/knowledge/README.md',
      'docs/knowledge/2026-05-18-argus-brain-runtime.md',
      'docs/knowledge/2026-04-28-mtl-code-user-guide.md',
      'docs/knowledge/2026-05-19-brain-obsidian-context-guide.md',
    ];

    for (const doc of docs) {
      const text = readDoc(doc);
      const baseDir = path.dirname(path.join(repoRoot, doc));
      const links = [...text.matchAll(/\[[^\]]+\]\(([^)#][^)]+\.md)\)/g)].map((match) => match[1]);
      for (const link of links) {
        expect(existsSync(path.resolve(baseDir, link))).toBe(true);
      }
    }
  });
});
