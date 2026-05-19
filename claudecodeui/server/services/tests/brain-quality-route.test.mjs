import http from 'node:http';

import express from 'express';
import { describe, expect, it } from 'vitest';

import brainRouter from '../../routes/brain.js';

const listen = async (app) => new Promise((resolve, reject) => {
  const server = http.createServer(app);
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => resolve(server));
});

const close = (server) => new Promise((resolve, reject) => {
  server.close((error) => {
    if (error) reject(error);
    else resolve();
  });
});

describe('Brain quality baseline route', () => {
  it('exposes JSON and Markdown quality reports', async () => {
    const app = express();
    app.use(brainRouter);
    const server = await listen(app);
    try {
      const address = server.address();
      const baseUrl = `http://127.0.0.1:${address.port}`;

      const jsonResponse = await fetch(`${baseUrl}/quality-baseline`);
      const json = await jsonResponse.json();
      expect(jsonResponse.status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.report.summary.total).toBeGreaterThanOrEqual(3);
      expect(json.report.gates.redaction.passed).toBe(true);

      const markdownResponse = await fetch(`${baseUrl}/quality-baseline/report`);
      const markdown = await markdownResponse.text();
      expect(markdownResponse.status).toBe(200);
      expect(markdownResponse.headers.get('content-type')).toContain('text/markdown');
      expect(markdown).toContain('# Argus Brain Quality Baseline');
    } finally {
      await close(server);
    }
  });
});
