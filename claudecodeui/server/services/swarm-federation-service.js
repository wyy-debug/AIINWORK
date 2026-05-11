function normalizeProvider(value) {
  const provider = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return provider || 'local';
}

export function createSwarmFederationGateway({ provider = 'local', orchestrator = null } = {}) {
  const normalizedProvider = normalizeProvider(provider);
  if (normalizedProvider === 'remote-http-placeholder') {
    return {
      provider: normalizedProvider,
      enabled: false,
      async dispatch() {
        return {
          success: false,
          provider: normalizedProvider,
          error: 'Remote HTTP swarm federation is a placeholder in this preview build.',
        };
      },
    };
  }

  return {
    provider: 'local',
    enabled: true,
    async dispatch(payload = {}) {
      if (!orchestrator || typeof orchestrator.startRun !== 'function') {
        return {
          success: false,
          provider: 'local',
          error: 'Local swarm orchestrator is unavailable.',
        };
      }
      const run = await orchestrator.startRun(payload);
      return { success: true, provider: 'local', run };
    },
  };
}
