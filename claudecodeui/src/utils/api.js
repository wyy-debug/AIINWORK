// Utility function for API calls.
export const apiFetch = (url, options = {}) => {
  const defaultHeaders = {};

  // Only set Content-Type for non-FormData requests
  if (!(options.body instanceof FormData)) {
    defaultHeaders['Content-Type'] = 'application/json';
  }

  return fetch(url, {
    ...options,
    headers: {
      ...defaultHeaders,
      ...options.headers,
    },
  });
};

// API endpoints
export const api = {
  // config endpoint removed - no longer needed (frontend uses window.location)
  projects: () => apiFetch('/api/projects'),
  sessions: (projectName, limit = 5, offset = 0) =>
    apiFetch(`/api/projects/${projectName}/sessions?limit=${limit}&offset=${offset}`),
  // Unified endpoint: all providers through one URL
  unifiedSessionMessages: (sessionId, provider = 'claude', { projectName = '', projectPath = '', limit = null, offset = 0 } = {}) => {
    const params = new URLSearchParams();
    params.append('provider', provider);
    if (projectName) params.append('projectName', projectName);
    if (projectPath) params.append('projectPath', projectPath);
    if (limit !== null) {
      params.append('limit', String(limit));
      params.append('offset', String(offset));
    }
    const queryString = params.toString();
    return apiFetch(`/api/sessions/${encodeURIComponent(sessionId)}/messages${queryString ? `?${queryString}` : ''}`);
  },
  renameProject: (projectName, displayName) =>
    apiFetch(`/api/projects/${projectName}/rename`, {
      method: 'PUT',
      body: JSON.stringify({ displayName }),
    }),
  deleteSession: (projectName, sessionId) =>
    apiFetch(`/api/projects/${projectName}/sessions/${sessionId}`, {
      method: 'DELETE',
    }),
  renameSession: (sessionId, summary, provider) =>
    apiFetch(`/api/sessions/${sessionId}/rename`, {
      method: 'PUT',
      body: JSON.stringify({ summary, provider }),
    }),
  deleteCodexSession: (sessionId) =>
    apiFetch(`/api/codex/sessions/${sessionId}`, {
      method: 'DELETE',
    }),
  deleteGeminiSession: (sessionId) =>
    apiFetch(`/api/gemini/sessions/${sessionId}`, {
      method: 'DELETE',
    }),
  deleteProject: (projectName, force = false, deleteData = false) => {
    const params = new URLSearchParams();
    if (force) params.set('force', 'true');
    if (deleteData) params.set('deleteData', 'true');
    const qs = params.toString();
    return apiFetch(`/api/projects/${projectName}${qs ? `?${qs}` : ''}`, {
      method: 'DELETE',
    });
  },
  searchConversationsUrl: (query, limit = 50) => {
    const params = new URLSearchParams({ q: query, limit: String(limit) });
    return `/api/search/conversations?${params.toString()}`;
  },
  createWorkspace: (workspaceData) =>
    apiFetch('/api/projects/create-workspace', {
      method: 'POST',
      body: JSON.stringify(workspaceData),
    }),
  agents: (includePaused = true) =>
    apiFetch(`/api/agents?includePaused=${includePaused ? 'true' : 'false'}`),
  conversations: (limit = 50, offset = 0) =>
    apiFetch(`/api/conversations?limit=${limit}&offset=${offset}`),
  conversationSessions: (limit = 50, offset = 0) =>
    apiFetch(`/api/conversations/sessions?limit=${limit}&offset=${offset}`),
  deleteConversationSession: (sessionId) =>
    apiFetch(`/api/conversations/sessions/${encodeURIComponent(sessionId)}`, {
      method: 'DELETE',
    }),
  createAgent: (agentData) =>
    apiFetch('/api/agents', {
      method: 'POST',
      body: JSON.stringify(agentData),
    }),
  updateAgent: (agentId, agentData) =>
    apiFetch(`/api/agents/${encodeURIComponent(agentId)}`, {
      method: 'PUT',
      body: JSON.stringify(agentData),
    }),
  deleteAgent: (agentId) =>
    apiFetch(`/api/agents/${encodeURIComponent(agentId)}`, {
      method: 'DELETE',
    }),
  uploadAgentKnowledge: (agentId, formData) =>
    apiFetch(`/api/agents/${encodeURIComponent(agentId)}/knowledge/upload`, {
      method: 'POST',
      body: formData,
      headers: {},
    }),
  agentKnowledge: (agentId) =>
    apiFetch(`/api/agents/${encodeURIComponent(agentId)}/knowledge`),
  deleteAgentKnowledgeSource: (agentId, sourceId) =>
    apiFetch(`/api/agents/${encodeURIComponent(agentId)}/knowledge/${encodeURIComponent(sourceId)}`, {
      method: 'DELETE',
    }),
  reindexAgentKnowledgeSource: (agentId, sourceId) =>
    apiFetch(`/api/agents/${encodeURIComponent(agentId)}/knowledge/${encodeURIComponent(sourceId)}/reindex`, {
      method: 'POST',
    }),
  sessionAgent: (sessionId, provider = 'claude') =>
    apiFetch(`/api/sessions/${encodeURIComponent(sessionId)}/agent?provider=${encodeURIComponent(provider)}`),
  /**
   * @param {string} sessionId
   * @param {string} agentId
   * @param {string} [provider]
   * @param {unknown} [configuration]
   */
  updateSessionAgent: (sessionId, agentId, provider = 'claude', configuration = null) =>
    apiFetch(`/api/sessions/${encodeURIComponent(sessionId)}/agent`, {
      method: 'PUT',
      body: JSON.stringify({ agentId, provider, configuration }),
    }),
  clearSessionAgent: (sessionId, provider = 'claude') =>
    apiFetch(`/api/sessions/${encodeURIComponent(sessionId)}/agent?provider=${encodeURIComponent(provider)}`, {
      method: 'DELETE',
    }),
  mcpServers: (provider = 'claude', scope = 'user', workspacePath = '') => {
    const params = new URLSearchParams({ scope });
    if (workspacePath) params.set('workspacePath', workspacePath);
    return apiFetch(`/api/providers/${encodeURIComponent(provider)}/mcp/servers?${params.toString()}`);
  },
  upsertMcpServer: (provider = 'claude', payload) =>
    apiFetch(`/api/providers/${encodeURIComponent(provider)}/mcp/servers`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  inspectMcpServer: (provider = 'claude', serverName, scope = 'user', workspacePath = '') => {
    const params = new URLSearchParams({ scope });
    if (workspacePath) params.set('workspacePath', workspacePath);
    return apiFetch(`/api/providers/${encodeURIComponent(provider)}/mcp/servers/${encodeURIComponent(serverName)}/inspect?${params.toString()}`);
  },
  deleteMcpServer: (provider = 'claude', serverName, scope = 'user', workspacePath = '') => {
    const params = new URLSearchParams({ scope });
    if (workspacePath) params.set('workspacePath', workspacePath);
    return apiFetch(`/api/providers/${encodeURIComponent(provider)}/mcp/servers/${encodeURIComponent(serverName)}?${params.toString()}`, {
      method: 'DELETE',
    });
  },
  readFile: (projectName, filePath) =>
    apiFetch(`/api/projects/${projectName}/file?filePath=${encodeURIComponent(filePath)}`),
  readFileBlob: (projectName, filePath) =>
    apiFetch(`/api/projects/${projectName}/files/content?path=${encodeURIComponent(filePath)}`),
  saveFile: (projectName, filePath, content) =>
    apiFetch(`/api/projects/${projectName}/file`, {
      method: 'PUT',
      body: JSON.stringify({ filePath, content }),
    }),
  getFiles: (projectName, options = {}) =>
    apiFetch(`/api/projects/${projectName}/files`, options),

  // File operations
  createFile: (projectName, { path, type, name }) =>
    apiFetch(`/api/projects/${projectName}/files/create`, {
      method: 'POST',
      body: JSON.stringify({ path, type, name }),
    }),

  renameFile: (projectName, { oldPath, newName }) =>
    apiFetch(`/api/projects/${projectName}/files/rename`, {
      method: 'PUT',
      body: JSON.stringify({ oldPath, newName }),
    }),

  deleteFile: (projectName, { path, type }) =>
    apiFetch(`/api/projects/${projectName}/files`, {
      method: 'DELETE',
      body: JSON.stringify({ path, type }),
    }),

  uploadFiles: (projectName, formData) =>
    apiFetch(`/api/projects/${projectName}/files/upload`, {
      method: 'POST',
      body: formData,
      headers: {}, // Let browser set Content-Type for FormData
    }),

  // TaskMaster endpoints
  taskmaster: {
    // Initialize TaskMaster in a project
    init: (projectName) =>
      apiFetch(`/api/taskmaster/init/${projectName}`, {
        method: 'POST',
      }),

    // Add a new task
    addTask: (projectName, { prompt, title, description, priority, dependencies }) =>
      apiFetch(`/api/taskmaster/add-task/${projectName}`, {
        method: 'POST',
        body: JSON.stringify({ prompt, title, description, priority, dependencies }),
      }),

    // Parse PRD to generate tasks
    parsePRD: (projectName, { fileName, numTasks, append }) =>
      apiFetch(`/api/taskmaster/parse-prd/${projectName}`, {
        method: 'POST',
        body: JSON.stringify({ fileName, numTasks, append }),
      }),

    // Get available PRD templates
    getTemplates: () =>
      apiFetch('/api/taskmaster/prd-templates'),

    // Apply a PRD template
    applyTemplate: (projectName, { templateId, fileName, customizations }) =>
      apiFetch(`/api/taskmaster/apply-template/${projectName}`, {
        method: 'POST',
        body: JSON.stringify({ templateId, fileName, customizations }),
      }),

    // Update a task
    updateTask: (projectName, taskId, updates) =>
      apiFetch(`/api/taskmaster/update-task/${projectName}/${taskId}`, {
        method: 'PUT',
        body: JSON.stringify(updates),
      }),
  },

  // Browse filesystem for project suggestions
  browseFilesystem: (dirPath = null) => {
    const params = new URLSearchParams();
    if (dirPath) params.append('path', dirPath);

    return apiFetch(`/api/browse-filesystem?${params}`);
  },

  createFolder: (folderPath) =>
    apiFetch('/api/create-folder', {
      method: 'POST',
      body: JSON.stringify({ path: folderPath }),
    }),

  // Generic GET method for any endpoint
  get: (endpoint) => apiFetch(`/api${endpoint}`),

  // Generic POST method for any endpoint
  post: (endpoint, body) => apiFetch(`/api${endpoint}`, {
    method: 'POST',
    ...(body instanceof FormData ? { body } : { body: JSON.stringify(body) }),
  }),

  // Generic PUT method for any endpoint
  put: (endpoint, body) => apiFetch(`/api${endpoint}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  }),

  // Generic DELETE method for any endpoint
  delete: (endpoint, options = {}) => apiFetch(`/api${endpoint}`, {
    method: 'DELETE',
    ...options,
  }),
};
