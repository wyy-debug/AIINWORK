import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('resolveSkillReferences returns runtime diagnostics for installed and missing skills', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-runtime-diagnostics-'));
  const configRoot = path.join(tempRoot, '.mtl-code');
  const skillDir = path.join(configRoot, 'skills', 'crashsight-single-crash-analysis');
  const skillPath = path.join(skillDir, 'SKILL.md');
  const largeSkillDir = path.join(configRoot, 'skills', 'large-context-skill');
  const largeSkillPath = path.join(largeSkillDir, 'SKILL.md');
  const longBody = [
    '# Large Context Skill',
    '',
    'Start of large skill instructions.',
    'A'.repeat(70_000),
    'End of large skill instructions that should survive with 1M context.',
  ].join('\n');

  await fs.mkdir(skillDir, { recursive: true });
  await fs.mkdir(largeSkillDir, { recursive: true });
  await fs.writeFile(skillPath, [
    '---',
    'name: crashsight-single-crash-analysis',
    'title: CrashSight Single Crash Analysis',
    'description: Analyze one CrashSight crash.',
    '---',
    '',
    '# CrashSight Single Crash Analysis',
    '',
    'Read crash data and produce a Chinese triage report.',
  ].join('\n'), 'utf8');
  await fs.writeFile(largeSkillPath, [
    '---',
    'name: large-context-skill',
    'title: Large Context Skill',
    '---',
    '',
    longBody,
  ].join('\n'), 'utf8');

  const previousConfigRoot = process.env.MTL_CODE_CONFIG_DIR;
  process.env.MTL_CODE_CONFIG_DIR = configRoot;
  try {
    const { resolveSkillReferences } = await import(`../agent-config-service.js?skillDiagnostics=${Date.now()}`);
    const result = await resolveSkillReferences([
      'crashsight-single-crash-analysis',
      'missing-skill',
    ]);

    assert.equal(result.details.length, 2);
    const installed = result.details.find((detail) => detail.name === 'crashsight-single-crash-analysis');
    assert.ok(installed);
    assert.equal(installed.callable, true);
    assert.equal(installed.exists, true);
    assert.equal(installed.path, skillPath);
    assert.equal(installed.unavailableReason, '');
    assert.ok(installed.promptLength > 0);

    const missing = result.details.find((detail) => detail.name === 'missing-skill');
    assert.ok(missing);
    assert.equal(missing.callable, false);
    assert.equal(missing.exists, false);
    assert.equal(missing.path, '');
    assert.equal(missing.unavailableReason, '未找到已安装的 SKILL.md，后端会提示模型不要依赖该 Skill。');

    assert.equal(result.prompt.includes(skillPath), true);
    assert.equal(result.prompt.includes('<skill name="crashsight-single-crash-analysis"'), true);
    assert.equal(result.prompt.includes('Read crash data and produce a Chinese triage report.'), true);
    assert.equal(result.prompt.includes('missing-skill (not installed; do not rely on this Skill until the user installs it)'), true);
    assert.ok(result.promptLength >= result.prompt.length);

    const largeContextResult = await resolveSkillReferences(['large-context-skill'], {
      contextWindowTokens: 1_000_000,
    });

    assert.equal(largeContextResult.prompt.includes('End of large skill instructions that should survive with 1M context.'), true);
    assert.equal(largeContextResult.prompt.includes('[Skill content truncated'), false);
  } finally {
    if (previousConfigRoot === undefined) {
      delete process.env.MTL_CODE_CONFIG_DIR;
    } else {
      process.env.MTL_CODE_CONFIG_DIR = previousConfigRoot;
    }
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});
