import express from 'express';

import { defaultWorkflowStudioStore, getWorkflowNodeTypeDefinitions } from '../services/workflow-studio-service.js';

const router = express.Router();

function sendWorkflowError(res, error, fallbackStatus = 500, fallbackMessage = 'Workflow request failed') {
  console.error(fallbackMessage, error);
  res.status(error?.statusCode || fallbackStatus).json({
    success: false,
    error: error?.message || fallbackMessage,
    validation: error?.validation || null,
  });
}

router.get('/', async (_req, res) => {
  try {
    await defaultWorkflowStudioStore.ready();
    res.json({ success: true, workflows: defaultWorkflowStudioStore.listWorkflows() });
  } catch (error) {
    sendWorkflowError(res, error, 500, 'Failed to list workflows');
  }
});

router.post('/validate', async (req, res) => {
  try {
    await defaultWorkflowStudioStore.ready();
    const result = defaultWorkflowStudioStore.validateWorkflowDefinition(req.body?.workflow || req.body || {});
    res.status(result.validation.valid ? 200 : 400).json({ success: result.validation.valid, ...result });
  } catch (error) {
    sendWorkflowError(res, error, 400, 'Failed to validate workflow');
  }
});

router.get('/node-types', (_req, res) => {
  res.json({ success: true, nodeTypes: getWorkflowNodeTypeDefinitions() });
});

router.get('/tool-registry', async (_req, res) => {
  try {
    await defaultWorkflowStudioStore.ready();
    res.json({ success: true, tools: defaultWorkflowStudioStore.getToolRegistry() });
  } catch (error) {
    sendWorkflowError(res, error, 500, 'Failed to load workflow tool registry');
  }
});

router.get('/mcp-tool-catalog', async (req, res) => {
  try {
    await defaultWorkflowStudioStore.ready();
    res.json({ success: true, tools: defaultWorkflowStudioStore.getMcpToolCatalog(req.query.workflowId || '') });
  } catch (error) {
    sendWorkflowError(res, error, 500, 'Failed to load workflow MCP tool catalog');
  }
});

router.get('/mcp-argument-schema', async (req, res) => {
  try {
    await defaultWorkflowStudioStore.ready();
    res.json({ success: true, schema: defaultWorkflowStudioStore.buildMcpArgumentSchema(req.query.toolName || '') });
  } catch (error) {
    sendWorkflowError(res, error, 500, 'Failed to load workflow MCP argument schema');
  }
});

router.get('/audit/search', async (req, res) => {
  try {
    await defaultWorkflowStudioStore.ready();
    const records = defaultWorkflowStudioStore.searchWorkflowAudit(req.query || {});
    res.json({ success: true, records });
  } catch (error) {
    sendWorkflowError(res, error, 500, 'Failed to search workflow audit log');
  }
});

router.get('/policy-report', async (req, res) => {
  try {
    await defaultWorkflowStudioStore.ready();
    const report = defaultWorkflowStudioStore.getWorkflowPolicyReport(req.query.workflowId || '');
    res.json({ success: true, report });
  } catch (error) {
    sendWorkflowError(res, error, 500, 'Failed to build workflow policy report');
  }
});

router.get('/analytics/usage', async (req, res) => {
  try {
    await defaultWorkflowStudioStore.ready();
    const analytics = defaultWorkflowStudioStore.getWorkflowUsageAnalytics(req.query.workflowId || '');
    res.json({ success: true, analytics });
  } catch (error) {
    sendWorkflowError(res, error, 500, 'Failed to load workflow usage analytics');
  }
});

router.post('/import', async (req, res) => {
  try {
    const workflow = await defaultWorkflowStudioStore.importWorkflow(req.body?.content || req.body?.workflow || req.body || {});
    res.status(201).json({ success: true, workflow });
  } catch (error) {
    sendWorkflowError(res, error, 400, 'Failed to import workflow');
  }
});

router.post('/package/export', async (req, res) => {
  try {
    const workflowIds = Array.isArray(req.body?.workflowIds) ? req.body.workflowIds : [];
    const pkg = await defaultWorkflowStudioStore.exportWorkflowPackage(workflowIds);
    res.json({ success: true, package: pkg });
  } catch (error) {
    sendWorkflowError(res, error, 500, 'Failed to export workflow package');
  }
});

router.post('/package/export/preview', async (req, res) => {
  try {
    const workflowIds = Array.isArray(req.body?.workflowIds) ? req.body.workflowIds : [];
    const preview = await defaultWorkflowStudioStore.exportWorkflowPackagePreview(workflowIds);
    res.json({ success: true, preview });
  } catch (error) {
    sendWorkflowError(res, error, 500, 'Failed to preview workflow package export');
  }
});

router.post('/package/import', async (req, res) => {
  try {
    const result = await defaultWorkflowStudioStore.importWorkflowPackage(req.body?.package || req.body || {});
    res.status(201).json({ success: true, ...result });
  } catch (error) {
    sendWorkflowError(res, error, 400, 'Failed to import workflow package');
  }
});

router.post('/package/import/preview', async (req, res) => {
  try {
    await defaultWorkflowStudioStore.ready();
    const preview = defaultWorkflowStudioStore.importWorkflowPackagePreview(req.body?.package || req.body || {});
    res.json({ success: true, preview });
  } catch (error) {
    sendWorkflowError(res, error, 400, 'Failed to preview workflow package import');
  }
});

router.get('/:id/security', async (req, res) => {
  try {
    await defaultWorkflowStudioStore.ready();
    const security = defaultWorkflowStudioStore.getWorkflowSecurityState(req.params.id);
    if (!security) return res.status(404).json({ success: false, error: 'Workflow not found' });
    return res.json({ success: true, security });
  } catch (error) {
    return sendWorkflowError(res, error, 500, 'Failed to load workflow security state');
  }
});

router.get('/:id/history', async (req, res) => {
  try {
    await defaultWorkflowStudioStore.ready();
    const history = defaultWorkflowStudioStore.getWorkflowHistory(req.params.id);
    if (!history) return res.status(404).json({ success: false, error: 'Workflow not found' });
    return res.json({ success: true, history });
  } catch (error) {
    return sendWorkflowError(res, error, 500, 'Failed to load workflow history');
  }
});

router.get('/:id/governance', async (req, res) => {
  try {
    await defaultWorkflowStudioStore.ready();
    const governance = defaultWorkflowStudioStore.getWorkflowGovernance(req.params.id);
    if (!governance) return res.status(404).json({ success: false, error: 'Workflow not found' });
    return res.json({ success: true, governance });
  } catch (error) {
    return sendWorkflowError(res, error, 500, 'Failed to load workflow governance');
  }
});

router.put('/:id/governance', async (req, res) => {
  try {
    const governance = await defaultWorkflowStudioStore.updateWorkflowGovernance(req.params.id, req.body || {});
    if (!governance) return res.status(404).json({ success: false, error: 'Workflow not found' });
    return res.json({ success: true, governance });
  } catch (error) {
    return sendWorkflowError(res, error, 400, 'Failed to update workflow governance');
  }
});

router.post('/:id/publish', async (req, res) => {
  try {
    const governance = await defaultWorkflowStudioStore.publishWorkflow(req.params.id, req.body || {});
    if (!governance) return res.status(404).json({ success: false, error: 'Workflow not found' });
    return res.json({ success: true, governance });
  } catch (error) {
    return sendWorkflowError(res, error, error?.statusCode || 400, 'Failed to publish workflow');
  }
});

router.post('/:id/review-requests', async (req, res) => {
  try {
    const review = await defaultWorkflowStudioStore.requestWorkflowReview(req.params.id, req.body || {});
    if (!review) return res.status(404).json({ success: false, error: 'Workflow not found' });
    return res.status(201).json({ success: true, review });
  } catch (error) {
    return sendWorkflowError(res, error, 400, 'Failed to request workflow review');
  }
});

router.post('/:id/deprecate', async (req, res) => {
  try {
    const governance = await defaultWorkflowStudioStore.deprecateWorkflow(req.params.id, req.body || {});
    if (!governance) return res.status(404).json({ success: false, error: 'Workflow not found' });
    return res.json({ success: true, governance });
  } catch (error) {
    return sendWorkflowError(res, error, 400, 'Failed to deprecate workflow');
  }
});

router.get('/:id/agent-bridge', async (req, res) => {
  try {
    await defaultWorkflowStudioStore.ready();
    const bridge = defaultWorkflowStudioStore.getAgentBridgeState(req.params.id, { inputs: req.query || {} });
    if (!bridge) return res.status(404).json({ success: false, error: 'Workflow not found' });
    return res.json({ success: true, bridge });
  } catch (error) {
    return sendWorkflowError(res, error, 500, 'Failed to load workflow agent bridge state');
  }
});

router.put('/:id/security', async (req, res) => {
  try {
    const security = await defaultWorkflowStudioStore.updateWorkflowSecurityState(req.params.id, req.body || {});
    if (!security) return res.status(404).json({ success: false, error: 'Workflow not found' });
    return res.json({ success: true, security });
  } catch (error) {
    return sendWorkflowError(res, error, 400, 'Failed to update workflow security state');
  }
});

router.get('/:id/permission-dry-run', async (req, res) => {
  try {
    await defaultWorkflowStudioStore.ready();
    const dryRun = defaultWorkflowStudioStore.permissionDryRun(req.params.id);
    if (!dryRun) return res.status(404).json({ success: false, error: 'Workflow not found' });
    return res.json({ success: true, dryRun });
  } catch (error) {
    return sendWorkflowError(res, error, 500, 'Failed to run workflow permission dry run');
  }
});

router.post('/:id/permission-overrides', async (req, res) => {
  try {
    const request = await defaultWorkflowStudioStore.createPermissionOverrideRequest(req.params.id, req.body || {});
    if (!request) return res.status(404).json({ success: false, error: 'Workflow not found' });
    return res.status(201).json({ success: true, request });
  } catch (error) {
    return sendWorkflowError(res, error, 400, 'Failed to create permission override request');
  }
});

router.get('/:id/approval-audit/export', async (req, res) => {
  try {
    await defaultWorkflowStudioStore.ready();
    const audit = defaultWorkflowStudioStore.exportApprovalAudit({ workflowId: req.params.id, runId: req.query.runId || '' });
    return res.json({ success: true, audit });
  } catch (error) {
    return sendWorkflowError(res, error, 500, 'Failed to export workflow approval audit');
  }
});

router.get('/:id/template-upgrade', async (req, res) => {
  try {
    await defaultWorkflowStudioStore.ready();
    const status = defaultWorkflowStudioStore.getTemplateUpgradeStatus(req.params.id);
    if (!status) return res.status(404).json({ success: false, error: 'Workflow not found' });
    return res.json({ success: true, status });
  } catch (error) {
    return sendWorkflowError(res, error, 500, 'Failed to load workflow template upgrade status');
  }
});

router.post('/:id/template-upgrade', async (req, res) => {
  try {
    const result = await defaultWorkflowStudioStore.upgradeTemplateWorkflow(req.params.id);
    if (!result) return res.status(404).json({ success: false, error: 'Workflow not found' });
    return res.json({ success: true, ...result });
  } catch (error) {
    return sendWorkflowError(res, error, 400, 'Failed to upgrade workflow template');
  }
});

router.get('/:id', async (req, res) => {
  try {
    await defaultWorkflowStudioStore.ready();
    const workflow = defaultWorkflowStudioStore.getWorkflow(req.params.id);
    if (!workflow) return res.status(404).json({ success: false, error: 'Workflow not found' });
    return res.json({ success: true, workflow });
  } catch (error) {
    return sendWorkflowError(res, error, 500, 'Failed to load workflow');
  }
});

router.post('/', async (req, res) => {
  try {
    const workflow = await defaultWorkflowStudioStore.upsertWorkflow(req.body?.workflow || req.body || {});
    res.status(201).json({ success: true, workflow });
  } catch (error) {
    sendWorkflowError(res, error, 400, 'Failed to create workflow');
  }
});

router.put('/:id', async (req, res) => {
  try {
    const workflow = await defaultWorkflowStudioStore.upsertWorkflow({
      ...(req.body?.workflow || req.body || {}),
      id: req.params.id,
    });
    res.json({ success: true, workflow });
  } catch (error) {
    sendWorkflowError(res, error, 400, 'Failed to update workflow');
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const workflow = await defaultWorkflowStudioStore.deleteWorkflow(req.params.id);
    if (!workflow) return res.status(404).json({ success: false, error: 'Workflow not found' });
    return res.json({ success: true, workflow });
  } catch (error) {
    return sendWorkflowError(res, error, 500, 'Failed to delete workflow');
  }
});

router.get('/:id/export', async (req, res) => {
  try {
    const content = await defaultWorkflowStudioStore.exportWorkflow(req.params.id, req.query.format || 'json');
    if (!content) return res.status(404).json({ success: false, error: 'Workflow not found' });
    return res.json({ success: true, format: req.query.format || 'json', content });
  } catch (error) {
    return sendWorkflowError(res, error, 500, 'Failed to export workflow');
  }
});

router.post('/:id/validate-run', async (req, res) => {
  try {
    const result = await defaultWorkflowStudioStore.validateRun(req.params.id, req.body || {});
    res.status(result.valid ? 200 : 400).json({ success: result.valid, validation: result });
  } catch (error) {
    sendWorkflowError(res, error, error?.statusCode || 400, 'Failed to validate workflow run');
  }
});

router.post('/:id/clone', async (req, res) => {
  try {
    const workflow = await defaultWorkflowStudioStore.cloneWorkflow(req.params.id, req.body || {});
    res.status(201).json({ success: true, workflow });
  } catch (error) {
    sendWorkflowError(res, error, error?.statusCode || 400, 'Failed to clone workflow');
  }
});

router.post('/:id/runs', async (req, res) => {
  try {
    const run = await defaultWorkflowStudioStore.createRun(req.params.id, req.body || {});
    res.status(201).json({ success: true, run });
  } catch (error) {
    sendWorkflowError(res, error, error?.statusCode || 400, 'Failed to run workflow');
  }
});

export default router;
