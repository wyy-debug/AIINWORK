import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const currentDir = dirname(fileURLToPath(import.meta.url));

describe('SidebarProjectItem project row actions', () => {
  it('keeps desktop project row actions outside the row toggle button', () => {
    const source = readFileSync(resolve(currentDir, 'SidebarProjectItem.tsx'), 'utf8');

    expect(source).not.toContain("import { Button } from '../../../../shared/view/ui'");
    expect(source).not.toContain('<Button');
    expect(source).toContain('data-testid="sidebar-project-main-button"');
    expect(source).toContain('data-testid="sidebar-project-new-session-button"');
    expect(source).toContain('data-testid="sidebar-project-edit-button"');
    expect(source).toContain('data-testid="sidebar-project-remove-button"');
    expect(source).toContain('onStartEditingProject(project);');
    expect(source).toContain('onDeleteProject(project);');
    expect(source).toContain("aria-label={t('tooltips.renameProject')}");
    expect(source).toContain('aria-label={t(\'sessions.newSession\')}');
    expect(source).toContain('aria-label={t(\'deleteConfirmation.removeFromSidebar\')}');
  });
});
