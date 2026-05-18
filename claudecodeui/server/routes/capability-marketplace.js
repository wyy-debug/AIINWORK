import express from 'express';

import { providerMcpService } from '../modules/providers/services/mcp.service.js';
import { listInstalledSkills } from '../services/agent-skill-service.js';
import { createCapabilityMarketplaceStore } from '../services/capability-marketplace-service.js';

const router = express.Router();
const marketplaceStore = createCapabilityMarketplaceStore();

function flattenMcpServers(groupedServers) {
  const items = [];
  for (const [scope, servers] of Object.entries(groupedServers || {})) {
    if (!Array.isArray(servers)) continue;
    for (const server of servers) {
      items.push({
        ...server,
        scope,
        provider: server.provider || 'claude',
      });
    }
  }
  return items;
}

function sendMarketplaceError(res, error) {
  res.status(400).json({
    success: false,
    error: error?.message || 'Capability marketplace request failed',
  });
}

router.get('/', async (req, res) => {
  try {
    const workspacePath = typeof req.query.workspacePath === 'string' ? req.query.workspacePath : '';
    const [skillsResult, groupedMcpServers] = await Promise.all([
      listInstalledSkills({ workspacePath }).catch(() => ({ skills: [] })),
      providerMcpService.listProviderMcpServers('claude', { workspacePath }).catch(() => ({})),
    ]);
    const catalog = await marketplaceStore.listMarketplace({
      repositoryItems: [],
      installedSkills: Array.isArray(skillsResult?.skills) ? skillsResult.skills : [],
      installedMcpServers: flattenMcpServers(groupedMcpServers),
    });
    res.json({ success: true, catalog });
  } catch (error) {
    sendMarketplaceError(res, error);
  }
});

router.post('/:id/enabled', async (req, res) => {
  try {
    const result = await marketplaceStore.setEnabled(req.params.id, req.body?.enabled === true);
    res.json({ success: true, ...result });
  } catch (error) {
    sendMarketplaceError(res, error);
  }
});

export default router;
