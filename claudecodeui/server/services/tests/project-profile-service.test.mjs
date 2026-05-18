import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { commitProjectProfileDraft, createProjectProfileDraft } from '../project-profile-service.js';

describe('project profile init service', () => {
  const roots = [];

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  async function createProject() {
    const root = await mkdtemp(join(tmpdir(), 'argus-project-profile-'));
    roots.push(root);
    await mkdir(join(root, 'src', 'auth'), { recursive: true });
    await writeFile(join(root, 'package.json'), JSON.stringify({
      name: 'profile-app',
      scripts: { test: 'vitest', lint: 'eslint .' },
    }), 'utf8');
    await writeFile(join(root, 'src', 'auth', 'permissions.ts'), 'export const ok = true;\n', 'utf8');
    return root;
  }

  it('generates an MTL.md preview diff without writing until commit', async () => {
    const root = await createProject();

    const draft = await createProjectProfileDraft({ projectPath: root });

    expect(draft.targetPath.endsWith('MTL.md')).toBe(true);
    expect(draft.content).toContain('Project: profile-app');
    expect(draft.content).toContain('npm run test');
    expect(draft.content).toContain('src/auth/permissions.ts');
    expect(draft.diff).toContain('+++ MTL.md');

    const committed = await commitProjectProfileDraft({ projectPath: root, content: draft.content });
    await expect(readFile(committed.targetPath, 'utf8')).resolves.toContain('MTL Project Profile');
  });
});
