import { describe, expect, it } from 'vitest';

import {
  exportClaudeCodeAgentMarkdown,
  parseClaudeCodeAgentMarkdown,
} from '../claude-code-agent-compat-service.js';

describe('claude-code-agent-compat-service', () => {
  it('imports Claude Code subagent Markdown into an agent-template manifest', () => {
    const parsed = parseClaudeCodeAgentMarkdown([
      '---',
      'description: Security review helper',
      'tools:',
      '  - Read',
      '  - Grep',
      'model: sonnet',
      '---',
      '',
      'Review this change for security issues.',
      '',
    ].join('\n'), { id: 'security-reviewer', version: '2.0.0' });

    expect(parsed).toMatchObject({
      content: 'Review this change for security issues.',
      manifest: {
        id: 'security-reviewer',
        version: '2.0.0',
        kind: 'agent-template',
        runtime: {
          tools: ['Read', 'Grep'],
          model: 'sonnet',
        },
        compat: {
          claudeCode: 'markdown-yaml',
        },
      },
    });
  });

  it('exports the compatible Claude Code frontmatter and excludes Argus dialogs', () => {
    const markdown = exportClaudeCodeAgentMarkdown({
      description: 'Crash triage helper',
      runtime: {
        tools: ['Read', 'Bash'],
        model: 'opus',
      },
      dialogs: {
        setup: {
          fields: [{ id: 'project', label: 'Project', type: 'text' }],
        },
      },
      content: 'Investigate the crash and summarize the fix.',
    });

    expect(markdown).toContain('description: Crash triage helper');
    expect(markdown).toContain('tools:');
    expect(markdown).toContain('- Read');
    expect(markdown).toContain('model: opus');
    expect(markdown).toContain('Investigate the crash and summarize the fix.');
    expect(markdown).not.toContain('dialogs:');
    expect(markdown).not.toContain('setup:');
  });
});
