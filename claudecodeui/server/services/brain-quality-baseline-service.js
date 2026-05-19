import crypto from 'node:crypto';

import Database from 'better-sqlite3';

import {
  BRAIN_ATOMS_PROJECT_INDEX_SQL,
  BRAIN_ATOMS_SESSION_INDEX_SQL,
  BRAIN_ATOMS_STABLE_INDEX_SQL,
  BRAIN_ATOMS_TABLE_SQL,
  BRAIN_COMPACTIONS_PROJECT_INDEX_SQL,
  BRAIN_COMPACTIONS_SESSION_INDEX_SQL,
  BRAIN_COMPACTIONS_TABLE_SQL,
  BRAIN_EVENTS_ARTIFACT_INDEX_SQL,
  BRAIN_EVENTS_CHECKPOINT_INDEX_SQL,
  BRAIN_EVENTS_PROJECT_INDEX_SQL,
  BRAIN_EVENTS_SESSION_INDEX_SQL,
  BRAIN_EVENTS_TABLE_SQL,
  BRAIN_NODES_PROJECT_INDEX_SQL,
  BRAIN_NODES_SESSION_INDEX_SQL,
  BRAIN_NODES_TABLE_SQL,
  BRAIN_PROJECT_PROFILES_INDEX_SQL,
  BRAIN_PROJECT_PROFILES_TABLE_SQL,
  BRAIN_REFS_EVENT_INDEX_SQL,
  BRAIN_REFS_REF_INDEX_SQL,
  BRAIN_REFS_SESSION_INDEX_SQL,
  BRAIN_REFS_TABLE_SQL,
  BRAIN_RETRIEVAL_RUNS_PROJECT_INDEX_SQL,
  BRAIN_RETRIEVAL_RUNS_SESSION_INDEX_SQL,
  BRAIN_RETRIEVAL_RUNS_TABLE_SQL,
  BRAIN_SCENARIOS_PROJECT_INDEX_SQL,
  BRAIN_SCENARIOS_SESSION_INDEX_SQL,
  BRAIN_SCENARIOS_TABLE_SQL,
  BRAIN_SESSIONS_LOOKUP_INDEX_SQL,
  BRAIN_SESSIONS_PROJECT_INDEX_SQL,
  BRAIN_SESSIONS_TABLE_SQL,
} from '../database/schema.js';
import { createBrainRecallService } from './brain-recall-service.js';
import { createBrainStore } from './brain-store-service.js';

const SENSITIVE_TEXT_PATTERN = /(sk-live|bearer token|secret-token|authorization|api[_-]?key|password|credential)/i;

const BRAIN_SCHEMA_SQL = [
  BRAIN_SESSIONS_TABLE_SQL,
  BRAIN_SESSIONS_LOOKUP_INDEX_SQL,
  BRAIN_SESSIONS_PROJECT_INDEX_SQL,
  BRAIN_EVENTS_TABLE_SQL,
  BRAIN_EVENTS_SESSION_INDEX_SQL,
  BRAIN_EVENTS_PROJECT_INDEX_SQL,
  BRAIN_EVENTS_CHECKPOINT_INDEX_SQL,
  BRAIN_EVENTS_ARTIFACT_INDEX_SQL,
  BRAIN_REFS_TABLE_SQL,
  BRAIN_REFS_SESSION_INDEX_SQL,
  BRAIN_REFS_EVENT_INDEX_SQL,
  BRAIN_REFS_REF_INDEX_SQL,
  BRAIN_NODES_TABLE_SQL,
  BRAIN_NODES_SESSION_INDEX_SQL,
  BRAIN_NODES_PROJECT_INDEX_SQL,
  BRAIN_COMPACTIONS_TABLE_SQL,
  BRAIN_COMPACTIONS_SESSION_INDEX_SQL,
  BRAIN_COMPACTIONS_PROJECT_INDEX_SQL,
  BRAIN_ATOMS_TABLE_SQL,
  BRAIN_ATOMS_SESSION_INDEX_SQL,
  BRAIN_ATOMS_PROJECT_INDEX_SQL,
  BRAIN_ATOMS_STABLE_INDEX_SQL,
  BRAIN_SCENARIOS_TABLE_SQL,
  BRAIN_SCENARIOS_SESSION_INDEX_SQL,
  BRAIN_SCENARIOS_PROJECT_INDEX_SQL,
  BRAIN_PROJECT_PROFILES_TABLE_SQL,
  BRAIN_PROJECT_PROFILES_INDEX_SQL,
  BRAIN_RETRIEVAL_RUNS_TABLE_SQL,
  BRAIN_RETRIEVAL_RUNS_SESSION_INDEX_SQL,
  BRAIN_RETRIEVAL_RUNS_PROJECT_INDEX_SQL,
].join('\n');

export const DEFAULT_BRAIN_QUALITY_FIXTURES = [
  {
    id: 'daily-use-checkout-risk',
    title: 'Checkout webhook decision recall',
    projectName: 'ArgusQuality',
    sessionId: 'quality-checkout',
    query: 'Continue the checkout webhook reliability work.',
    expectedTerms: ['checkout', 'webhook', 'idempotency', 'retry queue'],
    forbiddenTerms: ['secret-token', 'sk-live', 'bearer token'],
    compaction: {
      currentGoal: 'Stabilize checkout webhook processing.',
      activeDecisions: ['Use idempotency keys for checkout webhook retries.'],
      openRisks: ['Retry queue can duplicate user-visible status updates.'],
      nextAction: 'Add retry queue assertions before changing webhook handlers.',
      mermaid: 'flowchart TD\n  checkout["Stabilize checkout webhook processing"]\n  retry["Retry queue assertions"]',
      refs: ['fixture-checkout-command'],
    },
    nodes: [
      { id: 'quality_checkout_decision', nodeType: 'decision', title: 'Checkout webhook idempotency', summary: 'Use idempotency keys for checkout webhook retries.' },
      { id: 'quality_checkout_risk', nodeType: 'risk', title: 'Retry queue status risk', summary: 'Retry queue can duplicate user-visible status updates.' },
    ],
    events: [
      {
        id: 'fixture-checkout-command',
        eventType: 'command',
        title: 'Stabilize checkout webhook processing',
        content: 'Stabilize checkout webhook processing. Raw log contained a sensitive value.',
        refs: [{
          refType: 'raw_text',
          refId: 'checkout-log',
          label: 'Raw checkout log',
          content: 'payment provider returned secret-token and sk-live values',
        }],
      },
    ],
  },
  {
    id: 'daily-use-review-flow',
    title: 'Review flow recall',
    projectName: 'ArgusQuality',
    sessionId: 'quality-review',
    query: 'Prepare the git-native review flow summary.',
    expectedTerms: ['review flow', 'commit message', 'risk', 'tests'],
    forbiddenTerms: ['bearer token', 'secret-token'],
    compaction: {
      currentGoal: 'Generate a git-native review flow package.',
      activeDecisions: ['Review packages include summary, risks, tests, commit message, and PR body.'],
      openRisks: ['Risk sections must stay grounded in local diff evidence.'],
      nextAction: 'Refresh review artifact after the final diff is stable.',
      mermaid: 'flowchart TD\n  review["Review flow"]\n  artifact["Review artifact"]',
      refs: ['fixture-review-command'],
    },
    nodes: [
      { id: 'quality_review_decision', nodeType: 'decision', title: 'Review package structure', summary: 'Include summary, risks, tests, commit message, and PR body.' },
    ],
    events: [
      {
        id: 'fixture-review-command',
        eventType: 'assistant_summary',
        title: 'Review flow next action',
        content: 'Refresh review artifact after the final diff is stable.',
        refs: [{
          refType: 'raw_text',
          refId: 'review-summary',
          label: 'Review summary',
          content: 'Review flow produced summary, risk, tests, commit message, and PR body.',
        }],
      },
    ],
  },
  {
    id: 'daily-use-mcp-boundary',
    title: 'MCP boundary recall',
    projectName: 'ArgusQuality',
    sessionId: 'quality-mcp-boundary',
    query: 'Continue Brain and MCP runtime boundary guardrails.',
    expectedTerms: ['brain', 'mcp', 'source boundaries', 'profile tools'],
    forbiddenTerms: ['api_key', 'password'],
    compaction: {
      currentGoal: 'Keep Brain and MCP runtime boundaries explainable.',
      activeDecisions: ['Brain owns task state while MCP/Profile tools own external knowledge and code search.'],
      openRisks: ['Runtime diagnostics must not imply built-in code indexing or external knowledge sources.'],
      nextAction: 'Show source-aware diagnostics before merging recall packs.',
      mermaid: 'flowchart TD\n  brain["Brain recall"]\n  mcp["MCP/Profile tools"]\n  diagnostics["Runtime diagnostics"]',
      refs: ['fixture-mcp-boundary-command'],
    },
    nodes: [
      { id: 'quality_mcp_boundary_decision', nodeType: 'decision', title: 'Brain and MCP boundaries', summary: 'Brain owns task state while MCP/Profile tools own external knowledge and code search.' },
      { id: 'quality_mcp_boundary_risk', nodeType: 'risk', title: 'Diagnostic boundary risk', summary: 'Runtime diagnostics must not imply built-in code indexing or external knowledge sources.' },
    ],
    events: [
      {
        id: 'fixture-mcp-boundary-command',
        eventType: 'command',
        title: 'Continue Brain and MCP boundary guardrails',
        content: 'Continue Brain and MCP runtime boundary guardrails.',
        refs: [{
          refType: 'raw_text',
          refId: 'mcp-boundary',
          label: 'MCP boundary note',
          content: 'MCP/Profile tools provide external knowledge and code search while Brain provides task-state recall.',
        }],
      },
    ],
  },
  {
    id: 'daily-use-checkpoint-rollback',
    title: 'Checkpoint rollback recall',
    projectName: 'ArgusQuality',
    sessionId: 'quality-checkpoint',
    query: 'Resume checkpoint rollback validation.',
    expectedTerms: ['checkpoint', 'rollback', 'dirty start', 'patch'],
    forbiddenTerms: ['password', 'secret-token'],
    compaction: {
      currentGoal: 'Validate checkpoint rollback safety.',
      activeDecisions: ['Rollback uses reverse patches and blocks dirty-start checkpoints.'],
      openRisks: ['Dirty start checkpoints cannot be rolled back safely.'],
      nextAction: 'Assert patch rollback status before enabling the UI action.',
      mermaid: 'flowchart TD\n  checkpoint["Checkpoint"]\n  rollback["Rollback patch"]',
      refs: ['fixture-checkpoint-event'],
    },
    nodes: [
      { id: 'quality_checkpoint_decision', nodeType: 'decision', title: 'Rollback patch safety', summary: 'Rollback uses reverse patches and blocks dirty-start checkpoints.' },
      { id: 'quality_checkpoint_risk', nodeType: 'risk', title: 'Dirty start checkpoint', summary: 'Dirty start checkpoints cannot be rolled back safely.' },
    ],
    events: [
      {
        id: 'fixture-checkpoint-event',
        eventType: 'checkpoint',
        title: 'Checkpoint captured dirty start',
        content: 'Checkpoint patch rollback is blocked for dirty start state.',
        refs: [{
          refType: 'diff',
          refId: 'checkpoint-diff',
          label: 'Checkpoint patch',
          content: 'diff --git a/server/routes/checkpoints.js b/server/routes/checkpoints.js',
        }],
      },
    ],
  },
  {
    id: 'daily-use-subagent-plan',
    title: 'Subagent adjacent recall',
    projectName: 'ArgusQuality',
    sessionId: 'quality-subagent',
    query: 'Continue the delegated explorer plan.',
    expectedTerms: ['subagent', 'explorer', 'bounded task', 'review'],
    forbiddenTerms: ['api_key', 'bearer token'],
    compaction: {
      currentGoal: 'Coordinate bounded subagent work.',
      activeDecisions: ['Use explorers only for specific bounded questions and review their output before integration.'],
      openRisks: ['Do not duplicate work between the main rollout and a subagent.'],
      nextAction: 'Review subagent findings before making code changes.',
      mermaid: 'flowchart TD\n  main["Main rollout"]\n  explorer["Explorer bounded task"]\n  review["Review output"]',
      refs: ['fixture-subagent-event'],
    },
    nodes: [
      { id: 'quality_subagent_decision', nodeType: 'decision', title: 'Bounded explorer tasks', summary: 'Use explorers only for specific bounded questions and review their output before integration.' },
    ],
    events: [
      {
        id: 'fixture-subagent-event',
        eventType: 'assistant_summary',
        title: 'Subagent plan',
        content: 'Explorer subagent was assigned a bounded task and needs review before integration.',
        refs: [{
          refType: 'raw_text',
          refId: 'subagent-plan',
          label: 'Subagent plan',
          content: 'Use explorer for bounded task, then review before integration.',
        }],
      },
    ],
  },
];

const normalizeText = (value = '') => String(value || '').trim().replace(/\s+/g, ' ');

const sha256 = (value) => `sha256:${crypto.createHash('sha256').update(value).digest('hex')}`;

function createEphemeralBrainStore() {
  const db = new Database(':memory:');
  db.exec(BRAIN_SCHEMA_SQL);
  return { db, store: createBrainStore({ db }) };
}

function seedFixture(store, fixture, createdAtMs) {
  const provider = fixture.provider || 'claude';
  const eventIds = [];
  let rawRefCount = 0;
  for (const [index, event] of (fixture.events || []).entries()) {
    const created = store.addEvent({
      sessionId: fixture.sessionId,
      provider,
      projectName: fixture.projectName,
      eventType: event.eventType || 'command',
      role: event.role || '',
      title: event.title || fixture.title,
      content: event.content || '',
      refs: event.refs || [],
      createdAtMs: createdAtMs + index,
    });
    if (created?.id) eventIds.push(created.id);
    rawRefCount += Array.isArray(event.refs) ? event.refs.length : 0;
  }
  for (const node of fixture.nodes || []) {
    store.upsertNode({
      ...node,
      sessionId: fixture.sessionId,
      provider,
      projectName: fixture.projectName,
      sourceEventIds: eventIds,
      createdAtMs,
      updatedAtMs: createdAtMs,
    });
  }
  const compaction = fixture.compaction || {};
  store.addCompaction({
    sessionId: fixture.sessionId,
    provider,
    projectName: fixture.projectName,
    mermaid: compaction.mermaid || '',
    summary: compaction.summary || compaction.currentGoal || fixture.title,
    currentGoal: compaction.currentGoal || fixture.title,
    completedSteps: compaction.completedSteps || [],
    activeDecisions: compaction.activeDecisions || [],
    openRisks: compaction.openRisks || [],
    nextAction: compaction.nextAction || '',
    sourceEventStartId: eventIds[0] || '',
    sourceEventEndId: eventIds[eventIds.length - 1] || '',
    sourceEventCount: eventIds.length,
    tokenEstimate: Math.ceil(JSON.stringify(compaction).length / 4),
    refs: compaction.refs || eventIds,
    createdAtMs: createdAtMs + 100,
  });
  return { eventIds, rawRefCount };
}

function getRecallDiagnostics(result) {
  return result?.options?.runtimeDiagnostics?.brainRuntime?.recall || {};
}

function estimateTokens(text = '') {
  return Math.ceil(String(text || '').length / 4);
}

function evaluateFixture({ fixture, result, seed }) {
  const prompt = String(result?.options?.appendSystemPrompt || '');
  const promptLower = prompt.toLowerCase();
  const expectedTerms = Array.isArray(fixture.expectedTerms) ? fixture.expectedTerms : [];
  const matchedExpectedTerms = expectedTerms.filter((term) => promptLower.includes(String(term).toLowerCase()));
  const forbiddenTerms = [
    ...(Array.isArray(fixture.forbiddenTerms) ? fixture.forbiddenTerms : []),
  ].filter(Boolean);
  const forbiddenMatches = forbiddenTerms.filter((term) => promptLower.includes(String(term).toLowerCase()));
  const patternLeak = SENSITIVE_TEXT_PATTERN.test(prompt);
  const recallScore = expectedTerms.length
    ? matchedExpectedTerms.length / expectedTerms.length
    : 1;
  const missedTerms = expectedTerms.filter((term) => !matchedExpectedTerms.includes(term));
  const promptTokens = estimateTokens(prompt);
  const maxPromptTokens = Number(fixture.maxPromptTokens || 800);
  const tokenBudgetPassed = promptTokens <= maxPromptTokens;
  const diagnostics = getRecallDiagnostics(result);
  const redactionPassed = forbiddenMatches.length === 0 && !patternLeak;
  const expectedPassed = recallScore >= (fixture.minExpectedTermRecall || 0.75);
  const evidencePassed = Number(seed?.rawRefCount || 0) > 0;
  const status = expectedPassed && redactionPassed && tokenBudgetPassed && evidencePassed ? 'passed' : 'failed';
  return {
    id: fixture.id,
    title: fixture.title,
    status,
    expected: {
      terms: expectedTerms,
      matchedTerms: matchedExpectedTerms,
      missedTerms,
      recallScore,
      passed: expectedPassed,
    },
    tokenBudget: {
      passed: tokenBudgetPassed,
      promptTokens,
      maxPromptTokens,
    },
    evidence: {
      passed: evidencePassed,
      hasRawRef: evidencePassed,
      rawRefCount: Number(seed?.rawRefCount || 0),
    },
    redaction: {
      passed: redactionPassed,
      violationCount: redactionPassed ? 0 : Math.max(1, forbiddenMatches.length),
    },
    diagnostics: {
      status: diagnostics.status || '',
      hitCount: Array.isArray(diagnostics.recallHits) ? diagnostics.recallHits.length : 0,
      latestCompactionId: diagnostics.latestCompactionId ? '[stable-compaction]' : '',
    },
    promptPreview: normalizeText(prompt).slice(0, 260),
  };
}

function createSnapshotPayload(report) {
  return {
    version: report.version,
    summary: report.summary,
    metrics: report.metrics,
    fixtures: report.fixtures.map((fixture) => ({
      id: fixture.id,
      status: fixture.status,
      expected: fixture.expected,
      tokenBudget: fixture.tokenBudget,
      evidence: fixture.evidence,
      redaction: fixture.redaction,
      diagnostics: {
        status: fixture.diagnostics.status,
        hitCount: fixture.diagnostics.hitCount,
      },
    })),
  };
}

export function createBrainQualityBaselineService({
  createStore = createEphemeralBrainStore,
  createRecallService = ({ store }) => createBrainRecallService({
    store,
    readConfig: async () => ({
      enabled: true,
      maxInjectedTokens: 800,
      captureRawRefs: true,
    }),
  }),
} = {}) {
  const runBaseline = async ({
    fixtures = DEFAULT_BRAIN_QUALITY_FIXTURES,
    createdAtMs = Date.now(),
  } = {}) => {
    const fixtureResults = [];
    for (const [index, fixture] of fixtures.entries()) {
      const { db, store } = createStore({ fixture });
      try {
        const seed = seedFixture(store, fixture, createdAtMs + (index * 1000));
        const recall = createRecallService({ store, fixture });
        const result = await recall.applyToChatCommand({
          command: fixture.query || fixture.title,
          type: 'claude-command',
          options: {
            sessionId: fixture.sessionId,
            projectName: fixture.projectName,
            appendSystemPrompt: '',
          },
        }, fixture.provider || 'claude');
        fixtureResults.push(evaluateFixture({ fixture, result, seed }));
      } finally {
        db?.close?.();
      }
    }
    const total = fixtureResults.length;
    const passed = fixtureResults.filter((fixture) => fixture.status === 'passed').length;
    const failed = total - passed;
    const redactionViolationCount = fixtureResults.reduce((sum, fixture) => sum + fixture.redaction.violationCount, 0);
    const tokenBudgetViolationCount = fixtureResults.filter((fixture) => !fixture.tokenBudget.passed).length;
    const evidencePassedCount = fixtureResults.filter((fixture) => fixture.evidence.passed).length;
    const report = {
      version: 1,
      generatedAtMs: createdAtMs,
      summary: {
        total,
        passed,
        failed,
        passRate: total ? passed / total : 1,
      },
      metrics: {
        averageExpectedTermRecall: total
          ? fixtureResults.reduce((sum, fixture) => sum + fixture.expected.recallScore, 0) / total
          : 1,
        averageHitCount: total
          ? fixtureResults.reduce((sum, fixture) => sum + fixture.diagnostics.hitCount, 0) / total
          : 0,
        redactionViolationCount,
        tokenBudgetViolationCount,
        evidenceCoverage: total ? evidencePassedCount / total : 1,
      },
      gates: {
        recall: { passed: fixtureResults.every((fixture) => fixture.expected.passed) },
        redaction: { passed: redactionViolationCount === 0 },
        tokenBudget: { passed: tokenBudgetViolationCount === 0 },
        evidence: { passed: evidencePassedCount === total },
        snapshot: { passed: true },
      },
      fixtures: fixtureResults,
      snapshot: {
        checksum: '',
      },
    };
    const snapshotPayload = createSnapshotPayload(report);
    report.snapshot.checksum = sha256(JSON.stringify(snapshotPayload));
    return report;
  };

  return { runBaseline };
}

export function formatBrainQualityReport(report) {
  const lines = [
    '# Argus Brain Quality Baseline',
    '',
    `Generated: ${new Date(report.generatedAtMs).toISOString()}`,
    `Pass rate: ${report.summary.passed}/${report.summary.total}`,
    `Expected term recall: ${report.metrics.averageExpectedTermRecall.toFixed(2)}`,
    `Token budget violations: ${report.metrics.tokenBudgetViolationCount}`,
    `Evidence coverage: ${report.metrics.evidenceCoverage.toFixed(2)}`,
    `Redaction violations: ${report.metrics.redactionViolationCount}`,
    `Snapshot: ${report.snapshot.checksum}`,
    '',
    '| Fixture | Status | Expected Recall | Redaction |',
    '| --- | --- | ---: | --- |',
    ...report.fixtures.map((fixture) => [
      `| ${fixture.title}`,
      fixture.status,
      fixture.expected.recallScore.toFixed(2),
      fixture.redaction.passed ? 'passed |' : 'failed |',
    ].join(' | ')),
    '',
    '## Missed Terms and Evidence',
    ...report.fixtures.flatMap((fixture) => [
      `- ${fixture.title}: missed=${fixture.expected.missedTerms.length ? fixture.expected.missedTerms.join(', ') : 'none'}; rawRefs=${fixture.evidence.rawRefCount}; promptTokens=${fixture.tokenBudget.promptTokens}/${fixture.tokenBudget.maxPromptTokens}`,
    ]),
    '',
  ];
  return lines.join('\n');
}

export const brainQualityBaselineService = createBrainQualityBaselineService();
