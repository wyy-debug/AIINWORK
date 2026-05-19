import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  analyzeProjectProfile,
  commitProjectProfileDraft,
  createProjectProfileDraft,
  renderMtlProjectProfile,
  writeMtlProjectProfile,
} from '../project-profile-service.js';

describe('project profile service', () => {
  let rootDir;

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), 'mtl-project-profile-'));
    await mkdir(join(rootDir, 'src', 'auth'), { recursive: true });
    await mkdir(join(rootDir, 'server', 'routes'), { recursive: true });
    await mkdir(join(rootDir, 'tests'), { recursive: true });
    await writeFile(join(rootDir, 'package.json'), JSON.stringify({
      name: 'profile-app',
      scripts: {
        dev: 'vite',
        build: 'vite build',
        test: 'vitest run',
        typecheck: 'tsc --noEmit',
      },
    }, null, 2), 'utf8');
    await writeFile(join(rootDir, 'src', 'auth', 'permissions.ts'), 'export const ok = true;\n', 'utf8');
    await writeFile(join(rootDir, 'server', 'routes', 'api.js'), 'export default {};\n', 'utf8');
    await writeFile(join(rootDir, 'tests', 'app.test.ts'), 'test("works", () => {});\n', 'utf8');
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  it('analyzes modules, common commands, and test entrypoints', async () => {
    const profile = await analyzeProjectProfile({ projectPath: rootDir });

    expect(profile.projectPath).toBe(rootDir);
    expect(profile.commands).toContain('npm run build');
    expect(profile.commands).toContain('npm run typecheck');
    expect(profile.modules.map((module) => module.path)).toContain('src');
    expect(profile.modules.map((module) => module.path)).toContain('server');
    expect(profile.testEntrypoints).toContain('npm run test');
    expect(profile.riskFiles).toContain('package.json');
    expect(profile.riskFiles).toContain('src/auth/permissions.ts');
  });

  it('renders MTL.md with stable sections', async () => {
    const profile = await analyzeProjectProfile({ projectPath: rootDir });
    const markdown = renderMtlProjectProfile(profile);

    expect(markdown).toContain('# MTL Project Profile');
    expect(markdown).toContain('## Structure');
    expect(markdown).toContain('## Common Commands');
    expect(markdown).toContain('## Test Entrypoints');
    expect(markdown).toContain('## Risk Files');
    expect(markdown).toContain('npm run build');
  });

  it('generates an MTL.md preview diff without writing until commit', async () => {
    const draft = await createProjectProfileDraft({ projectPath: rootDir });

    expect(draft.targetPath.endsWith('MTL.md')).toBe(true);
    expect(draft.content).toContain('Project: profile-app');
    expect(draft.content).toContain('npm run test');
    expect(draft.content).toContain('src/auth/permissions.ts');
    expect(draft.diff).toContain('+++ MTL.md');

    const committed = await commitProjectProfileDraft({ projectPath: rootDir, content: draft.content });
    await expect(readFile(committed.targetPath, 'utf8')).resolves.toContain('MTL Project Profile');
  });

  it('writes MTL.md without touching unrelated files', async () => {
    const result = await writeMtlProjectProfile({ projectPath: rootDir });
    const markdown = await readFile(join(rootDir, 'MTL.md'), 'utf8');

    expect(result.filePath).toBe(join(rootDir, 'MTL.md'));
    expect(markdown).toContain('MTL Project Profile');
    expect(await readFile(join(rootDir, 'src', 'auth', 'permissions.ts'), 'utf8')).toContain('export const ok');
  });
});
