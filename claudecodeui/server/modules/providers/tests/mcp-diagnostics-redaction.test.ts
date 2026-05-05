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

test('MCP diagnose response redacts configured env secret values everywhere', { concurrency: false }, async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-diagnose-redaction-'));
  const restoreHomeDir = patchHomeDir(tempRoot);
  const secret = 'redmine-secret-token-12345';

  try {
    const installDir = path.join(tempRoot, '.mtl-code', 'mcp-servers', 'soc-redmine');
    await fs.mkdir(installDir, { recursive: true });
    await fs.writeFile(path.join(installDir, 'hub.mcp.json'), JSON.stringify({
      mcp: {
        setupFields: [
          {
            key: 'REDMINE_API_KEY',
            label: 'Redmine API Key',
            type: 'password',
            target: 'env',
            required: true,
          },
        ],
      },
    }), 'utf8');

    await providerMcpService.upsertProviderMcpServer('claude', {
      name: 'soc-redmine',
      scope: 'user',
      transport: 'stdio',
      command: 'definitely-missing-mcp-command',
      env: { REDMINE_API_KEY: secret },
    });

    const app = express();
    app.use('/api/providers', providerRoutes);
    const { server, baseUrl } = await listen(app);
    try {
      const response = await fetch(`${baseUrl}/api/providers/claude/mcp/servers/soc-redmine/diagnose?scope=user`);
      assert.equal(response.status, 200);
      const body = await response.json() as {
        data: {
          server: {
            env?: Record<string, string>;
            headers?: Record<string, string>;
          };
          requiredFields: Array<{ key: string; configured: boolean; value?: string }>;
        };
      };

      const serialized = JSON.stringify(body);
      assert.equal(serialized.includes(secret), false);
      assert.equal(body.data.server.env?.REDMINE_API_KEY, '[configured]');
      assert.deepEqual(
        body.data.requiredFields.map((field) => [field.key, field.configured, Object.hasOwn(field, 'value')]),
        [
          ['REDMINE_API_KEY', true, false],
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

test('MCP diagnose response redacts configured header secret values everywhere', { concurrency: false }, async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-diagnose-header-redaction-'));
  const restoreHomeDir = patchHomeDir(tempRoot);
  const bearer = 'bearer-secret-token-67890';

  try {
    const installDir = path.join(tempRoot, '.mtl-code', 'mcp-servers', 'header-mcp');
    await fs.mkdir(installDir, { recursive: true });
    await fs.writeFile(path.join(installDir, 'hub.mcp.json'), JSON.stringify({
      mcp: {
        setupFields: [
          {
            key: 'Authorization',
            label: 'Authorization',
            type: 'password',
            target: 'header',
            required: true,
          },
        ],
      },
    }), 'utf8');

    await providerMcpService.upsertProviderMcpServer('claude', {
      name: 'header-mcp',
      scope: 'user',
      transport: 'http',
      url: 'https://redmine.example.invalid/mcp',
      headers: { Authorization: `Bearer ${bearer}` },
    });

    const app = express();
    app.use('/api/providers', providerRoutes);
    const { server, baseUrl } = await listen(app);
    try {
      const response = await fetch(`${baseUrl}/api/providers/claude/mcp/servers/header-mcp/diagnose?scope=user`);
      assert.equal(response.status, 200);
      const body = await response.json() as {
        data: {
          server: {
            headers?: Record<string, string>;
          };
          requiredFields: Array<{ key: string; configured: boolean; value?: string }>;
        };
      };

      const serialized = JSON.stringify(body);
      assert.equal(serialized.includes(bearer), false);
      assert.equal(body.data.server.headers?.Authorization, '[configured]');
      assert.deepEqual(
        body.data.requiredFields.map((field) => [field.key, field.configured, Object.hasOwn(field, 'value')]),
        [
          ['Authorization', true, false],
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
