import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import express from 'express';

import providerRoutes from '@/modules/providers/provider.routes.js';
import { providerMcpService } from '@/modules/providers/services/mcp.service.js';

const patchHomeDir = (nextHomeDir: string) => {
  const original = os.homedir;
  (os as any).homedir = () => nextHomeDir;
  return () => {
    (os as any).homedir = original;
  };
};

const listen = async (handler: express.Express) => new Promise<{
  server: http.Server;
  baseUrl: string;
}>((resolve, reject) => {
  const server = handler.listen(0, '127.0.0.1', () => {
    const address = server.address();
    if (!address || typeof address === 'string') {
      reject(new Error('Failed to bind test server.'));
      return;
    }
    resolve({ server, baseUrl: `http://127.0.0.1:${address.port}` });
  });
  server.on('error', reject);
});

test('MCP diagnose reports package, dependency, setup field, and runtime tool state', { concurrency: false }, async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-diagnose-state-'));
  const restoreHomeDir = patchHomeDir(tempRoot);

  try {
    const installDir = path.join(tempRoot, '.mtl-code', 'mcp-servers', 'ainwork-code-search');
    await fs.mkdir(path.join(installDir, 'node_modules'), { recursive: true });
    await fs.writeFile(path.join(installDir, 'package.json'), JSON.stringify({
      dependencies: {
        '@modelcontextprotocol/sdk': '^1.0.0',
      },
    }), 'utf8');
    await fs.writeFile(path.join(installDir, 'hub.mcp.json'), JSON.stringify({
      mcp: {
        setupFields: [
          {
            key: 'AINWORK_DEFAULT_CODE_ROOT',
            label: 'root',
            type: 'path',
            target: 'env',
            required: true,
          },
          {
            key: 'AINWORK_CODE_ROOTS',
            label: 'Allowed roots',
            type: 'path-list',
            target: 'env',
            required: false,
          },
        ],
        tools: [
          { name: 'list_code_roots' },
          { name: 'search_code' },
        ],
      },
    }), 'utf8');

    await providerMcpService.upsertProviderMcpServer('claude', {
      name: 'ainwork-code-search',
      scope: 'user',
      transport: 'stdio',
      command: 'definitely-missing-mcp-command',
      env: { AINWORK_DEFAULT_CODE_ROOT: 'D:\\SOC\\perfdev\\Soc' },
    });

    const app = express();
    app.use('/api/providers', providerRoutes);
    const { server, baseUrl } = await listen(app);
    try {
      const response = await fetch(`${baseUrl}/api/providers/claude/mcp/servers/ainwork-code-search/diagnose?scope=user`);
      assert.equal(response.status, 200);
      const body = await response.json() as {
        data: {
          configWritten: boolean;
          packageInstalled: boolean;
          dependenciesInstalled: boolean;
          runtimeToolsStatus: { status: string; tools: string[] };
          setupFields: Array<{ key: string; configured: boolean; required: boolean }>;
          requiredFields: Array<{ key: string; configured: boolean; required: boolean }>;
        };
      };

      assert.equal(body.data.configWritten, true);
      assert.equal(body.data.packageInstalled, true);
      assert.equal(body.data.dependenciesInstalled, true);
      assert.deepEqual(body.data.runtimeToolsStatus.tools, ['list_code_roots', 'search_code']);
      assert.deepEqual(
        body.data.setupFields.map((field) => [field.key, field.required, field.configured]),
        [
          ['AINWORK_DEFAULT_CODE_ROOT', true, true],
          ['AINWORK_CODE_ROOTS', false, false],
        ],
      );
      assert.deepEqual(
        body.data.requiredFields.map((field) => [field.key, field.required, field.configured]),
        [
          ['AINWORK_DEFAULT_CODE_ROOT', true, true],
        ],
      );
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  } finally {
    restoreHomeDir();
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});
