import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { runRustCore } from '../src/rust_bridge.js';
import { formatCrashAiReportText } from '../src/tool_output.js';

test('formatCrashAiReportText exposes a direct report and same-response context without readback files', () => {
  const text = formatCrashAiReportText({
    markdown: '# fact section',
    summary: { totalIssues: 1 },
    rows: [{
      id: 1,
      platform: 'PC',
      crashSightLink: 'https://crashsight.qq.com/crash-reporting/crashes/app/issue?pid=10',
      totalCrashNum: 2,
      totalAffectedDevices: 1,
      applicationVersion: 'trunk_100',
      redmineStatus: '#116204 已关闭',
      redmineOwner: 'T 唐宇(ty)',
      tags: ['http://soc-redmine.wd.com/issues/116204'],
    }],
    redmine: [],
    errors: [],
  });

  assert.match(text, /^CRASH_AI_DIRECT_REPORT\n/m);
  assert.match(text, /# fact section/);
  assert.match(text, /CRASH_AI_AGENT_CONTEXT_JSON\n\{/);
  assert.match(text, /"rowsCount":1/);
  assert.match(text, /"rowFacts":\[/);
  assert.match(text, /"totalCrashNum":2/);
  assert.doesNotMatch(text, /CRASH_AI_STRUCTURED_JSON/);
  assert.doesNotMatch(text, /tool-results/);
  assert.doesNotMatch(text, /此处省略|控制篇幅|完整数据共/);
});

test('runRustCore calls core process with JSON stdin and parses JSON stdout', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'crash-ai-core-mock-'));
  const mockScript = path.join(tmpDir, 'mock-core.mjs');
  await fs.writeFile(mockScript, `
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    process.stdout.write(JSON.stringify({
      markdown: '# mocked report',
      summary: { totalIssues: 1 },
      rows: [{ platform: input.platforms?.[0] || 'PC' }],
      redmine: [],
      errors: [],
      timingMs: { total: 1 }
    }));
  `);

  const result = await runRustCore(
    { platforms: ['PC'] },
    {},
    { corePath: process.execPath, coreArgs: [mockScript] },
  );

  assert.equal(result.markdown, '# mocked report');
  assert.deepEqual(result.summary, { totalIssues: 1 });
  assert.deepEqual(result.rows, [{ platform: 'PC' }]);
});

test('runRustCore reports clear error when bundled core is missing', async () => {
  await assert.rejects(
    () => runRustCore({}, {}, { corePath: path.join(os.tmpdir(), 'missing-crash-ai-core.exe') }),
    /CrashAI Rust core missing; reinstall MCP package or check bin\/win32-x64\/crash-ai-core\.exe/,
  );
});
