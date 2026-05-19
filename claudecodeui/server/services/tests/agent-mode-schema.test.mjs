import { describe, expect, test } from 'vitest';

import { normalizeAgentConfig, filterAgentsByMode } from '../agent-config-service.js';

describe('agent mode schema', () => {
  test('normalizes OpenCode-style primary and subagent agent fields', () => {
    const agent = normalizeAgentConfig({
      id: 'reviewer',
      name: 'Reviewer',
      description: 'Review code',
      mode: 'subagent',
      hidden: true,
      color: 'cyan',
      maxTurns: 8,
      permission: {
        edit: 'deny',
        task: {
          '*': 'deny',
          explorer: 'allow',
        },
      },
      mcpServers: ['github'],
      skills: ['code-review-security'],
      modelProfileId: 'sonnet-large',
    });

    expect(agent.mode).toBe('subagent');
    expect(agent.hidden).toBe(true);
    expect(agent.color).toBe('cyan');
    expect(agent.maxTurns).toBe(8);
    expect(agent.permission.task).toEqual({ '*': 'deny', explorer: 'allow' });
    expect(agent.mcpServers).toEqual(['github']);
    expect(agent.skills).toEqual(['code-review-security']);
    expect(agent.modelProfileId).toBe('sonnet-large');
  });

  test('filters agents by primary and subagent mode', () => {
    const agents = [
      normalizeAgentConfig({ id: 'build', name: 'Build', mode: 'primary' }),
      normalizeAgentConfig({ id: 'explore', name: 'Explore', mode: 'subagent' }),
      normalizeAgentConfig({ id: 'docs', name: 'Docs', mode: 'all' }),
    ];

    expect(filterAgentsByMode(agents, 'primary').map((agent) => agent.id)).toEqual(['build', 'docs']);
    expect(filterAgentsByMode(agents, 'subagent').map((agent) => agent.id)).toEqual(['explore', 'docs']);
    expect(filterAgentsByMode(agents, 'all').map((agent) => agent.id)).toEqual(['build', 'explore', 'docs']);
  });
});
