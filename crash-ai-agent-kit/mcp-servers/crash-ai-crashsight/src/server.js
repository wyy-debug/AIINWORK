#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import {
  SERVER_VERSION,
  CrashSightApiClient,
  compareIssueVersions,
  extractRedmineRefs,
  getSingleCrashAnalysisContext,
  healthCheck,
  readConfig,
  scanDailyCrashes,
  toolError,
} from './core.js';

const config = readConfig();
const client = new CrashSightApiClient(config);

function asJson(value) {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}

function asToolError(error, details = {}) {
  return {
    content: [{ type: 'text', text: JSON.stringify(toolError(error, details), null, 2) }],
    isError: true,
  };
}

const platformSchema = { type: ['string', 'number'], description: 'pc/android/ios or 10/1/2.' };
const versionFiltersSchema = {
  type: 'array',
  items: { type: 'string' },
  description: 'CrashSight version wildcards or exact versions. Example: ["*trunk*", "*weekly*"].',
};

const tools = [
  {
    name: 'health_check',
    description: 'Validate CrashSight credentials presence, platform appId mapping, and optional selector access.',
    inputSchema: {
      type: 'object',
      properties: {
        platform: platformSchema,
        platforms: { type: 'array', items: platformSchema },
        ping: { type: 'boolean' },
      },
    },
  },
  {
    name: 'scan_daily_crashes',
    description: 'Scan CrashSight crashes for one date or date range and return CrashSight rows, total crash/device counts, application versions, tags, Redmine links, and CrashSight links. Cross-version duplicates are kept.',
    inputSchema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'Single day, YYYYMMDD or YYYY-MM-DD. When set, startDate/endDate are both this day.' },
        startDate: { type: 'string', description: 'Range start, YYYYMMDD or YYYY-MM-DD.' },
        endDate: { type: 'string', description: 'Range end, YYYYMMDD or YYYY-MM-DD.' },
        startTime: { type: 'string', description: 'Exact range start, YYYY-MM-DD HH:mm:ss. Preferred when scanning part of a day.' },
        endTime: { type: 'string', description: 'Exact range end, YYYY-MM-DD HH:mm:ss. Preferred when scanning part of a day.' },
        platform: platformSchema,
        platforms: { type: 'array', items: platformSchema },
        versionFilters: versionFiltersSchema,
        branches: versionFiltersSchema,
        pageSize: { type: 'number', description: 'Internal CrashSight page size. Default 500; the MCP paginates until no more rows.' },
        maxPages: { type: 'number', description: 'Pagination safety limit. Default 100.' },
        rows: { type: 'number', description: 'Deprecated alias for pageSize. Do not use as a report row limit.' },
        appId: { type: 'string', description: 'Optional appId override for one platform.' },
      },
    },
  },
  {
    name: 'compare_issue_versions',
    description: 'Compare one CrashSight issue across version filters and judge whether it is new, continued, or likely resolved.',
    inputSchema: {
      type: 'object',
      required: ['platform'],
      properties: {
        platform: platformSchema,
        appId: { type: 'string' },
        issueId: { type: 'string' },
        issueHash: { type: 'string' },
        stackFingerprint: { type: 'string' },
        versionFilters: versionFiltersSchema,
        branches: versionFiltersSchema,
        rows: { type: 'number' },
      },
    },
  },
  {
    name: 'get_single_crash_analysis_context',
    description: 'Fetch one CrashSight issue context with full stacks, key logs/custom KV, and links. Dump payloads are not fetched.',
    inputSchema: {
      type: 'object',
      required: ['platform', 'issueId'],
      properties: {
        platform: platformSchema,
        appId: { type: 'string' },
        issueId: { type: 'string' },
        crashHash: { type: 'string' },
        logtype: { type: 'string', enum: ['interface', 'file', 'all', ''] },
        needCustomKv: { type: 'boolean' },
      },
    },
  },
  {
    name: 'extract_redmine_refs',
    description: 'Extract Redmine issue ids from CrashSight tags, title, or message.',
    inputSchema: {
      type: 'object',
      properties: {
        tags: { type: 'array', items: { type: ['string', 'object'] } },
        title: { type: 'string' },
        message: { type: 'string' },
        description: { type: 'string' },
      },
    },
  },
];

const server = new Server(
  { name: 'crash-ai-crashsight', version: SERVER_VERSION },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const name = request.params.name;
  const args = request.params.arguments || {};
  try {
    switch (name) {
      case 'health_check':
        return asJson(await healthCheck(args, config, client));
      case 'scan_daily_crashes':
        return asJson(await scanDailyCrashes(args, config, client));
      case 'compare_issue_versions':
        return asJson(await compareIssueVersions(args, config, client));
      case 'get_single_crash_analysis_context':
        return asJson(await getSingleCrashAnalysisContext(args, config, client));
      case 'extract_redmine_refs':
        return asJson({ redmineRefs: extractRedmineRefs(args) });
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    return asToolError(error, { tool: name });
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
