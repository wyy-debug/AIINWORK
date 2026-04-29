#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const hubUrl = (process.env.HUB_URL || process.argv[2] || 'http://localhost:4877').replace(/\/+$/, '');
const adminToken = process.env.HUB_ADMIN_TOKEN || process.env.MTL_CODE_HUB_ADMIN_TOKEN || '';
const overwrite = process.env.HUB_OVERWRITE !== 'false';
const maxFileBytes = 2 * 1024 * 1024;
const textExtensions = new Set(['.md', '.yaml', '.yml', '.json', '.js', '.mjs', '.txt']);

async function collectPackageFiles(rootDir, prefix = '') {
  const entries = await fs.readdir(rootDir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolute = path.join(rootDir, entry.name);
    const relative = path.join(prefix, entry.name).replace(/\\/g, '/');
    if (entry.isDirectory()) {
      files.push(...await collectPackageFiles(absolute, relative));
      continue;
    }
    if (!entry.isFile()) continue;
    const stat = await fs.stat(absolute);
    if (stat.size > maxFileBytes) continue;
    const buffer = await fs.readFile(absolute);
    const extension = path.extname(entry.name).toLowerCase();
    const isText = textExtensions.has(extension) || !extension;
    files.push({
      path: relative,
      content: isText ? buffer.toString('utf8') : buffer.toString('base64'),
      encoding: isText ? 'utf8' : 'base64',
      size: stat.size,
    });
  }
  return files;
}

async function publishItem(payload) {
  const response = await fetch(`${hubUrl}/api/agent-repository-server/items`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(adminToken ? { Authorization: `Bearer ${adminToken}` } : {}),
    },
    body: JSON.stringify({ overwrite, ...payload }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.details || data.error || `Hub returned HTTP ${response.status}`);
  }
  console.log(`Published ${payload.kind}: ${payload.name}`);
}

const agentContent = await fs.readFile(
  path.join(projectRoot, 'agents', 'soc-redmine-review-agent.md'),
  'utf8',
);

await publishItem({
  kind: 'agent-template',
  name: 'soc-redmine-review-agent',
  title: 'SOC Redmine Review Agent',
  description: 'Fetch SOC Redmine issue context, review code risk, and generate prioritized test case tables.',
  author: 'AIINWORK',
  tags: ['soc', 'redmine', 'review', 'testing'],
  icon: 'bot',
  capabilities: [
    'Fetch Redmine issue context',
    'Analyze semantic code impact',
    'Review implementation risk',
    'Generate functional and unit test tables',
    'Print full markdown report in chat'
  ],
  dependencies: {
    skills: [
      { name: 'redmine-issue-intake' },
      { name: 'soc-risk-review' },
      { name: 'soc-testcase-table-generator' }
    ],
    mcpServers: [
      { name: 'soc-redmine' },
      { name: 'ainwork-code-search' }
    ]
  },
  supportedApps: [
    { id: 'soc-redmine', label: 'MCP: soc-redmine', category: 'MCP' },
    { id: 'ainwork-code-search', label: 'MCP: ainwork-code-search', category: 'MCP' }
  ],
  appSlots: [
    {
      id: 'redmine',
      label: 'Redmine MCP',
      required: true,
      placeholder: 'Select soc-redmine MCP',
      options: [{ id: 'soc-redmine', label: 'MCP: soc-redmine' }]
    },
    {
      id: 'code-search',
      label: 'Code Search MCP',
      required: true,
      placeholder: 'Select ainwork-code-search MCP',
      options: [{ id: 'ainwork-code-search', label: 'MCP: ainwork-code-search' }]
    }
  ],
  content: agentContent,
});

const skills = [
  {
    name: 'redmine-issue-intake',
    title: 'Redmine Issue Intake',
    description: 'Fetch and normalize SOC Redmine issue metadata, changesets, and diff evidence.'
  },
  {
    name: 'soc-risk-review',
    title: 'SOC Risk Review',
    description: 'Review SOC code risk using diff evidence and semantic impact.'
  },
  {
    name: 'soc-testcase-table-generator',
    title: 'SOC Testcase Table Generator',
    description: 'Generate prioritized functional and unit test tables from review risks.'
  }
];

for (const skill of skills) {
  await publishItem({
    kind: 'skill',
    name: skill.name,
    title: skill.title,
    description: skill.description,
    author: 'AIINWORK',
    tags: ['soc', 'redmine', 'review', 'testing'],
    capabilities: [skill.description],
    packageFiles: await collectPackageFiles(path.join(projectRoot, 'skills', skill.name)),
  });
}
