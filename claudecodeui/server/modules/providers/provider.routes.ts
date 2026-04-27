import { access } from 'node:fs/promises';
import path from 'node:path';

import express, { type Request, type Response } from 'express';

import { providerAuthService } from '@/modules/providers/services/provider-auth.service.js';
import { providerMcpService } from '@/modules/providers/services/mcp.service.js';
import type { LLMProvider, McpScope, McpTransport, UpsertProviderMcpServerInput } from '@/shared/types.js';
import { AppError, asyncHandler, createApiSuccessResponse } from '@/shared/utils.js';

const router = express.Router();

const readPathParam = (value: unknown, name: string): string => {
  if (typeof value === 'string') {
    return value;
  }

  if (Array.isArray(value) && typeof value[0] === 'string') {
    return value[0];
  }

  throw new AppError(`${name} path parameter is invalid.`, {
    code: 'INVALID_PATH_PARAMETER',
    statusCode: 400,
  });
};

const normalizeProviderParam = (value: unknown): string =>
  readPathParam(value, 'provider').trim().toLowerCase();

const readOptionalQueryString = (value: unknown): string | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
};

const parseMcpScope = (value: unknown): McpScope | undefined => {
  if (value === undefined) {
    return undefined;
  }

  const normalized = readOptionalQueryString(value);
  if (!normalized) {
    return undefined;
  }

  if (normalized === 'user' || normalized === 'local' || normalized === 'project') {
    return normalized;
  }

  throw new AppError(`Unsupported MCP scope "${normalized}".`, {
    code: 'INVALID_MCP_SCOPE',
    statusCode: 400,
  });
};

const parseMcpTransport = (value: unknown): McpTransport => {
  const normalized = readOptionalQueryString(value);
  if (!normalized) {
    throw new AppError('transport is required.', {
      code: 'MCP_TRANSPORT_REQUIRED',
      statusCode: 400,
    });
  }

  if (normalized === 'stdio' || normalized === 'http' || normalized === 'sse') {
    return normalized;
  }

  throw new AppError(`Unsupported MCP transport "${normalized}".`, {
    code: 'INVALID_MCP_TRANSPORT',
    statusCode: 400,
  });
};

const parseMcpUpsertPayload = (payload: unknown): UpsertProviderMcpServerInput => {
  if (!payload || typeof payload !== 'object') {
    throw new AppError('Request body must be an object.', {
      code: 'INVALID_REQUEST_BODY',
      statusCode: 400,
    });
  }

  const body = payload as Record<string, unknown>;
  const name = readOptionalQueryString(body.name);
  if (!name) {
    throw new AppError('name is required.', {
      code: 'MCP_NAME_REQUIRED',
      statusCode: 400,
    });
  }

  const transport = parseMcpTransport(body.transport);
  const scope = parseMcpScope(body.scope);
  const workspacePath = readOptionalQueryString(body.workspacePath);

  return {
    name,
    transport,
    scope,
    workspacePath,
    command: readOptionalQueryString(body.command),
    args: Array.isArray(body.args) ? body.args.filter((entry): entry is string => typeof entry === 'string') : undefined,
    env: typeof body.env === 'object' && body.env !== null
      ? Object.fromEntries(
          Object.entries(body.env as Record<string, unknown>).filter(
            (entry): entry is [string, string] => typeof entry[1] === 'string',
          ),
        )
      : undefined,
    cwd: readOptionalQueryString(body.cwd),
    url: readOptionalQueryString(body.url),
    headers: typeof body.headers === 'object' && body.headers !== null
      ? Object.fromEntries(
          Object.entries(body.headers as Record<string, unknown>).filter(
            (entry): entry is [string, string] => typeof entry[1] === 'string',
          ),
        )
      : undefined,
    envVars: Array.isArray(body.envVars)
      ? body.envVars.filter((entry): entry is string => typeof entry === 'string')
      : undefined,
    bearerTokenEnvVar: readOptionalQueryString(body.bearerTokenEnvVar),
    envHttpHeaders: typeof body.envHttpHeaders === 'object' && body.envHttpHeaders !== null
      ? Object.fromEntries(
          Object.entries(body.envHttpHeaders as Record<string, unknown>).filter(
            (entry): entry is [string, string] => typeof entry[1] === 'string',
          ),
        )
      : undefined,
  };
};

const parseProvider = (value: unknown): LLMProvider => {
  const normalized = normalizeProviderParam(value);
  if (normalized === 'claude' || normalized === 'codex' || normalized === 'cursor' || normalized === 'gemini') {
    return normalized;
  }

  throw new AppError(`Unsupported provider "${normalized}".`, {
    code: 'UNSUPPORTED_PROVIDER',
    statusCode: 400,
  });
};

const findExecutable = async (command: string): Promise<string | null> => {
  const normalized = command.trim();
  if (!normalized) {
    return null;
  }

  const hasPathSegment = normalized.includes('/') || normalized.includes('\\') || path.isAbsolute(normalized);
  const extensions = process.platform === 'win32'
    ? (process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM')
        .split(';')
        .map((extension) => extension.trim())
        .filter(Boolean)
    : [''];
  const commandExtension = path.extname(normalized);
  const candidates = hasPathSegment
    ? [normalized, ...(process.platform === 'win32' && !commandExtension ? extensions.map((extension) => `${normalized}${extension}`) : [])]
    : String(process.env.PATH || '')
        .split(path.delimiter)
        .filter(Boolean)
        .flatMap((dir) => {
          if (process.platform !== 'win32' || commandExtension) {
            return [path.join(dir, normalized)];
          }
          return extensions.map((extension) => path.join(dir, `${normalized}${extension}`));
        });

  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // keep checking PATH candidates
    }
  }

  return null;
};

const inspectProviderMcpServer = async (
  provider: LLMProvider,
  name: string,
  scope: McpScope | undefined,
  workspacePath: string | undefined,
) => {
  const requestedScope = scope || 'user';
  const servers = await providerMcpService.listProviderMcpServersForScope(provider, requestedScope, { workspacePath });
  const server = servers.find((candidate) => candidate.name === name);
  if (!server) {
    throw new AppError('MCP server not found.', {
      code: 'MCP_SERVER_NOT_FOUND',
      statusCode: 404,
    });
  }

  const checks: Array<{ id: string; status: 'pass' | 'warn' | 'fail'; message: string; detail?: string }> = [];
  checks.push({
    id: 'definition',
    status: 'pass',
    message: 'MCP server definition was found in provider config.',
    detail: `${server.scope}:${server.transport}`,
  });

  if (server.transport === 'stdio') {
    const executable = await findExecutable(server.command || '');
    if (executable) {
      checks.push({
        id: 'command',
        status: 'pass',
        message: 'Startup command is available on this machine.',
        detail: executable,
      });
    } else {
      checks.push({
        id: 'command',
        status: 'fail',
        message: 'Startup command was not found on PATH or as an absolute file.',
        detail: server.command || '',
      });
    }
  } else if (server.url) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const headers: Record<string, string> = { ...(server.headers || {}) };
      if (server.transport === 'sse' && !Object.keys(headers).some((key) => key.toLowerCase() === 'accept')) {
        headers.Accept = 'text/event-stream';
      }
      const response = await fetch(server.url, {
        method: 'GET',
        headers,
        signal: controller.signal,
      });
      const status = response.status >= 500 ? 'fail' : response.status >= 400 ? 'warn' : 'pass';
      checks.push({
        id: 'endpoint',
        status,
        message: response.ok
          ? 'Remote MCP endpoint responded.'
          : `Remote MCP endpoint responded with HTTP ${response.status}.`,
        detail: server.url,
      });
    } catch (error) {
      checks.push({
        id: 'endpoint',
        status: 'fail',
        message: error instanceof Error && error.name === 'AbortError'
          ? 'Remote MCP endpoint timed out.'
          : 'Remote MCP endpoint could not be reached.',
        detail: server.url,
      });
    } finally {
      clearTimeout(timeout);
    }
  } else {
    checks.push({
      id: 'endpoint',
      status: 'fail',
      message: 'Remote MCP server is missing a URL.',
    });
  }

  checks.push({
    id: 'tools',
    status: 'warn',
    message: 'Tool listing is owned by the provider runtime and will be available after the session starts.',
  });

  const failed = checks.some((check) => check.status === 'fail');
  const warned = checks.some((check) => check.status === 'warn');
  return {
    provider,
    server,
    status: failed ? 'error' : warned ? 'warning' : 'ok',
    checkedAt: new Date().toISOString(),
    checks,
  };
};

router.get(
  '/:provider/auth/status',
  asyncHandler(async (req: Request, res: Response) => {
    const provider = parseProvider(req.params.provider);
    const status = await providerAuthService.getProviderAuthStatus(provider);
    res.json(createApiSuccessResponse(status));
  }),
);

router.get(
  '/:provider/mcp/servers',
  asyncHandler(async (req: Request, res: Response) => {
    const provider = parseProvider(req.params.provider);
    const workspacePath = readOptionalQueryString(req.query.workspacePath);
    const scope = parseMcpScope(req.query.scope);

    if (scope) {
      const servers = await providerMcpService.listProviderMcpServersForScope(provider, scope, { workspacePath });
      res.json(createApiSuccessResponse({ provider, scope, servers }));
      return;
    }

    const groupedServers = await providerMcpService.listProviderMcpServers(provider, { workspacePath });
    res.json(createApiSuccessResponse({ provider, scopes: groupedServers }));
  }),
);

router.post(
  '/:provider/mcp/servers',
  asyncHandler(async (req: Request, res: Response) => {
    const provider = parseProvider(req.params.provider);
    const payload = parseMcpUpsertPayload(req.body);
    const server = await providerMcpService.upsertProviderMcpServer(provider, payload);
    res.status(201).json(createApiSuccessResponse({ server }));
  }),
);

router.get(
  '/:provider/mcp/servers/:name/inspect',
  asyncHandler(async (req: Request, res: Response) => {
    const provider = parseProvider(req.params.provider);
    const scope = parseMcpScope(req.query.scope);
    const workspacePath = readOptionalQueryString(req.query.workspacePath);
    const name = readPathParam(req.params.name, 'name');
    const inspection = await inspectProviderMcpServer(provider, name, scope, workspacePath);
    res.json(createApiSuccessResponse(inspection));
  }),
);

router.delete(
  '/:provider/mcp/servers/:name',
  asyncHandler(async (req: Request, res: Response) => {
    const provider = parseProvider(req.params.provider);
    const scope = parseMcpScope(req.query.scope);
    const workspacePath = readOptionalQueryString(req.query.workspacePath);
    const result = await providerMcpService.removeProviderMcpServer(provider, {
      name: readPathParam(req.params.name, 'name'),
      scope,
      workspacePath,
    });
    res.json(createApiSuccessResponse(result));
  }),
);

router.post(
  '/mcp/servers/global',
  asyncHandler(async (req: Request, res: Response) => {
    const payload = parseMcpUpsertPayload(req.body);
    if (payload.scope === 'local') {
      throw new AppError('Global MCP add supports only "user" or "project" scopes.', {
        code: 'INVALID_GLOBAL_MCP_SCOPE',
        statusCode: 400,
      });
    }

    const results = await providerMcpService.addMcpServerToAllProviders({
      ...payload,
      scope: payload.scope === 'user' ? 'user' : 'project',
    });
    res.status(201).json(createApiSuccessResponse({ results }));
  }),
);

export default router;
