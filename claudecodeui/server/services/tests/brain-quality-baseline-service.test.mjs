import { describe, expect, it } from 'vitest';

import {
  DEFAULT_BRAIN_QUALITY_FIXTURES,
  createBrainQualityBaselineService,
  formatBrainQualityReport,
} from '../brain-quality-baseline-service.js';

describe('Argus Brain quality baseline service', () => {
  it('runs deterministic daily-use recall fixtures with quality and safety gates', async () => {
    const service = createBrainQualityBaselineService();

    const report = await service.runBaseline({
      fixtures: DEFAULT_BRAIN_QUALITY_FIXTURES,
      createdAtMs: 1_777_000_000_000,
    });

    expect(report.summary.total).toBeGreaterThanOrEqual(5);
    expect(report.summary.passed).toBe(report.summary.total);
    expect(report.metrics.averageExpectedTermRecall).toBeGreaterThanOrEqual(0.9);
    expect(report.metrics.tokenBudgetViolationCount).toBe(0);
    expect(report.metrics.evidenceCoverage).toBe(1);
    expect(report.metrics.redactionViolationCount).toBe(0);
    expect(report.gates.redaction.passed).toBe(true);
    expect(report.gates.tokenBudget.passed).toBe(true);
    expect(report.gates.evidence.passed).toBe(true);
    expect(report.gates.snapshot.passed).toBe(true);
    expect(report.snapshot.checksum).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(report.fixtures.every((fixture) => fixture.status === 'passed')).toBe(true);
    expect(report.fixtures.every((fixture) => Array.isArray(fixture.expected.missedTerms))).toBe(true);
    expect(report.fixtures.every((fixture) => fixture.evidence.hasRawRef === true)).toBe(true);
    expect(JSON.stringify(report)).not.toMatch(/sk-live|bearer token|secret-token/i);

    const markdown = formatBrainQualityReport(report);
    expect(markdown).toContain('# Argus Brain Quality Baseline');
    expect(markdown).toContain('| Fixture | Status | Expected Recall | Redaction |');
    expect(markdown).not.toMatch(/sk-live|bearer token|secret-token/i);
  });

  it('fails the redaction gate when recall prompt leaks forbidden fixture content', async () => {
    const service = createBrainQualityBaselineService({
      createRecallService: () => ({
        applyToChatCommand: async (command) => ({
          ...command,
          options: {
            ...(command.options || {}),
            appendSystemPrompt: 'Leaked secret-token from raw runtime log.',
            runtimeDiagnostics: {
              brainRuntime: {
                recall: {
                  status: 'injected',
                  recallHits: [{ kind: 'compaction', id: 'fixture' }],
                },
              },
            },
          },
        }),
      }),
    });

    const report = await service.runBaseline({
      fixtures: [DEFAULT_BRAIN_QUALITY_FIXTURES[0]],
      createdAtMs: 1_777_000_000_000,
    });

    expect(report.summary.failed).toBe(1);
    expect(report.metrics.redactionViolationCount).toBe(1);
    expect(report.gates.redaction.passed).toBe(false);
    expect(report.fixtures[0].redaction.passed).toBe(false);
  });

  it('fails the token budget gate when recall exceeds the fixture budget', async () => {
    const service = createBrainQualityBaselineService({
      createRecallService: () => ({
        applyToChatCommand: async (command) => ({
          ...command,
          options: {
            ...(command.options || {}),
            appendSystemPrompt: 'x'.repeat(2400),
            runtimeDiagnostics: {
              brainRuntime: {
                recall: {
                  status: 'injected',
                  recallHits: [{ kind: 'compaction', id: 'fixture' }],
                },
              },
            },
          },
        }),
      }),
    });

    const report = await service.runBaseline({
      fixtures: [{ ...DEFAULT_BRAIN_QUALITY_FIXTURES[0], maxPromptTokens: 100 }],
      createdAtMs: 1_777_000_000_000,
    });

    expect(report.summary.failed).toBe(1);
    expect(report.metrics.tokenBudgetViolationCount).toBe(1);
    expect(report.gates.tokenBudget.passed).toBe(false);
    expect(report.fixtures[0].tokenBudget.passed).toBe(false);
  });
});
