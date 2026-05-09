#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import {
  SERVER_VERSION,
  readConfig,
  testConnection,
  toolError,
  writeCrashReport,
} from './core.js';

const config = readConfig();

function asJson(value) {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}

function asToolError(error, details = {}) {
  return {
    content: [{ type: 'text', text: JSON.stringify(toolError(error, details), null, 2) }],
    isError: true,
  };
}

const tools = [
  {
    name: 'obsidian_test_connection',
    description: 'Test Argus Obsidian Bridge connection through the configured Argus backend.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'obsidian_write_crash_report',
    description: 'Write a CrashAI Markdown report to Obsidian through Argus Obsidian Bridge.',
    inputSchema: {
      type: 'object',
      required: ['title', 'content'],
      properties: {
        title: { type: 'string' },
        content: { type: 'string' },
        reportType: { type: 'string', enum: ['daily', 'range', 'single'] },
        date: { type: 'string' },
        startDate: { type: 'string' },
        endDate: { type: 'string' },
        issueId: { type: 'string' },
        crashHash: { type: 'string' },
        projectName: { type: 'string' },
        mode: { type: 'string', enum: ['project-knowledge', 'second-brain', 'ai-memory'] },
        writeMode: { type: 'string', enum: ['direct', 'wiki', 'auto'] },
        vaultId: { type: 'string' },
        baseFolder: { type: 'string' },
        argusId: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
        metadata: { type: 'object' },
      },
    },
  },
];

const server = new Server(
  { name: 'crash-ai-obsidian', version: SERVER_VERSION },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const name = request.params.name;
  const args = request.params.arguments || {};
  try {
    switch (name) {
      case 'obsidian_test_connection':
        return asJson(await testConnection(config));
      case 'obsidian_write_crash_report':
        return asJson(await writeCrashReport(args, config));
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    return asToolError(error, { tool: name });
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
