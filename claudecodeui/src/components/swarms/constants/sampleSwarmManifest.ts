import type { SwarmRole, SwarmTopology } from '../../../types/swarm';

export const SAMPLE_SWARM_TOPOLOGY: SwarmTopology = {
  type: 'queen',
  coordinatorRoleId: 'queen',
  edges: [
    { from: 'queen', to: 'security-reviewer', topic: 'review.assignments' },
    { from: 'queen', to: 'test-writer', topic: 'test.assignments' },
    { from: 'security-reviewer', to: 'summarizer', topic: 'review.findings' },
    { from: 'test-writer', to: 'summarizer', topic: 'test.findings' },
  ],
};

export const SAMPLE_SWARM_ROLES: SwarmRole[] = [
  { id: 'queen', label: 'Coordinator', agentTemplateId: 'review-coordinator', count: 1 },
  { id: 'security-reviewer', label: 'Security reviewer', agentTemplateId: 'security-reviewer', count: 1 },
  { id: 'test-writer', label: 'Test writer', agentTemplateId: 'test-writer', count: 1 },
  { id: 'summarizer', label: 'Summarizer', agentTemplateId: 'summarizer', count: 1 },
];
