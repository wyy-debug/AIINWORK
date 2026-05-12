import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import express from 'express';
import { afterEach, expect, test } from 'vitest';

import settingsRouter from '../../routes/settings.js';

const originalEnv = { ...process.env };
const FETCH_BLOCKED_PORTS = new Set([
  1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69,
  77, 79, 87, 95, 101, 102, 103, 104, 109, 110, 111, 113, 115, 117, 119,
  123, 135, 137, 139, 143, 161, 179, 389, 427, 465, 512, 513, 514, 515,
  526, 530, 531, 532, 540, 548, 554, 556, 563, 587, 601, 636, 989, 990,
  993, 995, 1719, 1720, 1723, 2049, 3659, 4045, 5060, 5061, 6000, 6566,
  6665, 6666, 6667, 6668, 6669, 6697, 10080,
]);

afterEach(() => {
  process.env = { ...originalEnv };
});

const listen = async (app) => {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const server = await new Promise((resolve, reject) => {
      const candidate = http.createServer(app);
      candidate.once('error', reject);
      candidate.listen(0, '127.0.0.1', () => resolve(candidate));
    });
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    if (!FETCH_BLOCKED_PORTS.has(port)) {
      return server;
    }
    await close(server);
  }
  throw new Error('Failed to bind a fetch-safe test port.');
};

const close = (server) => new Promise((resolve, reject) => {
  server.close((error) => {
    if (error) {
      reject(error);
      return;
    }
    resolve();
  });
});

test('settings route synthesizes OpenAI-compatible profile from legacy OpenAI env flag', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'settings-route-'));
  const configRoot = path.join(tempRoot, '.mtl-code');
  await fs.mkdir(configRoot, { recursive: true });
  await fs.writeFile(path.join(configRoot, 'settings.json'), JSON.stringify({
    env: {
      MTL_CODE_USE_OPENAI: '1',
      OPENAI_BASE_URL: 'http://token.wd.com/v1',
      OPENAI_MODEL: 'gpt-5.4-mini',
      OPENAI_API_KEY: 'test-token',
    },
  }, null, 2), 'utf8');

  process.env.MTL_CODE_CONFIG_DIR = configRoot;

  const app = express();
  app.use(settingsRouter);
  const server = await listen(app);
  try {
    const address = server.address();
    const response = await fetch(`http://127.0.0.1:${address.port}/mtl-code-model`);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.config.profiles[0]).toMatchObject({
      protocol: 'openai-compatible',
      baseUrl: 'http://token.wd.com/v1',
      model: 'gpt-5.4-mini',
      apiKeyConfigured: true,
    });
    expect(body.config.anthropic).toMatchObject({
      baseUrl: 'http://token.wd.com/v1',
      model: 'gpt-5.4-mini',
      apiKeyConfigured: true,
    });
  } finally {
    await close(server);
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});
