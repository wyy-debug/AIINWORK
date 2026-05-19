import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const projectSourcePath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../projects.js',
);

const readProjectsSource = async () => readFile(projectSourcePath, 'utf8');

describe('project deletion persistence', () => {
  it('keeps safely removed discovered projects hidden across refreshes', async () => {
    const source = await readProjectsSource();

    expect(source).toContain('isProjectHidden(config, entry.name)');
    expect(source).toContain(".filter(entry => !isProjectHidden(config, entry.name));");
    expect(source).toContain('removedFromSidebar: true');
    expect(source).toContain('hidden: true');
    expect(source).toContain('removedAt: new Date().toISOString()');
    expect(source).not.toContain('// Always remove from project config\n    delete config[projectName];');
  });

  it('allows manually re-adding a hidden project by clearing the hidden marker', async () => {
    const source = await readProjectsSource();

    expect(source).toContain('const existingProjectConfig = config[projectName];');
    expect(source).toContain('if (existingProjectConfig && !isProjectHidden(config, projectName))');
    expect(source).toContain('delete config[projectName].removedFromSidebar;');
    expect(source).toContain('delete config[projectName].hidden;');
  });
});
