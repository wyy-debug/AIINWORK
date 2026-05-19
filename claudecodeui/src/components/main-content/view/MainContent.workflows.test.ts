import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const currentDir = dirname(fileURLToPath(import.meta.url));

describe('MainContent workflow page entry', () => {
  it('renders the Workflow Studio tab without using legacy swarm UI', () => {
    const mainContent = readFileSync(resolve(currentDir, 'MainContent.tsx'), 'utf8');
    const tabSwitcher = readFileSync(resolve(currentDir, 'subcomponents/MainContentTabSwitcher.tsx'), 'utf8');

    expect(mainContent).toContain("visibleActiveTab === 'workflows'");
    expect(mainContent).toContain('WorkflowStudio');
    expect(tabSwitcher).toContain("id: 'workflows'");
    expect(tabSwitcher).toContain("label: 'Workflows'");
  });
});
