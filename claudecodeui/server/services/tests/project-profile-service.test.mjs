import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  analyzeProjectProfile,
  renderMtlProjectProfile,
  writeMtlProjectProfile,
} from '../project-profile-service.js';

describe('project profile service', () => {
  let rootDir;

  beforeEach(async () => {
    rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mtl-project-profile-'));
    await fs.mkdir(path.join(rootDir, 'src', 'components'), { recursive: true });
    await fs.mkdir(path.join(rootDir, 'server', 'routes'), { recursive: true });
    await fs.mkdir(path.join(rootDir, 'tests'), { recursive: true });
    await fs.writeFile(path.join(rootDir, 'package.json'), JSON.stringify({
      scripts: {
        dev: 'vite',
        build: 'vite build',
        test: 'vitest run',
        typecheck: 'tsc --noEmit',
      },
    }, null, 2));
    await fs.writeFile(path.join(rootDir, 'src', 'components', 'App.tsx'), 'export function App() { return null; }\n');
    await fs.writeFile(path.join(rootDir, 'server', 'routes', 'api.js'), 'export default {};\n');
    await fs.writeFile(path.join(rootDir, 'tests', 'app.test.ts'), 'test("works", () => {});\n');
  });

  afterEach(async () => {
    await fs.rm(rootDir, { recursive: true, force: true });
  });

  it('analyzes modules, common commands, and test entrypoints', async () => {
    const profile = await analyzeProjectProfile({ projectPath: rootDir });

    expect(profile.projectPath).toBe(rootDir);
    expect(profile.commands).toContainEqual({ name: 'build', command: 'npm run build' });
    expect(profile.commands).toContainEqual({ name: 'typecheck', command: 'npm run typecheck' });
    expect(profile.modules.map((module) => module.path)).toContain('src');
    expect(profile.modules.map((module) => module.path)).toContain('server');
    expect(profile.testEntrypoints).toContain('tests/app.test.ts');
    expect(profile.riskFiles).toContain('package.json');
  });

  it('renders MTL.md with stable sections', async () => {
    const profile = await analyzeProjectProfile({ projectPath: rootDir });
    const markdown = renderMtlProjectProfile(profile);

    expect(markdown).toContain('# MTL Project Profile');
    expect(markdown).toContain('## Module Map');
    expect(markdown).toContain('## Common Commands');
    expect(markdown).toContain('## Test Entrypoints');
    expect(markdown).toContain('## Risk Files');
    expect(markdown).toContain('npm run build');
  });

  it('writes MTL.md without touching unrelated files', async () => {
    const result = await writeMtlProjectProfile({ projectPath: rootDir });
    const markdown = await fs.readFile(path.join(rootDir, 'MTL.md'), 'utf8');

    expect(result.filePath).toBe(path.join(rootDir, 'MTL.md'));
    expect(markdown).toContain('Generated from local project scan');
    expect(await fs.readFile(path.join(rootDir, 'src', 'components', 'App.tsx'), 'utf8')).toContain('export function App');
  });
});
