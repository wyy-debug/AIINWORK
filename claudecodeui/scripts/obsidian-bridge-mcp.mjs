#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const ARGUS_BASE_URL = (process.env.ARGUS_BASE_URL || 'http://127.0.0.1:3001').replace(/\/+$/g, '');
const ARGUS_API_TOKEN = process.env.ARGUS_API_TOKEN || '';

const requestArgus = async (path, body = null) => {
  const response = await fetch(`${ARGUS_BASE_URL}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(ARGUS_API_TOKEN ? { Authorization: `Bearer ${ARGUS_API_TOKEN}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.error) {
    throw new Error(data?.error || `Argus returned HTTP ${response.status}.`);
  }
  return data;
};

const jsonContent = (value) => ({
  content: [
    {
      type: 'text',
      text: JSON.stringify(value, null, 2),
    },
  ],
});

const tools = [
  {
    name: 'obsidian_active',
    description: 'Read the active Obsidian note and optional selection through Argus Bridge.',
    inputSchema: {
      type: 'object',
      properties: {
        vaultId: { type: 'string' },
        includeContent: { type: 'boolean', default: true },
        includeSelection: { type: 'boolean', default: true },
      },
    },
  },
  {
    name: 'obsidian_query',
    description: 'Query Obsidian notes by text, Properties, tags, path, headings, and source type.',
    inputSchema: {
      type: 'object',
      properties: {
        vaultId: { type: 'string' },
        query: { type: 'string' },
        folders: { type: 'array', items: { type: 'string' } },
        filters: { type: 'array', items: { type: 'object' } },
        sourceTypes: { type: 'array', items: { type: 'string', enum: ['markdown', 'canvas', 'excalidraw'] } },
        limit: { type: 'number' },
      },
    },
  },
  {
    name: 'obsidian_context',
    description: 'Build a compact Obsidian context block for a model prompt.',
    inputSchema: {
      type: 'object',
      properties: {
        vaultId: { type: 'string' },
        query: { type: 'string' },
        folders: { type: 'array', items: { type: 'string' } },
        limit: { type: 'number' },
      },
    },
  },
  {
    name: 'obsidian_patch',
    description: 'Patch a Markdown note heading or frontmatter through the Obsidian Vault API.',
    inputSchema: {
      type: 'object',
      required: ['target', 'operation'],
      properties: {
        vaultId: { type: 'string' },
        target: { type: 'object' },
        operation: { type: 'string', enum: ['append-heading', 'replace-heading', 'upsert-frontmatter'] },
        heading: { type: 'string' },
        occurrence: { type: 'number' },
        content: { type: 'string' },
        properties: { type: 'object' },
        createHeading: { type: 'boolean' },
      },
    },
  },
  {
    name: 'obsidian_memory_candidates',
    description: 'Create AI Memory review candidates from text or explicit candidate payloads.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string' },
        candidates: { type: 'array', items: { type: 'object' } },
        source: { type: 'object' },
      },
    },
  },
  {
    name: 'obsidian_memory_commit',
    description: 'Commit accepted AI Memory candidates to Obsidian AIMemory.',
    inputSchema: {
      type: 'object',
      required: ['candidateIds'],
      properties: {
        candidateIds: { type: 'array', items: { type: 'string' } },
        projectName: { type: 'string' },
      },
    },
  },
];

const server = new Server(
  { name: 'argus-obsidian-bridge', version: '0.1.1' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const args = request.params.arguments || {};
  switch (request.params.name) {
    case 'obsidian_active':
      return jsonContent(await requestArgus('/api/obsidian-bridge/active', args));
    case 'obsidian_query':
      return jsonContent(await requestArgus('/api/obsidian-bridge/query', args));
    case 'obsidian_context':
      return jsonContent(await requestArgus('/api/obsidian-bridge/context', args));
    case 'obsidian_patch':
      return jsonContent(await requestArgus('/api/obsidian-bridge/patch', args));
    case 'obsidian_memory_candidates':
      return jsonContent(await requestArgus('/api/obsidian-bridge/memory/candidates', args));
    case 'obsidian_memory_commit':
      return jsonContent(await requestArgus('/api/obsidian-bridge/memory/commit', args));
    default:
      throw new Error(`Unknown tool: ${request.params.name}`);
  }
});

await server.connect(new StdioServerTransport());
