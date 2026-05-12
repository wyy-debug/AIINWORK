#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const projectRoot = path.resolve(import.meta.dirname, '..');

async function read(relativePath) {
  return fs.readFile(path.join(projectRoot, relativePath), 'utf8');
}

function assertIncludes(content, expected, label) {
  assert.ok(
    content.includes(expected),
    `${label} must include: ${expected}`,
  );
}

function assertNotIncludes(content, unexpected, label) {
  assert.ok(
    !content.includes(unexpected),
    `${label} must not include old report section: ${unexpected}`,
  );
}

const contracts = [
  ['agents/crash-ai-agent.md', await read('agents/crash-ai-agent.md')],
  ['skills/crash-ai-daily-investigation/SKILL.md', await read('skills/crash-ai-daily-investigation/SKILL.md')],
  ['skills/crash-ai-daily-investigation/agents/openai.yaml', await read('skills/crash-ai-daily-investigation/agents/openai.yaml')],
];

for (const [label, content] of contracts) {
  assertIncludes(content, '目前存在问题', label);
  assertIncludes(content, '遗漏未开单问题：', label);
  assertIncludes(content, 'android', label);
  assertIncludes(content, 'pc', label);
  assertIncludes(content, '修复人：', label);
  assertIncludes(content, '版本：', label);
  assertIncludes(content, 'CrashSight：', label);
  assertIncludes(content, '修复人未验证', label);
  assertIncludes(content, '未提取到 Redmine', label);
  assertNotIncludes(content, '崩溃风险问题', label);
  assertNotIncludes(content, '紧急立刻单', label);
  assertNotIncludes(content, '近期关单', label);
  assertNotIncludes(content, '遗漏检查', label);
  assertNotIncludes(content, '## AI 判断与下一步', label);
  assertNotIncludes(content, '## 需程序排查清单', label);
}

const publishScript = await read('scripts/publish-to-hub.mjs');
assertIncludes(publishScript, 'Generate current filed issues and missing-unfiled issue lists by platform', 'scripts/publish-to-hub.mjs');
assertIncludes(publishScript, 'Include owner/fixer, application version, and CrashSight link for every issue item', 'scripts/publish-to-hub.mjs');

console.log('Validated CrashAI report format contract.');
