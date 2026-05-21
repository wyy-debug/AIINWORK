import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(scriptDir, '..');

export const workflowReleaseScenarios = [
  { id: 'dry-run-preview', label: 'Dry-run preview', screenshots: ['REQ-210C-preview-matched-run-console.png'] },
  { id: 'python-custom-node', label: 'Python custom node', screenshots: ['REQ-207-custom-node-run-output.png'] },
  { id: 'approval-ask-deny', label: 'Approval allow/ask/deny', screenshots: ['REQ-215D-allow-ask-deny-evidence.png'] },
  { id: 'artifact-output', label: 'Artifact output', screenshots: ['REQ-216B-artifact-gallery-contract.png'] },
  { id: 'retry-failed-node', label: 'Retry failed node', screenshots: ['REQ-210D-retry-controls.png'] },
  { id: 'mcp-fixture', label: 'MCP fixture', screenshots: ['REQ-217D-mcp-runtime-success.png'] },
  { id: 'agent-subagent-handoff', label: 'Agent/Subagent handoff', screenshots: ['REQ-218D-agent-handoff-run.png'] },
];

export function getGitCommitSha(cwd = appRoot) {
  try {
    return execSync('git rev-parse --short HEAD', { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return 'unknown';
  }
}

export function buildWorkflowEvidenceManifest({ scenarios = [], screenshotDir = '', commitSha = 'unknown', command = '', now = () => new Date() } = {}) {
  const entries = [];
  for (const scenario of scenarios) {
    for (const screenshot of scenario.screenshots || []) {
      const screenshotPath = path.resolve(screenshotDir, screenshot);
      const issueId = /^((?:REQ|BUG-UI)-[0-9A-Z-]+)/.exec(screenshot)?.[1] || '';
      entries.push({
        issueId,
        scenarioId: scenario.id,
        label: scenario.label,
        screenshotPath,
        screenshotName: screenshot,
        exists: existsSync(screenshotPath),
        runId: scenario.runId || '',
        command,
        commitSha,
        createdAt: now().toISOString(),
      });
    }
  }
  return {
    manifestVersion: '1',
    kind: 'workflow-release-evidence',
    generatedAt: now().toISOString(),
    commitSha,
    command,
    entries,
  };
}

export function validateWorkflowEvidenceManifest(manifest = {}, { requireRunId = false } = {}) {
  const errors = [];
  if (manifest.manifestVersion !== '1') errors.push({ code: 'invalid_manifest_version', message: 'manifestVersion must be 1' });
  if (!Array.isArray(manifest.entries) || manifest.entries.length === 0) errors.push({ code: 'missing_entries', message: 'Evidence manifest has no entries' });
  for (const entry of manifest.entries || []) {
    if (!entry.issueId) errors.push({ code: 'missing_issue_id', message: `Evidence ${entry.screenshotName || entry.screenshotPath} has no issue id` });
    if (!entry.screenshotPath) errors.push({ code: 'missing_screenshot_path', message: `${entry.issueId || 'entry'} has no screenshot path` });
    if (entry.screenshotPath && !entry.exists) errors.push({ code: 'missing_screenshot_file', message: `${entry.screenshotPath} does not exist` });
    if (requireRunId && !entry.runId) errors.push({ code: 'missing_run_id', message: `${entry.issueId || entry.scenarioId} has no run id` });
  }
  return {
    valid: errors.length === 0,
    errors,
  };
}

export function buildWorkflowReleaseQualityGate({
  screenshotDir = path.join(appRoot, 'output', 'playwright', 'screenshots'),
  scenarios = workflowReleaseScenarios,
  commitSha = getGitCommitSha(appRoot),
  command = 'npm run workflow:quality-gate',
  now = () => new Date(),
} = {}) {
  const matrix = scenarios.map((scenario) => {
    const missingScreenshots = (scenario.screenshots || []).filter((screenshot) => !existsSync(path.resolve(screenshotDir, screenshot)));
    return {
      id: scenario.id,
      label: scenario.label,
      status: missingScreenshots.length === 0 ? 'passed' : 'failed',
      command,
      durationMs: 0,
      failureReason: missingScreenshots.length > 0 ? `Missing screenshot evidence: ${missingScreenshots.join(', ')}` : '',
      screenshots: (scenario.screenshots || []).map((screenshot) => path.resolve(screenshotDir, screenshot)),
    };
  });
  const manifest = buildWorkflowEvidenceManifest({ scenarios, screenshotDir, commitSha, command, now });
  const evidenceValidation = validateWorkflowEvidenceManifest(manifest);
  const failures = [
    ...matrix.filter((item) => item.status !== 'passed').map((item) => ({ scenarioId: item.id, reason: item.failureReason })),
    ...evidenceValidation.errors.map((error) => ({ scenarioId: 'evidence-manifest', reason: error.message, code: error.code })),
  ];
  return {
    generatedAt: now().toISOString(),
    status: failures.length === 0 ? 'passed' : 'failed',
    commitSha,
    command,
    passed: matrix.filter((item) => item.status === 'passed').length,
    total: matrix.length,
    matrix,
    evidenceManifest: manifest,
    failures,
  };
}

function parseArgs(argv = []) {
  const args = { output: path.join(appRoot, 'output', 'workflow-release-quality-gate.json'), screenshotDir: path.join(appRoot, 'output', 'playwright', 'screenshots') };
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === '--output') args.output = path.resolve(argv[index + 1] || args.output);
    if (item === '--screenshot-dir') args.screenshotDir = path.resolve(argv[index + 1] || args.screenshotDir);
  }
  return args;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  const report = buildWorkflowReleaseQualityGate({ screenshotDir: args.screenshotDir });
  mkdirSync(path.dirname(args.output), { recursive: true });
  writeFileSync(args.output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ status: report.status, passed: report.passed, total: report.total, output: args.output }, null, 2));
  if (report.status !== 'passed') process.exit(1);
}
