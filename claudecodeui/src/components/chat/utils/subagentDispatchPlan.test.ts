import { describe, expect, it } from 'vitest';

import {
  buildApprovedSubagentDispatchCommand,
  buildSubagentDispatchPlanRequest,
  getSubagentDispatchPlanKey,
  isSubagentDispatchPlanContent,
  shouldRequestSubagentDispatchPlan,
} from './subagentDispatchPlan';

describe('subagentDispatchPlan', () => {
  it('detects natural-language multi-agent dispatch requests', () => {
    expect(shouldRequestSubagentDispatchPlan({
      prompt: '用多个agent进行review项目',
      explicitDispatch: false,
    })).toBe(true);
    expect(shouldRequestSubagentDispatchPlan({
      prompt: 'Review this file normally',
      explicitDispatch: false,
    })).toBe(false);
    expect(shouldRequestSubagentDispatchPlan({
      prompt: 'Review this file normally',
      explicitDispatch: true,
    })).toBe(true);
  });

  it('builds a model-generated dispatch plan request before any subagent spawn', () => {
    const request = buildSubagentDispatchPlanRequest({
      prompt: 'Review backend and frontend changes',
      agentName: 'Review Agent',
    });

    expect(request).toContain('Do not call spawn_agent');
    expect(request).toContain('Subagent Dispatch Plan');
    expect(request).toContain('Agent Dispatch');
    expect(request).toContain('how many agents');
    expect(request).toContain('Allowed agent_type values are default, explorer, and worker');
    expect(request).toContain('| 1 | worker | backend_review |');
    expect(request).toContain('Review backend and frontend changes');
    expect(request).toContain('Review Agent');
  });

  it('recognizes approved subagent dispatch plans and builds the implementation command', () => {
    const content = [
      '# Subagent Dispatch Plan',
      '',
      '## Agent Dispatch',
      '| Agent | Count | Task |',
      '| Explore | 2 | backend/frontend review |',
    ].join('\n');

    expect(isSubagentDispatchPlanContent(content)).toBe(true);
    expect(buildApprovedSubagentDispatchCommand(content)).toContain('PLEASE DISPATCH THESE SUBAGENTS');
    expect(buildApprovedSubagentDispatchCommand(content)).toContain('native manager/coordinator path');
    expect(buildApprovedSubagentDispatchCommand(content)).toContain('Do not print internal preparation narration');
    expect(buildApprovedSubagentDispatchCommand(content)).toContain(content);
  });

  it('creates a stable approval key for the current prompt and agent', () => {
    expect(getSubagentDispatchPlanKey({ prompt: '  Do work  ', agentId: 'agent-a' })).toBe('agent-a:Do work');
    expect(getSubagentDispatchPlanKey({ prompt: 'Do work', agentId: '' })).toBe('__default__:Do work');
  });
});
