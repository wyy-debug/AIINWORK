import { parseFrontmatter } from '../utils/frontmatter.js';

import { normalizeAgentTemplateManifest } from './agent-template-manifest-service.js';

function normalizeString(value, fallback = '', maxLength = 4000) {
  const text = typeof value === 'string' ? value.trim() : '';
  return (text || fallback).slice(0, maxLength);
}

function normalizeStringArray(value) {
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((entry) => normalizeString(entry, '', 120))
      .filter(Boolean);
  }
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => normalizeString(entry, '', 120))
    .filter(Boolean);
}

function yamlScalar(value) {
  const text = normalizeString(value, '', 1000);
  if (!text) return '""';
  if (/^[A-Za-z0-9_./:@ -]+$/.test(text) && !/^(true|false|null|yes|no|on|off)$/i.test(text)) {
    return text;
  }
  return JSON.stringify(text);
}

function yamlStringArray(key, values) {
  const normalized = normalizeStringArray(values);
  if (normalized.length === 0) return [];
  return [
    `${key}:`,
    ...normalized.map((value) => `  - ${yamlScalar(value)}`),
  ];
}

export function parseClaudeCodeAgentMarkdown(markdown, options = {}) {
  const parsed = parseFrontmatter(String(markdown || ''));
  const metadata = parsed.data && typeof parsed.data === 'object' ? parsed.data : {};
  const id = normalizeString(options.id || metadata.name || metadata.id, 'agent-template', 120);
  const version = normalizeString(options.version || metadata.version, '1.0.0', 40);
  const tools = normalizeStringArray(metadata.tools);
  const model = normalizeString(metadata.model, '', 160);
  const description = normalizeString(metadata.description, '', 1000);
  const manifest = normalizeAgentTemplateManifest({
    id,
    version,
    kind: 'agent-template',
    runtime: {
      tools,
      model,
    },
    compat: {
      claudeCode: 'markdown-yaml',
    },
  }, { id, version });

  return {
    content: parsed.content.trim(),
    description,
    manifest,
    metadata,
  };
}

export function exportClaudeCodeAgentMarkdown(agent = {}) {
  const runtime = agent.runtime && typeof agent.runtime === 'object' ? agent.runtime : {};
  const lines = [
    '---',
    `description: ${yamlScalar(agent.description || agent.title || agent.name || '')}`,
    ...yamlStringArray('tools', runtime.tools),
  ];
  const model = normalizeString(runtime.model, '', 160);
  if (model) {
    lines.push(`model: ${yamlScalar(model)}`);
  }
  lines.push('---', '', String(agent.content || agent.systemPrompt || '').trim(), '');
  return lines.join('\n');
}
