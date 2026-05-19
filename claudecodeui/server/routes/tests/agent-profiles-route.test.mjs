import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { expect, test } from 'vitest';

test('Agent Profiles have a product-level CRUD API mounted in server index', async () => {
  const routeSource = await readFile(resolve(process.cwd(), 'server/routes/agent-profiles.js'), 'utf8').catch(() => '');
  const indexSource = await readFile(resolve(process.cwd(), 'server/index.js'), 'utf8');

  expect(routeSource).toContain("router.get('/',");
  expect(routeSource).toContain("router.post('/',");
  expect(routeSource).toContain("router.patch('/:profileId',");
  expect(routeSource).toContain("router.delete('/:profileId',");
  expect(routeSource).toContain("isBuiltInAgentProfileId(req.body?.id)");
  expect(indexSource).toContain("app.use('/api/agent-profiles', authenticateToken, agentProfilesRoutes)");
});
