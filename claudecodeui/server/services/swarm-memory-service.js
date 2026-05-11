export function createSwarmMemoryStore({ store } = {}) {
  if (!store) {
    throw new Error('createSwarmMemoryStore requires a store');
  }

  return {
    record(entry = {}) {
      if (!entry.runId) throw new Error('runId is required');
      if (!entry.content) throw new Error('memory content is required');
      return store.recordMemory(entry);
    },

    list(runId) {
      return store.listMemory(runId);
    },

    update(memoryId, patch = {}) {
      if (!memoryId) throw new Error('memoryId is required');
      return store.updateMemory(memoryId, patch);
    },

    delete(memoryId) {
      if (!memoryId) throw new Error('memoryId is required');
      return store.deleteMemory(memoryId);
    },

    exportRun(runId) {
      if (!runId) throw new Error('runId is required');
      return {
        runId,
        exportedAt: new Date().toISOString(),
        memory: store.listMemory(runId),
      };
    },

    promoteToExamples({ runId, maxItems = 12 } = {}) {
      return store.listMemory(runId)
        .filter((entry) => entry.promoteable)
        .slice(0, maxItems)
        .map((entry) => ({
          title: entry.title,
          transcript: [{ role: 'system', content: entry.content }],
        }));
    },

    promoteReviewedToExamples({ runId, memoryIds = [], maxItems = 12 } = {}) {
      const selected = new Set(Array.isArray(memoryIds) ? memoryIds : []);
      return store.listMemory(runId)
        .filter((entry) => selected.has(entry.id) && entry.promoteable)
        .slice(0, maxItems)
        .map((entry) => ({
          title: entry.title,
          transcript: [{ role: 'system', content: entry.content }],
        }));
    },
  };
}
