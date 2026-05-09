import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildReportArgusId,
  normalizeReportPayload,
  readConfig,
  testConnection,
  writeCrashReport,
} from '../src/core.js';

test('buildReportArgusId creates stable ids for daily, range, and single reports', () => {
  assert.equal(buildReportArgusId({ reportType: 'daily', date: '20260509' }), 'crash-ai-daily-20260509');
  assert.equal(buildReportArgusId({ reportType: 'range', startDate: '20260501', endDate: '20260509' }), 'crash-ai-range-20260501-20260509');
  assert.equal(buildReportArgusId({ reportType: 'single', issueId: 'ISSUE/1', date: '20260509' }), 'crash-ai-single-ISSUE-1-20260509');
});

test('normalizeReportPayload defaults to CrashAI project-knowledge document', () => {
  const payload = normalizeReportPayload({
    title: 'CrashAI 日巡检报告 - 20260509',
    content: '# Report',
    reportType: 'daily',
    date: '20260509',
  }, readConfig({}));

  assert.equal(payload.title, 'CrashAI 日巡检报告 - 20260509');
  assert.equal(payload.content, '# Report');
  assert.equal(payload.mode, 'project-knowledge');
  assert.equal(payload.projectName, 'CrashAI');
  assert.equal(payload.kind, 'review-notes');
  assert.equal(payload.writeMode, 'direct');
  assert.equal(payload.forceDirectWrite, true);
  assert.equal(payload.argusId, 'crash-ai-daily-20260509');
  assert.equal(payload.sourceId, 'crash-ai-daily-20260509');
  assert.deepEqual(payload.tags, ['crash-ai', 'crashsight', 'report', 'daily']);
});

test('readConfig uses a long default timeout for large Obsidian report writes', () => {
  assert.equal(readConfig({}).timeoutMs, 300_000);
  assert.equal(readConfig({ ARGUS_OBSIDIAN_TIMEOUT_MS: '300000' }).timeoutMs, 300_000);
});

test('writeCrashReport posts normalized document to Argus Obsidian bridge', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options, body: JSON.parse(options.body) });
    return Response.json({
      success: true,
      obsidianPath: 'Argus/Projects/CrashAI/CrashAI 日巡检报告 - 20260509.md',
    });
  };

  const result = await writeCrashReport({
    title: 'CrashAI 日巡检报告 - 20260509',
    content: '# Report',
    reportType: 'daily',
    date: '20260509',
  }, readConfig({ ARGUS_BASE_URL: 'http://127.0.0.1:3001', ARGUS_API_TOKEN: 'token-1' }), { fetchImpl });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'http://127.0.0.1:3001/api/obsidian-bridge/documents');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer token-1');
  assert.equal(calls[0].body.argusId, 'crash-ai-daily-20260509');
  assert.equal(calls[0].body.writeMode, 'direct');
  assert.equal(calls[0].body.forceDirectWrite, true);
  assert.equal(result.success, true);
  assert.equal(result.obsidianPath, 'Argus/Projects/CrashAI/CrashAI 日巡检报告 - 20260509.md');
});

test('testConnection calls Argus Obsidian bridge test endpoint', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return Response.json({ success: true, vaultName: 'self' });
  };

  const result = await testConnection(readConfig({ ARGUS_BASE_URL: 'http://127.0.0.1:3001' }), { fetchImpl });

  assert.equal(calls[0].url, 'http://127.0.0.1:3001/api/obsidian-bridge/test-connection');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(result.vaultName, 'self');
});

test('testConnection falls back to probe URLs when configured Argus port is unavailable', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url.startsWith('http://127.0.0.1:3001/')) {
      throw new TypeError('fetch failed');
    }
    return Response.json({ success: true, vaultName: 'WD' });
  };

  const result = await testConnection(readConfig({
    ARGUS_BASE_URL: 'http://127.0.0.1:3001',
    ARGUS_PROBE_URLS: 'http://127.0.0.1:3987',
  }), { fetchImpl });

  assert.deepEqual(calls.map((call) => call.url), [
    'http://127.0.0.1:3001/api/obsidian-bridge/test-connection',
    'http://127.0.0.1:3987/api/obsidian-bridge/test-connection',
  ]);
  assert.equal(result.vaultName, 'WD');
  assert.equal(result.argusBaseUrl, 'http://127.0.0.1:3987');
});

test('writeCrashReport does not retry duplicate writes after an active Argus URL times out', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url.startsWith('http://127.0.0.1:3001/')) {
      throw new TypeError('fetch failed');
    }
    throw new DOMException('This operation was aborted', 'AbortError');
  };

  await assert.rejects(
    writeCrashReport({
      title: 'CrashAI Report',
      content: '# Report',
      reportType: 'daily',
      date: '20260509',
    }, readConfig({
      ARGUS_BASE_URL: 'http://127.0.0.1:3001',
      ARGUS_PROBE_URLS: 'http://127.0.0.1:3987,http://localhost:3987',
    }), { fetchImpl }),
    /timed out/i,
  );

  assert.deepEqual(calls, [
    'http://127.0.0.1:3001/api/obsidian-bridge/documents',
    'http://127.0.0.1:3987/api/obsidian-bridge/documents',
  ]);
});
