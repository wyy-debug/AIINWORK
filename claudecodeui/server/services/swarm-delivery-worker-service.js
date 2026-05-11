function isDeliverableAgent(agent) {
  return agent && !['failed', 'cancelled', 'completed'].includes(agent.status);
}

function uniqueAgents(agents) {
  const seen = new Set();
  return agents.filter((agent) => {
    if (!agent?.id || seen.has(agent.id)) return false;
    seen.add(agent.id);
    return true;
  });
}

function topicSubscribers(run, topic) {
  const topics = Array.isArray(run?.template?.routing?.topics) ? run.template.routing.topics : [];
  const match = topics.find((entry) => entry?.name === topic);
  return Array.isArray(match?.subscribers) ? match.subscribers : [];
}

function resolveTargets({ store, run, message }) {
  if (message.toAgentId) {
    return {
      deliveryMode: 'direct',
      agents: [store.getAgent(message.toAgentId)].filter(isDeliverableAgent),
    };
  }

  const allAgents = store.listAgents(message.runId).filter(isDeliverableAgent);
  if (!message.topic || message.topic === '*') {
    return {
      deliveryMode: 'broadcast',
      agents: allAgents,
    };
  }

  const subscriberRoleIds = new Set(topicSubscribers(run, message.topic));
  const agents = allAgents.filter((agent) => {
    if (subscriberRoleIds.has(agent.roleId)) return true;
    return Array.isArray(agent.metadata?.topics) && agent.metadata.topics.includes(message.topic);
  });

  return {
    deliveryMode: 'topic',
    agents: uniqueAgents(agents),
  };
}

function deliveredAgentsSinceLastReplay(store, message) {
  if (typeof store.listDeliveryTrace !== 'function') return new Set();
  const trace = store.listDeliveryTrace(message.id, message.runId);
  const checkpointIndex = trace.reduce((lastIndex, entry, index) => (
    ['published', 'replayed'].includes(entry.status) ? index : lastIndex
  ), -1);
  const delivered = new Set();
  for (const entry of trace.slice(Math.max(0, checkpointIndex + 1))) {
    if (!entry.agentId) continue;
    if (entry.status === 'delivered') delivered.add(entry.agentId);
    if (entry.status === 'failed') delivered.delete(entry.agentId);
  }
  return delivered;
}

export function createSwarmDeliveryWorker({
  store,
  bus,
  runtimeAdapterResolver,
  now = () => Date.now(),
} = {}) {
  if (!store) throw new Error('createSwarmDeliveryWorker requires a store');
  if (!bus) throw new Error('createSwarmDeliveryWorker requires a message bus');

  const resolveRuntimeAdapter = typeof runtimeAdapterResolver === 'function'
    ? runtimeAdapterResolver
    : () => ({ deliverMessage: async () => ({ success: true, mode: 'local-control-plane' }) });

  async function processMessage(message) {
    const run = store.getRun(message.runId);
    if (!run) throw new Error('swarm run not found');
    const { deliveryMode, agents } = resolveTargets({ store, run, message });
    if (agents.length === 0) {
      bus.failDelivery(message.id, 'No swarm agent matched the message target.');
      return { acknowledged: false, failed: true };
    }

    try {
      const runtimeAdapter = resolveRuntimeAdapter(run);
      let lastAgent = null;
      const alreadyDelivered = deliveredAgentsSinceLastReplay(store, message);
      const pendingAgents = agents.filter((agent) => !alreadyDelivered.has(agent.id));
      if (pendingAgents.length === 0) {
        bus.ack(message.id, agents[agents.length - 1]?.id || '');
        return { acknowledged: true, failed: false };
      }
      for (const agent of pendingAgents) {
        lastAgent = agent;
        bus.deliver(message.id, agent.id, { deliveryMode });
        const activeMessage = store.getMessage(message.id);
        const result = typeof runtimeAdapter.deliverMessage === 'function'
          ? await runtimeAdapter.deliverMessage({ run, agent, message: activeMessage, deliveryMode })
          : { success: true, mode: 'local-control-plane' };
        if (result?.success === false) {
          bus.failDelivery(message.id, result?.error || 'Swarm message delivery failed.', { agentId: agent.id });
          return { acknowledged: false, failed: true };
        }
      }
      bus.ack(message.id, lastAgent?.id || '');
      return { acknowledged: true, failed: false };
    } catch (error) {
      bus.failDelivery(message.id, error?.message || 'Swarm message delivery failed.');
      return { acknowledged: false, failed: true };
    }
  }

  return {
    resolveTargets(message) {
      return resolveTargets({ store, run: store.getRun(message.runId), message });
    },

    async processRun(runId) {
      const messages = store.listDeliverableMessages(runId, now());
      const result = {
        processed: 0,
        acknowledged: 0,
        failed: 0,
      };
      for (const message of messages) {
        result.processed += 1;
        const delivery = await processMessage(message);
        if (delivery.acknowledged) result.acknowledged += 1;
        if (delivery.failed) result.failed += 1;
      }
      return result;
    },

    async processMessage(messageId) {
      const message = store.getMessage(messageId);
      if (!message) throw new Error('swarm message not found');
      return processMessage(message);
    },
  };
}
