const MULTI_AGENT_INTENT_RE = /(?:多个|多名|多\s*agent|多\s*Agent|multi[-\s]?agent|subagent|子\s*agent|子Agent|派发|分发|并行.{0,12}agent|agent.{0,12}协作)/i;

function normalizePrompt(prompt: string): string {
  return prompt.replace(/\s+/g, ' ').trim();
}

export function getSubagentDispatchPlanKey({
  prompt,
  agentId,
}: {
  prompt: string;
  agentId?: string;
}): string {
  const normalizedAgentId = agentId?.trim() || '__default__';
  return `${normalizedAgentId}:${normalizePrompt(prompt)}`;
}

export function shouldRequestSubagentDispatchPlan({
  prompt,
  explicitDispatch = false,
}: {
  prompt: string;
  explicitDispatch?: boolean;
}): boolean {
  if (explicitDispatch) return true;
  return MULTI_AGENT_INTENT_RE.test(prompt || '');
}

export function buildSubagentDispatchPlanRequest({
  prompt,
  agentName,
}: {
  prompt: string;
  agentName?: string;
}): string {
  const normalizedPrompt = normalizePrompt(prompt);
  const resolvedAgentName = agentName?.trim() || 'current main agent';
  return [
    'Do not call spawn_agent, Task, AgentSpawn, followup_task, send_message, or any subagent control tool yet.',
    'First produce a user-reviewable Subagent Dispatch Plan. The user must approve it before any subagent is launched.',
    '',
    `Original user request: ${normalizedPrompt || '(empty request)'}`,
    `Main agent to plan from: ${resolvedAgentName}`,
    '',
    'Wrap the official plan exactly once in <proposed_plan>...</proposed_plan>.',
    'The plan must be concrete enough for direct dispatch and must include how many agents will be launched.',
    '',
    'Use this Markdown shape inside the proposed_plan block:',
    '# Subagent Dispatch Plan',
    '',
    '## Summary',
    '- Briefly restate the objective and why parallel agents are useful.',
    '',
    '## Agent Dispatch',
    '| # | Agent type | Task name | Objective | Scope / files | Expected output |',
    '| - | ---------- | --------- | --------- | ------------- | --------------- |',
    '| 1 | Explore | backend_review | ... | ... | ... |',
    '',
    '## Count',
    '- Total agents: N',
    '- Why this count is enough:',
    '',
    '## Merge Plan',
    '- How the main agent will collect, compare, and summarize subagent results.',
    '',
    'Do not execute the plan. Do not say you have already dispatched agents.',
  ].join('\n');
}

export function isSubagentDispatchPlanContent(content: string): boolean {
  const normalized = content || '';
  return /Subagent Dispatch Plan/i.test(normalized)
    && /Agent Dispatch/i.test(normalized)
    && /Total agents|how many agents|Agent type|Task name|Count/i.test(normalized);
}

export function buildApprovedSubagentDispatchCommand(content: string): string {
  return [
    'PLEASE DISPATCH THESE SUBAGENTS EXACTLY AS APPROVED.',
    '',
    'Use the approved plan below as the source of truth. Spawn only the listed agents unless a listed agent is impossible, and report back if anything blocks dispatch.',
    '',
    content.trim(),
  ].join('\n');
}
