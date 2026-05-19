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
  runtimeTimeline: (sessionId, provider = 'claude', { projectName = '', projectPath = '' } = {}) => {
    const params = new URLSearchParams();
    params.append('provider', provider);
    if (projectName) params.append('projectName', projectName);
    if (projectPath) params.append('projectPath', projectPath);
    const queryString = params.toString();
    return apiFetch(`/api/sessions/${encodeURIComponent(sessionId)}/timeline${queryString ? `?${queryString}` : ''}`);
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
  updateSessionMetadata: (sessionId, metadata, provider = 'claude') =>
    apiFetch(`/api/sessions/${encodeURIComponent(sessionId)}/metadata`, {
      method: 'PATCH',
      body: JSON.stringify({ provider, ...metadata }),
    }),
  sessionGoal: (sessionId) =>
    apiFetch(`/api/sessions/${encodeURIComponent(sessionId)}/goal`),
  /**
   * @param {{ sessionId?: string | null; provider?: string; projectPath?: string; limit?: number }} [options]
   */
  checkpoints: ({ sessionId, provider, projectPath, limit = 50 } = {}) => {
    const params = new URLSearchParams();
    if (sessionId) params.set('sessionId', sessionId);
    if (provider) params.set('provider', provider);
    if (projectPath) params.set('projectPath', projectPath);
    params.set('limit', String(limit));
    return apiFetch(`/api/checkpoints?${params.toString()}`);
  },
  checkpointDiff: (checkpointId) =>
    apiFetch(`/api/checkpoints/${encodeURIComponent(checkpointId)}/diff`),
  rollbackCheckpoint: (checkpointId) =>
    apiFetch(`/api/checkpoints/${encodeURIComponent(checkpointId)}/rollback`, {
      method: 'POST',
    }),
  deleteCheckpoint: (checkpointId) =>
    apiFetch(`/api/checkpoints/${encodeURIComponent(checkpointId)}`, {
      method: 'DELETE',
    }),
  setSessionGoal: (sessionId, payload) =>
    apiFetch(`/api/sessions/${encodeURIComponent(sessionId)}/goal`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  clearSessionGoal: (sessionId) =>
    apiFetch(`/api/sessions/${encodeURIComponent(sessionId)}/goal`, {
      method: 'DELETE',
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
    return apiFetch(`/api/projects/${encodeURIComponent(projectName)}${qs ? `?${qs}` : ''}`, {
      method: 'DELETE',
    });
  },
  createProjectWorktree: (projectName, payload = {}) =>
    apiFetch(`/api/projects/${encodeURIComponent(projectName)}/worktrees`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  projectWorktrees: (projectName) =>
    apiFetch(`/api/projects/${encodeURIComponent(projectName)}/worktrees`),
  worktree: (worktreeId) =>
    apiFetch(`/api/worktrees/${encodeURIComponent(worktreeId)}`),
  updateWorktreeSession: (worktreeId, sessionId, provider = 'claude') =>
    apiFetch(`/api/worktrees/${encodeURIComponent(worktreeId)}/session`, {
      method: 'POST',
      body: JSON.stringify({ sessionId, provider }),
    }),
	  createWorktreeBranch: (worktreeId, branchName) =>
	    apiFetch(`/api/worktrees/${encodeURIComponent(worktreeId)}/create-branch`, {
	      method: 'POST',
	      body: JSON.stringify({ branchName }),
	    }),
  handoffWorktree: (worktreeId, payload = {}) =>
    apiFetch(`/api/worktrees/${encodeURIComponent(worktreeId)}/handoff`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  runWorktreeSetup: (worktreeId, payload = {}) =>
    apiFetch(`/api/worktrees/${encodeURIComponent(worktreeId)}/run-setup`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
	  deleteWorktree: (worktreeId, force = false) =>
    apiFetch(`/api/worktrees/${encodeURIComponent(worktreeId)}${force ? '?force=true' : ''}`, {
      method: 'DELETE',
    }),
  searchConversationsUrl: (query, limit = 50) => {
    const params = new URLSearchParams({ q: query, limit: String(limit) });
    return `/api/search/conversations?${params.toString()}`;
  },
  createWorkspace: (workspaceData) =>
    apiFetch('/api/projects/create-workspace', {
      method: 'POST',
      body: JSON.stringify(workspaceData),
    }),
  previewProjectProfile: (projectPath) =>
    apiFetch('/api/project-profile/preview', {
      method: 'POST',
      body: JSON.stringify({ projectPath }),
    }),
  writeProjectProfile: (projectPath) =>
    apiFetch('/api/project-profile/write', {
      method: 'POST',
      body: JSON.stringify({ projectPath }),
    }),
  agents: (includePaused = true, mode = '') => {
    const params = new URLSearchParams({ includePaused: includePaused ? 'true' : 'false' });
    if (mode) params.set('mode', mode);
    return apiFetch(`/api/agents?${params.toString()}`);
  },
  installedAgentSkills: (workspacePath = '') => {
    const params = new URLSearchParams();
    if (workspacePath) params.set('workspacePath', workspacePath);
    const query = params.toString();
    return apiFetch(`/api/agents/skills/installed${query ? `?${query}` : ''}`);
  },
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
  capabilityMarketplace: (workspacePath = '') => {
    const params = new URLSearchParams();
    if (workspacePath) params.set('workspacePath', workspacePath);
    const query = params.toString();
    return apiFetch(`/api/capability-marketplace${query ? `?${query}` : ''}`);
  },
  setCapabilityMarketplaceEnabled: (itemId, enabled) =>
    apiFetch(`/api/capability-marketplace/${encodeURIComponent(itemId)}/enabled`, {
      method: 'POST',
      body: JSON.stringify({ enabled }),
    }),
  installCapabilityMarketplaceItem: (itemId, { scope = 'user', configuration = {} } = {}) =>
    apiFetch(`/api/capability-marketplace/${encodeURIComponent(itemId)}/install`, {
      method: 'POST',
      body: JSON.stringify({ scope, configuration }),
    }),
  generateGitReviewFlow: ({ project = '', checkpointId = '' } = {}) =>
    apiFetch('/api/git/review-flow', {
      method: 'POST',
      body: JSON.stringify({ project, checkpointId }),
    }),
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
  diagnoseMcpServer: (provider = 'claude', serverName, scope = 'user', workspacePath = '') => {
    const params = new URLSearchParams({ scope });
    if (workspacePath) params.set('workspacePath', workspacePath);
    return apiFetch(`/api/providers/${encodeURIComponent(provider)}/mcp/servers/${encodeURIComponent(serverName)}/diagnose?${params.toString()}`);
  },
  deleteMcpServer: (provider = 'claude', serverName, scope = 'user', workspacePath = '') => {
    const params = new URLSearchParams({ scope });
    if (workspacePath) params.set('workspacePath', workspacePath);
    return apiFetch(`/api/providers/${encodeURIComponent(provider)}/mcp/servers/${encodeURIComponent(serverName)}?${params.toString()}`, {
      method: 'DELETE',
    });
  },
  agentRepositoryCatalog: () => apiFetch('/api/agent-repository/catalog'),
  recipeCatalog: () => apiFetch('/api/recipes/catalog'),
  validateRecipe: (recipe) =>
    apiFetch('/api/recipes/validate', {
      method: 'POST',
      body: JSON.stringify({ recipe }),
    }),
  validateRecipePackage: (recipePackage) =>
    apiFetch('/api/recipes/packages/validate', {
      method: 'POST',
      body: JSON.stringify({ package: recipePackage }),
    }),
  importRecipePackage: (recipePackage) =>
    apiFetch('/api/recipes/packages/import', {
      method: 'POST',
      body: JSON.stringify({ package: recipePackage }),
    }),
  exportRecipePackage: (recipeIds = []) =>
    apiFetch('/api/recipes/packages/export', {
      method: 'POST',
      body: JSON.stringify({ recipeIds }),
    }),
  permissionPresets: () => apiFetch('/api/permission-presets'),
  resolvePermissionPreset: (permissionPreset, baseOptions = {}) =>
    apiFetch('/api/permission-presets/resolve', {
      method: 'POST',
      body: JSON.stringify({ permissionPreset, baseOptions }),
    }),
  invokeAgent: (agentId, payload = {}) =>
    apiFetch(`/api/agents/${encodeURIComponent(agentId)}/invoke`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  subagentRuns: ({ limit = 25, status = '', agentId = '' } = {}) => {
    const params = new URLSearchParams();
    if (limit) params.set('limit', String(limit));
    if (status) params.set('status', status);
    if (agentId) params.set('agentId', agentId);
    const query = params.toString();
    return apiFetch(`/api/subagent-runs${query ? `?${query}` : ''}`);
  },
  subagentRun: (runId) =>
    apiFetch(`/api/subagent-runs/${encodeURIComponent(runId)}`),
  controlSubagentRun: (runId, payload = {}) =>
    apiFetch(`/api/subagent-runs/${encodeURIComponent(runId)}/control`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  workflows: () => apiFetch('/api/workflows'),
  workflowNodeTypes: () => apiFetch('/api/workflows/node-types'),
  workflow: (workflowId) => apiFetch(`/api/workflows/${encodeURIComponent(workflowId)}`),
  saveWorkflow: (workflow) =>
    apiFetch(workflow?.id ? `/api/workflows/${encodeURIComponent(workflow.id)}` : '/api/workflows', {
      method: workflow?.id ? 'PUT' : 'POST',
      body: JSON.stringify({ workflow }),
    }),
  validateWorkflow: (workflow) =>
    apiFetch('/api/workflows/validate', {
      method: 'POST',
      body: JSON.stringify({ workflow }),
    }),
  validateWorkflowRun: (workflowId, payload = {}) =>
    apiFetch(`/api/workflows/${encodeURIComponent(workflowId)}/validate-run`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  cloneWorkflow: (workflowId, payload = {}) =>
    apiFetch(`/api/workflows/${encodeURIComponent(workflowId)}/clone`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
    exportWorkflow: (workflowId, format = 'json') =>
      apiFetch(`/api/workflows/${encodeURIComponent(workflowId)}/export?format=${encodeURIComponent(format)}`),
    exportWorkflowPackage: (workflowIds = []) =>
      apiFetch('/api/workflows/package/export', {
        method: 'POST',
        body: JSON.stringify({ workflowIds }),
      }),
    importWorkflowPackage: (workflowPackage) =>
      apiFetch('/api/workflows/package/import', {
        method: 'POST',
        body: JSON.stringify({ package: workflowPackage }),
      }),
    importWorkflow: (content) =>
      apiFetch('/api/workflows/import', {
        method: 'POST',
      body: JSON.stringify({ content }),
    }),
  startWorkflowRun: (workflowId, payload = {}) =>
    apiFetch(`/api/workflows/${encodeURIComponent(workflowId)}/runs`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  workflowRuns: ({ workflowId = '', status = '', limit = 25 } = {}) => {
    const params = new URLSearchParams();
    if (workflowId) params.set('workflowId', workflowId);
    if (status) params.set('status', status);
    if (limit) params.set('limit', String(limit));
    const query = params.toString();
    return apiFetch(`/api/workflow-runs${query ? `?${query}` : ''}`);
  },
  workflowRun: (runId) => apiFetch(`/api/workflow-runs/${encodeURIComponent(runId)}`),
  workflowRunEvents: (runId) => apiFetch(`/api/workflow-runs/${encodeURIComponent(runId)}/events`),
  recoverWorkflowRuns: (payload = {}) =>
    apiFetch('/api/workflow-runs/recover', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  replayWorkflowRun: (runId) => apiFetch(`/api/workflow-runs/${encodeURIComponent(runId)}/replay`),
  workflowNodeIo: (runId, nodeId) =>
    apiFetch(`/api/workflow-runs/${encodeURIComponent(runId)}/nodes/${encodeURIComponent(nodeId)}/io`),
  workflowNodeLogs: (runId, nodeId) =>
    apiFetch(`/api/workflow-runs/${encodeURIComponent(runId)}/nodes/${encodeURIComponent(nodeId)}/logs`),
  retryWorkflowFromNode: (runId, nodeId) =>
    apiFetch(`/api/workflow-runs/${encodeURIComponent(runId)}/nodes/${encodeURIComponent(nodeId)}/retry-from`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),
  controlWorkflowRun: (runId, payload = {}) =>
    apiFetch(`/api/workflow-runs/${encodeURIComponent(runId)}/control`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  controlWorkflowNode: (runId, nodeId, payload = {}) =>
    apiFetch(`/api/workflow-runs/${encodeURIComponent(runId)}/nodes/${encodeURIComponent(nodeId)}/control`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  workflowApprovals: () => apiFetch('/api/workflow-approvals'),
  decideWorkflowApproval: (approvalId, payload = {}) =>
    apiFetch(`/api/workflow-approvals/${encodeURIComponent(approvalId)}/decision`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  workflowNodePackages: () => apiFetch('/api/workflow-node-packages'),
  installWorkflowNodePackage: (workflowNodePackage = {}) =>
    apiFetch('/api/workflow-node-packages/install', {
      method: 'POST',
      body: JSON.stringify({ package: workflowNodePackage }),
    }),
  smokeWorkflowTemplate: (templateId, payload = {}) =>
    apiFetch(`/api/workflow-templates/${encodeURIComponent(templateId)}/smoke`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  workflowBenchmarkReadiness: () => apiFetch('/api/workflow-benchmarks'),
  runWorkflowBenchmarks: (payload = {}) =>
    apiFetch('/api/workflow-benchmarks/runs', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  hubUsage: ({ days = 7, from = '', to = '' } = {}) => {
    const params = new URLSearchParams();
    if (days) params.set('days', String(days));
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    const query = params.toString();
    return apiFetch(`/api/hub/usage${query ? `?${query}` : ''}`);
  },
  installAgentRepositoryItem: (payload = {}) =>
    apiFetch('/api/agent-repository/install', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  readFile: (projectName, filePath) =>
    apiFetch(`/api/projects/${projectName}/file?filePath=${encodeURIComponent(filePath)}`),
  readFileBlob: (projectName, filePath) =>
    apiFetch(`/api/projects/${projectName}/files/content?path=${encodeURIComponent(filePath)}`),
  localTools: () => apiFetch('/api/local-tools'),
  openLocalToolFile: ({ tool = 'vscode', filePath, projectName = '', line = null, column = null }) =>
    apiFetch('/api/local-tools/open-file', {
      method: 'POST',
      body: JSON.stringify({ tool, filePath, projectName, line, column }),
    }),
  openLocalPath: ({ filePath, projectName = '' }) =>
    apiFetch('/api/local-tools/open-path', {
      method: 'POST',
      body: JSON.stringify({ filePath, projectName }),
    }),
  openLocalTerminal: ({ tool = 'git-bash', filePath, projectName = '' }) =>
    apiFetch('/api/local-tools/open-terminal', {
      method: 'POST',
      body: JSON.stringify({ tool, filePath, projectName }),
    }),
  /**
   * @param {string} projectName
   * @param {string} filePath
   * @param {string} content
   * @param {string | null} [baseHash]
   */
  saveFile: (projectName, filePath, content, baseHash = null) =>
    apiFetch(`/api/projects/${projectName}/file`, {
      method: 'PUT',
      body: JSON.stringify({ filePath, content, baseHash }),
    }),
  getFiles: (projectName, options = {}) =>
    apiFetch(`/api/projects/${projectName}/files`, options),
  searchFiles: (projectName, query = '', limit = 60, options = {}) => {
    const params = new URLSearchParams();
    if (query) params.set('q', query);
    params.set('limit', String(limit));
    return apiFetch(`/api/projects/${encodeURIComponent(projectName)}/files/search?${params.toString()}`, options);
  },

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
