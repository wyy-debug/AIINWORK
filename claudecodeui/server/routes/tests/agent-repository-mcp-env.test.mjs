import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll as after, beforeAll as before, test } from 'vitest';

import express from 'express';

const FETCH_BLOCKED_PORTS = new Set([
  1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69,
  77, 79, 87, 95, 101, 102, 103, 104, 109, 110, 111, 113, 115, 117, 119,
  123, 135, 137, 139, 143, 161, 179, 389, 427, 465, 512, 513, 514, 515,
  526, 530, 531, 532, 540, 548, 554, 556, 563, 587, 601, 636, 989, 990,
  993, 995, 1719, 1720, 1723, 2049, 3659, 4045, 5060, 5061, 6000, 6566,
  6665, 6666, 6667, 6668, 6669, 6697, 10080,
]);

const patchHomeDir = (nextHomeDir) => {
  const original = os.homedir;
  os.homedir = () => nextHomeDir;
  return () => {
    os.homedir = original;
  };
};

const close = (targetServer) => new Promise((resolve) => targetServer.close(() => resolve()));

const listen = async (handler) => {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const server = await new Promise((resolve, reject) => {
      const candidate = handler.listen(0, '127.0.0.1', () => {
        const address = candidate.address();
        if (!address || typeof address === 'string') {
          reject(new Error('Failed to bind test server.'));
          return;
        }
        resolve(candidate);
      });
      candidate.on('error', reject);
    });
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    if (!FETCH_BLOCKED_PORTS.has(port)) {
      return { server, baseUrl: `http://127.0.0.1:${port}` };
    }
    await close(server);
  }
  throw new Error('Failed to bind a fetch-safe test port.');
};

const postJson = async (pathName, body) => {
  const response = await fetch(`${baseUrl}${pathName}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
};

const remoteCatalog = {
  schemaVersion: 1,
  name: 'Test MCP Hub',
  items: [],
};

const publishMcpPackage = ({ name, setupKey }) => {
  remoteCatalog.items = remoteCatalog.items.filter((item) => item.name !== name);
  remoteCatalog.items.push({
    kind: 'mcp-server',
    name,
    title: name,
    mcp: {
      serverName: name,
      transport: 'stdio',
      command: 'node',
      args: ['${installDir}/server.js'],
      setupFields: [
        {
          key: setupKey,
          label: setupKey,
          type: 'password',
          target: 'env',
          required: true,
        },
      ],
    },
  });
  return {
    repoId: 'test-hub',
    id: `mcp-server-${name}`,
    name,
  };
};

const installMcpPackage = async (item) => postJson('/api/agent-repository/install', {
  repoId: item.repoId,
  itemId: item.id,
  target: 'user',
  overwrite: true,
  configuration: { mcpValues: {} },
});

let tempRoot;
let restoreHomeDir;
let server;
let baseUrl;
let originalRepositoryDir;

before(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-repository-mcp-env-'));
  restoreHomeDir = patchHomeDir(tempRoot);
  originalRepositoryDir = process.env.MTL_CODE_AGENT_REPOSITORY_DIR;
  process.env.MTL_CODE_AGENT_REPOSITORY_DIR = path.join(tempRoot, 'agent-repository');

  const { default: repositoryRoutes } = await import('../agent-repository.js');
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.get('/remote/catalog.json', (_req, res) => {
    res.json(remoteCatalog);
  });
  app.use('/api/agent-repository', repositoryRoutes);
  ({ server, baseUrl } = await listen(app));

  const { response, payload } = await postJson('/api/agent-repository/sources', {
    name: 'test-hub',
    url: `${baseUrl}/remote/catalog.json`,
  });
  assert.equal(response.status, 200, JSON.stringify(payload));
});

after(async () => {
  if (server) {
    await new Promise((resolve) => server.close(() => resolve()));
  }
  if (originalRepositoryDir === undefined) {
    delete process.env.MTL_CODE_AGENT_REPOSITORY_DIR;
  } else {
    process.env.MTL_CODE_AGENT_REPOSITORY_DIR = originalRepositoryDir;
  }
  restoreHomeDir?.();
  await fs.rm(tempRoot, { recursive: true, force: true });
});

test('MCP update reuses existing configured env values when setup form is empty', { concurrency: false }, async () => {
  const item = publishMcpPackage({
    name: 'existing-env-mcp',
    setupKey: 'EXISTING_MCP_TOKEN',
  });
  await fs.writeFile(path.join(tempRoot, '.mtl-code.json'), JSON.stringify({
    mcpServers: {
      'existing-env-mcp': {
        type: 'stdio',
        command: 'node',
        args: ['old.js'],
        env: {
          EXISTING_MCP_TOKEN: 'from-existing-config',
        },
      },
    },
  }, null, 2), 'utf8');

  const { response, payload } = await installMcpPackage(item);

  assert.equal(response.status, 200, JSON.stringify(payload));
  const config = JSON.parse(await fs.readFile(path.join(tempRoot, '.mtl-code.json'), 'utf8'));
  assert.equal(
    config.mcpServers['existing-env-mcp'].env.EXISTING_MCP_TOKEN,
    'from-existing-config',
  );
});

test('MCP install does not persist arbitrary process.env setup values', { concurrency: false }, async () => {
  const item = publishMcpPackage({
    name: 'process-env-mcp',
    setupKey: 'PROCESS_MCP_TOKEN',
  });
  process.env.PROCESS_MCP_TOKEN = 'from-process-env';

  try {
    const { response, payload } = await installMcpPackage(item);

    assert.equal(response.status, 400, JSON.stringify(payload));
    assert.match(payload.details, /MCP configuration "PROCESS_MCP_TOKEN" is required/);
    const config = JSON.parse(await fs.readFile(path.join(tempRoot, '.mtl-code.json'), 'utf8'));
    assert.equal(config.mcpServers?.['process-env-mcp'], undefined);
  } finally {
    delete process.env.PROCESS_MCP_TOKEN;
  }
});
