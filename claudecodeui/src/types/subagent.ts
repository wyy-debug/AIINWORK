export type SubagentRunStatus = 'running' | 'completed' | 'failed' | 'stopped' | string;

export interface SubagentRunEvent {
  id: string;
  type: string;
  payload?: Record<string, unknown>;
  createdAt?: number;
}

export interface SubagentRun {
  id: string;
  agentId: string;
  agentName: string;
  agentMode?: string;
  objective: string;
  projectPath?: string;
  sessionId?: string;
  source?: string;
  status: SubagentRunStatus;
  result?: string;
  error?: string;
  createdAt?: number;
  updatedAt?: number;
  events?: SubagentRunEvent[];
}
