import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import express from 'express';
import { afterEach, expect, test } from 'vitest';

import settingsRouter from '../../routes/settings.js';

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

const listen = (app) => new Promise((resolve, reject) => {
  const server = http.createServer(app);
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => resolve(server));
});

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
