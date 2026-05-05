import { describe, expect, it } from 'vitest';

import { getSubagentBlockerGuidance } from './subagentGuidance';

describe('getSubagentBlockerGuidance', () => {
  it('asks for login or exported data when authentication blocks the agent', () => {
    const guidance = getSubagentBlockerGuidance({
      status: 'BLOCKED',
      stopReason: 'CrashSight returned 401 login required while fetching crash data',
      objective: 'Fetch crash page',
    });

    expect(guidance.title).toBe('需要登录或提供导出数据');
    expect(guidance.description).toContain('Fetch crash page');
    expect(guidance.nextAction).toContain('登录');
    expect(guidance.nextAction).toContain('导出');
  });

  it('points to MCP configuration when setup fields are missing', () => {
    const guidance = getSubagentBlockerGuidance({
      status: 'BLOCKED',
      stopReason: 'REDMINE_API_KEY missing; ainwork-code-search root is not configured',
      lastTool: 'soc-redmine',
    });

    expect(guidance.title).toBe('需要补全 MCP 配置');
    expect(guidance.nextAction).toContain('MCP');
    expect(guidance.nextAction).toContain('重新检测');
  });

  it('explains cancelled agents do not occupy background capacity', () => {
    const guidance = getSubagentBlockerGuidance({
      status: 'cancelled',
      stopReason: 'Cancelled by user',
      objective: 'Analyze crash',
    });

    expect(guidance.title).toBe('后台 Agent 已停止');
    expect(guidance.nextAction).toContain('重新派发');
    expect(guidance.description).toContain('不会继续占用');
  });

  it('falls back to asking for parent input for generic blockers', () => {
    const guidance = getSubagentBlockerGuidance({
      status: 'BLOCKED',
      stopReason: 'No matching files found',
      objective: 'Find related tests',
    });

    expect(guidance.title).toBe('需要补充信息');
    expect(guidance.description).toContain('Find related tests');
    expect(guidance.nextAction).toContain('补充');
  });
});
