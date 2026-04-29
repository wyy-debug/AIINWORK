#!/usr/bin/env node

import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

const SERVER_VERSION = '0.1.0';
const REDMINE_BASE_URL = (process.env.REDMINE_BASE_URL || 'http://soc-redmine.wd.com').replace(/\/+$/, '');
const REDMINE_API_KEY = process.env.REDMINE_API_KEY || '';
const DEFAULT_TIMEOUT_MS = readInteger(process.env.REDMINE_TIMEOUT_MS, 20_000, 3_000, 120_000);
const MAX_DIFF_BYTES = readInteger(process.env.REDMINE_MAX_DIFF_BYTES, 2 * 1024 * 1024, 64 * 1024, 10 * 1024 * 1024);
const DEFAULT_INCLUDE = 'journals,attachments,changesets,relations';

function readInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value || ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function asText(text) {
  return { content: [{ type: 'text', text: String(text) }] };
}

function asJson(value) {
  return asText(JSON.stringify(value, null, 2));
}

function toolError(error, details = {}) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        error: message,
        ...details,
        hints: buildHints(message, details),
      }, null, 2),
    }],
    isError: true,
  };
}

function buildHints(message, details = {}) {
  const text = `${message}\n${details.stderr || ''}\n${details.status || ''}`.toLowerCase();
  const hints = [];
  if (text.includes('redmine_api_key')) {
    hints.push('Configure REDMINE_API_KEY in the MCP server env. Do not put the token in prompts or reports.');
  }
  if (text.includes('401') || text.includes('403')) {
    hints.push('The Redmine API key is missing, expired, or lacks permission for this issue/repository.');
  }
  if (text.includes('404')) {
    hints.push('Check the issue id, revision, repository id, or whether this Redmine project exposes repository diff pages.');
  }
  if (text.includes('timed out') || text.includes('network') || text.includes('fetch failed')) {
    hints.push('Check VPN/network access to the Redmine host and increase REDMINE_TIMEOUT_MS if needed.');
  }
  if (text.includes('not a git repository') || text.includes('bad object') || text.includes('unknown revision')) {
    hints.push('Pass codeRoot for the repository that contains the Redmine changeset revision, or fetch the target branch first.');
  }
  if (!hints.length) {
    hints.push('Run get_issue_changesets first to confirm the issue contains revisions and file paths.');
  }
  return hints;
}

function requireApiKey() {
  if (!REDMINE_API_KEY.trim()) {
    throw new Error('REDMINE_API_KEY is required for soc-redmine MCP.');
  }
}

function normalizeIssueId(value) {
  const id = Number.parseInt(String(value || ''), 10);
  if (!Number.isFinite(id) || id <= 0) {
    throw new Error('issueId must be a positive integer.');
  }
  return id;
}

function normalizeRevision(value) {
  const revision = String(value || '').trim();
  if (!/^[a-f0-9]{7,64}$/i.test(revision)) {
    throw new Error('revision must be a git SHA or SHA prefix.');
  }
  return revision;
}

function resolveRoot(root) {
  const value = String(root || '').trim();
  if (!value) {
    throw new Error('root is required for local git diff lookup.');
  }
  return path.resolve(value);
}

async function fetchRedmineJson(pathname, query = {}) {
  requireApiKey();
  const url = new URL(`${REDMINE_BASE_URL}${pathname}`);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      url.searchParams.set(key, String(value));
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'X-Redmine-API-Key': REDMINE_API_KEY,
      },
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`Redmine returned HTTP ${response.status} for ${url.pathname}`);
    }
    return JSON.parse(text);
  } finally {
    clearTimeout(timer);
  }
}

async function fetchRedmineText(pathname, query = {}) {
  requireApiKey();
  const url = new URL(`${REDMINE_BASE_URL}${pathname}`);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      url.searchParams.set(key, String(value));
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'text/plain,text/html,application/json',
        'X-Redmine-API-Key': REDMINE_API_KEY,
      },
      signal: controller.signal,
    });
    const text = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      url: url.toString(),
      contentType: response.headers.get('content-type') || '',
      text: text.slice(0, MAX_DIFF_BYTES),
      truncated: text.length > MAX_DIFF_BYTES,
    };
  } finally {
    clearTimeout(timer);
  }
}

function normalizeIssue(issue) {
  return {
    id: issue.id,
    subject: issue.subject || '',
    description: issue.description || '',
    project: issue.project || null,
    tracker: issue.tracker || null,
    status: issue.status || null,
    priority: issue.priority || null,
    author: issue.author || null,
    assigned_to: issue.assigned_to || null,
    category: issue.category || null,
    fixed_version: issue.fixed_version || null,
    created_on: issue.created_on || '',
    updated_on: issue.updated_on || '',
    closed_on: issue.closed_on || '',
    custom_fields: Array.isArray(issue.custom_fields)
      ? issue.custom_fields.map((field) => ({
          id: field.id,
          name: field.name,
          value: Array.isArray(field.value) ? field.value : field.value ?? '',
        }))
      : [],
    journals: Array.isArray(issue.journals)
      ? issue.journals.map((journal) => ({
          id: journal.id,
          user: journal.user || null,
          notes: journal.notes || '',
          created_on: journal.created_on || '',
          details: journal.details || [],
        }))
      : [],
    attachments: Array.isArray(issue.attachments)
      ? issue.attachments.map((attachment) => ({
          id: attachment.id,
          filename: attachment.filename,
          filesize: attachment.filesize,
          content_type: attachment.content_type,
          content_url: attachment.content_url,
          description: attachment.description || '',
        }))
      : [],
    changesets: normalizeChangesets(issue.changesets),
    relations: issue.relations || [],
  };
}

function normalizeChangesets(changesets) {
  if (!Array.isArray(changesets)) return [];
  return changesets.map((changeset) => ({
    revision: changeset.revision || '',
    branch: changeset.branch || '',
    committed_on: changeset.committed_on || '',
    comments: changeset.comments || '',
    user: changeset.user || null,
    repository: changeset.repository || null,
    files: Array.isArray(changeset.files)
      ? changeset.files.map((file) => ({
          path: file.path || '',
          action: file.action || '',
        }))
      : [],
  }));
}

async function readIssue(issueId) {
  const id = normalizeIssueId(issueId);
  const data = await fetchRedmineJson(`/issues/${id}.json`, { include: DEFAULT_INCLUDE });
  return normalizeIssue(data.issue || {});
}

function runProcess(command, args, options = {}) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let truncated = false;
    let child;
    let settled = false;
    let timeoutId;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (timeoutId) clearTimeout(timeoutId);
      resolve(result);
    };

    try {
      child = spawn(command, args, {
        cwd: options.cwd,
        windowsHide: true,
        shell: false,
      });
    } catch (error) {
      finish({ code: -1, stdout: '', stderr: error.message, truncated: false });
      return;
    }

    const append = (chunk, stream) => {
      const next = chunk.toString('utf8');
      if (stdout.length + stderr.length + next.length > MAX_DIFF_BYTES) {
        truncated = true;
        return;
      }
      if (stream === 'stdout') stdout += next;
      else stderr += next;
    };

    timeoutId = setTimeout(() => {
      try {
        child.kill('SIGTERM');
      } catch {
        // ignore
      }
      finish({
        code: -1,
        stdout,
        stderr: `${stderr}${stderr ? '\n' : ''}Command timed out after ${DEFAULT_TIMEOUT_MS}ms`,
        truncated,
      });
    }, DEFAULT_TIMEOUT_MS);

    child.stdout.on('data', (chunk) => append(chunk, 'stdout'));
    child.stderr.on('data', (chunk) => append(chunk, 'stderr'));
    child.on('error', (error) => finish({ code: -1, stdout, stderr: error.message, truncated }));
    child.on('close', (code) => finish({ code: code ?? 0, stdout, stderr, truncated }));
  });
}

async function getIssue(args = {}) {
  const issue = await readIssue(args.issueId);
  return asJson({ baseUrl: REDMINE_BASE_URL, issue });
}

async function getIssueChangesets(args = {}) {
  const issue = await readIssue(args.issueId);
  return asJson({
    issueId: issue.id,
    subject: issue.subject,
    changesets: issue.changesets,
  });
}

async function getLocalGitDiff(root, revision, paths = []) {
  const stat = await fs.stat(root);
  if (!stat.isDirectory()) {
    throw new Error(`root is not a directory: ${root}`);
  }

  const args = [
    '-C',
    root,
    'show',
    '--stat',
    '--patch',
    '--find-renames',
    '--find-copies',
    '--no-ext-diff',
    '--no-color',
    revision,
  ];
  const normalizedPaths = Array.isArray(paths)
    ? paths.map((entry) => String(entry || '').trim()).filter(Boolean)
    : [];
  if (normalizedPaths.length > 0) {
    args.push('--', ...normalizedPaths);
  }

  const result = await runProcess('git', args);
  return {
    ok: result.code === 0,
    command: `git ${args.join(' ')}`,
    exitCode: result.code,
    stdout: result.stdout,
    stderr: result.stderr,
    truncated: result.truncated,
  };
}

function likelyPatch(text, contentType = '') {
  return (
    /^diff --git /m.test(text)
    || /^Index: /m.test(text)
    || /^@@ /m.test(text)
    || contentType.includes('text/plain')
  );
}

async function tryRedmineDiffFallback({ revision, repositoryId, projectIdentifier }) {
  const attempts = [];
  const candidates = [];
  if (repositoryId) {
    candidates.push(`/repositories/${repositoryId}/revisions/${revision}/diff`);
    candidates.push(`/repositories/${repositoryId}/revisions/${revision}`);
  }
  if (projectIdentifier) {
    candidates.push(`/projects/${encodeURIComponent(projectIdentifier)}/repository/revisions/${revision}/diff`);
    candidates.push(`/projects/${encodeURIComponent(projectIdentifier)}/repository/revisions/${revision}`);
  }

  for (const pathname of candidates) {
    const response = await fetchRedmineText(pathname);
    attempts.push({
      url: response.url,
      status: response.status,
      contentType: response.contentType,
      ok: response.ok,
      looksLikePatch: likelyPatch(response.text, response.contentType),
      preview: response.text.slice(0, 500),
    });
    if (response.ok && likelyPatch(response.text, response.contentType)) {
      return {
        ok: true,
        source: 'redmine',
        url: response.url,
        contentType: response.contentType,
        diff: response.text,
        truncated: response.truncated,
        attempts,
      };
    }
  }

  return {
    ok: false,
    source: 'redmine',
    attempts,
    reason: candidates.length > 0
      ? 'Redmine did not expose a usable revision diff for the tested endpoints.'
      : 'No repositoryId or projectIdentifier was provided for Redmine diff fallback.',
  };
}

async function getRevisionDiff(args = {}) {
  const root = resolveRoot(args.root);
  const revision = normalizeRevision(args.revision);
  let issue = null;
  if (args.issueId) {
    issue = await readIssue(args.issueId);
  }

  const matchingChangeset = issue?.changesets?.find((changeset) => (
    changeset.revision === revision || changeset.revision?.startsWith(revision)
  ));
  const paths = Array.isArray(args.paths) && args.paths.length > 0
    ? args.paths
    : matchingChangeset?.files?.map((file) => file.path) || [];

  const local = await getLocalGitDiff(root, revision, paths);
  if (local.ok) {
    return asJson({
      revision,
      root,
      source: 'local-git',
      command: local.command,
      files: paths,
      diff: local.stdout,
      truncated: local.truncated,
    });
  }

  const repositoryId = args.repositoryId || matchingChangeset?.repository?.id;
  const projectIdentifier = args.projectIdentifier || args.project;
  const redmine = await tryRedmineDiffFallback({ revision, repositoryId, projectIdentifier });
  if (redmine.ok) {
    return asJson({
      revision,
      root,
      files: paths,
      localGitFailure: {
        command: local.command,
        exitCode: local.exitCode,
        stderr: local.stderr,
      },
      ...redmine,
    });
  }

  return toolError('Unable to retrieve full revision diff.', {
    revision,
    root,
    files: paths,
    localGitFailure: {
      command: local.command,
      exitCode: local.exitCode,
      stderr: local.stderr,
    },
    redmineFallback: redmine,
    issueSummary: issue ? {
      id: issue.id,
      subject: issue.subject,
      changesetCount: issue.changesets.length,
    } : undefined,
  });
}

const tools = [
  {
    name: 'get_issue',
    description: 'Fetch one SOC Redmine issue with journals, attachments, changesets, relations, and custom fields.',
    inputSchema: {
      type: 'object',
      required: ['issueId'],
      properties: {
        issueId: { type: 'number', description: 'Redmine issue id.' },
      },
    },
  },
  {
    name: 'get_issue_changesets',
    description: 'Fetch changesets linked to a SOC Redmine issue.',
    inputSchema: {
      type: 'object',
      required: ['issueId'],
      properties: {
        issueId: { type: 'number', description: 'Redmine issue id.' },
      },
    },
  },
  {
    name: 'get_revision_diff',
    description: 'Retrieve a revision diff. Prefer local git show from root, then try Redmine revision fallback.',
    inputSchema: {
      type: 'object',
      required: ['root', 'revision'],
      properties: {
        root: { type: 'string', description: 'Local git repository root containing the revision.' },
        revision: { type: 'string', description: 'Git revision SHA or SHA prefix.' },
        issueId: { type: 'number', description: 'Optional Redmine issue id to derive file paths/repository id.' },
        repositoryId: { type: 'number', description: 'Optional Redmine repository id for fallback.' },
        projectIdentifier: { type: 'string', description: 'Optional Redmine project identifier for fallback.' },
        paths: { type: 'array', items: { type: 'string' }, description: 'Optional paths to limit git show.' },
      },
    },
  },
];

const handlers = {
  get_issue: getIssue,
  get_issue_changesets: getIssueChangesets,
  get_revision_diff: getRevisionDiff,
};

const server = new Server(
  { name: 'soc-redmine', version: SERVER_VERSION },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const handler = handlers[request.params.name];
  if (!handler) return toolError(`Unknown tool: ${request.params.name}`);
  try {
    return await handler(request.params.arguments || {});
  } catch (error) {
    return toolError(error);
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
