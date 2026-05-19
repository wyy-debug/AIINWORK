import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const currentDir = dirname(fileURLToPath(import.meta.url));

describe('AgentProfileSwitcher wiring', () => {
  it('renders the six built-in Agent Profiles from the shared profile contract', () => {
    const source = readFileSync(resolve(currentDir, 'AgentProfileSwitcher.tsx'), 'utf8');

    expect(source).toContain('BUILT_IN_AGENT_PROFILES');
    expect(source).toContain('plan: ListChecksIcon');
    expect(source).toContain('build: HammerIcon');
    expect(source).toContain('explore: CompassIcon');
    expect(source).toContain('review: ClipboardCheckIcon');
    expect(source).toContain('debug: BugIcon');
    expect(source).toContain('docs: FileTextIcon');
  });

  it('is mounted from ChatComposer as a chat entry control', () => {
    const composerSource = readFileSync(resolve(currentDir, 'ChatComposer.tsx'), 'utf8');

    expect(composerSource).toContain("import AgentProfileSwitcher from './AgentProfileSwitcher'");
    expect(composerSource).toContain('<AgentProfileSwitcher');
    expect(composerSource).toContain('selectedProfileKind={selectedAgentProfileKind}');
    expect(composerSource).toContain('onProfileChange={onAgentProfileChange}');
  });
});
