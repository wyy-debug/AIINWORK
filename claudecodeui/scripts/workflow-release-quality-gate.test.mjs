import { describe, expect, test } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  buildWorkflowEvidenceManifest,
  buildWorkflowReleaseQualityGate,
  validateWorkflowEvidenceManifest,
  workflowReleaseScenarios,
} from './workflow-release-quality-gate.mjs';

describe('workflow release quality gate', () => {
  test('passes when every required workflow screenshot exists and records evidence manifest data', async () => {
    const screenshotDir = await mkdtemp(path.join(os.tmpdir(), 'workflow-gate-pass-'));
    for (const scenario of workflowReleaseScenarios) {
      for (const screenshot of scenario.screenshots) {
        await writeFile(path.join(screenshotDir, screenshot), 'png');
      }
    }

    const report = buildWorkflowReleaseQualityGate({
      screenshotDir,
      commitSha: 'abc1234',
      command: 'npm run workflow:quality-gate',
      now: () => new Date('2026-05-21T00:00:00.000Z'),
    });

    expect(report).toMatchObject({
      status: 'passed',
      passed: workflowReleaseScenarios.length,
      total: workflowReleaseScenarios.length,
      commitSha: 'abc1234',
    });
    expect(report.evidenceManifest.entries[0]).toEqual(expect.objectContaining({
      issueId: expect.stringMatching(/^REQ-/),
      screenshotPath: expect.any(String),
      commitSha: 'abc1234',
      command: 'npm run workflow:quality-gate',
    }));
    expect(validateWorkflowEvidenceManifest(report.evidenceManifest).valid).toBe(true);

    await rm(screenshotDir, { recursive: true, force: true });
  });

  test('fails with actionable missing evidence reasons', async () => {
    const screenshotDir = await mkdtemp(path.join(os.tmpdir(), 'workflow-gate-fail-'));
    const report = buildWorkflowReleaseQualityGate({
      screenshotDir,
      scenarios: [workflowReleaseScenarios[0]],
      commitSha: 'abc1234',
      now: () => new Date('2026-05-21T00:00:00.000Z'),
    });

    expect(report.status).toBe('failed');
    expect(report.failures[0].reason).toContain('Missing screenshot evidence');
    expect(validateWorkflowEvidenceManifest(report.evidenceManifest).errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'missing_screenshot_file' }),
    ]));

    await rm(screenshotDir, { recursive: true, force: true });
  });

  test('validates evidence manifest schema and required run ids when requested', () => {
    const manifest = buildWorkflowEvidenceManifest({
      scenarios: [{ id: 'agent-subagent-handoff', label: 'Agent handoff', screenshots: ['REQ-218D-agent-handoff-run.png'] }],
      screenshotDir: 'E:/missing',
      commitSha: 'abc1234',
      now: () => new Date('2026-05-21T00:00:00.000Z'),
    });

    const validation = validateWorkflowEvidenceManifest(manifest, { requireRunId: true });
    expect(validation.valid).toBe(false);
    expect(validation.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'missing_screenshot_file' }),
      expect.objectContaining({ code: 'missing_run_id' }),
    ]));
  });
});
