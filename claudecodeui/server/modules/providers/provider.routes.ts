import { spawn } from 'node:child_process';
import os from 'node:os';
import { access, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import express, { type Request, type Response } from 'express';

import { providerAuthService } from '@/modules/providers/services/provider-auth.service.js';
import { providerMcpService } from '@/modules/providers/services/mcp.service.js';
import type { LLMProvider, McpScope, McpTransport, ProviderMcpServer, UpsertProviderMcpServerInput } from '@/shared/types.js';
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

type McpDiagnosticCheck = {
  id: string;
  status: 'pass' | 'warn' | 'fail';
  message: string;
  detail?: string;
};

const safeServerDirName = (name: string): string =>
  name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120) || 'mcp-server';

const exists = async (targetPath: string): Promise<boolean> => {
  try {
    await stat(targetPath);
    return true;
  } catch {
    return false;
  }
};

const readJsonIfExists = async (targetPath: string): Promise<Record<string, unknown> | null> => {
  try {
    return JSON.parse(await readFile(targetPath, 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
};

const resolveInstalledMcpDir = (
  server: ProviderMcpServer,
  workspacePath: string | undefined,
): string => {
  if (server.cwd && server.cwd.includes(`${path.sep}.mtl-code${path.sep}mcp-servers${path.sep}`)) {
    return server.cwd;
  }

  const serverDirName = safeServerDirName(server.name);
  if (server.scope === 'project' && workspacePath) {
    return path.join(workspacePath, '.mtl-code', 'mcp-servers', serverDirName);
  }

  return path.join(os.homedir(), '.mtl-code', 'mcp-servers', serverDirName);
};

const normalizeSetupFields = (manifest: Record<string, unknown> | null) => {
  const mcp = manifest?.mcp && typeof manifest.mcp === 'object'
    ? manifest.mcp as Record<string, unknown>
    : {};
  const rawFields = Array.isArray(mcp.setupFields)
    ? mcp.setupFields
    : Array.isArray(manifest?.setupFields)
      ? manifest?.setupFields
      : [];

  return rawFields
    .filter((field): field is Record<string, unknown> => Boolean(field) && typeof field === 'object')
    .map((field) => ({
      key: typeof field.key === 'string' ? field.key.trim() : '',
      label: typeof field.label === 'string' ? field.label.trim() : '',
      type: typeof field.type === 'string' ? field.type.trim() : '',
      target: typeof field.target === 'string' ? field.target.trim() : 'env',
      required: field.required === true,
    }))
    .filter((field) => field.key);
};

const normalizeManifestTools = (manifest: Record<string, unknown> | null): string[] => {
  const mcp = manifest?.mcp && typeof manifest.mcp === 'object'
    ? manifest.mcp as Record<string, unknown>
    : {};
  const rawTools = Array.isArray(mcp.tools) ? mcp.tools : [];
  return rawTools
    .map((tool) => {
      if (typeof tool === 'string') return tool;
      if (tool && typeof tool === 'object' && typeof (tool as Record<string, unknown>).name === 'string') {
        return String((tool as Record<string, unknown>).name);
      }
      return '';
    })
    .filter(Boolean);
};

const redactSecrets = (text: string, env: Record<string, string> = {}): string => {
  let redacted = text;
  for (const [key, value] of Object.entries(env)) {
    if (!value || value.length < 4) continue;
    if (/key|token|secret|password|authorization/i.test(key)) {
      redacted = redacted.split(value).join('[redacted]');
    }
  }
  return redacted.slice(0, 1200);
};

const checkLaunchable = async (
  server: ProviderMcpServer,
  executable: string | null,
  installDir: string,
): Promise<McpDiagnosticCheck> => new Promise((resolve) => {
  if (server.transport !== 'stdio') {
    resolve({
      id: 'launchable',
      status: 'warn',
      message: '非 stdio MCP 无法在本地拉起进程，已跳过启动检测。',
      detail: server.url || '',
    });
    return;
  }

  if (!executable) {
    resolve({
      id: 'launchable',
      status: 'fail',
      message: '启动命令不可用，无法检测 MCP Server。',
      detail: server.command || '',
    });
    return;
  }

  const cwd = server.cwd || installDir;
  const child = spawn(executable, server.args || [], {
    cwd,
    env: {
      ...process.env,
      ...(server.env || {}),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  let output = '';
  let settled = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const finish = (check: McpDiagnosticCheck) => {
    if (settled) return;
    settled = true;
    if (timeout) clearTimeout(timeout);
    resolve(check);
  };
  const collect = (chunk: Buffer | string) => {
    output += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : chunk;
    if (output.length > 2000) {
      output = output.slice(-2000);
    }
  };

  child.stdout?.on('data', collect);
  child.stderr?.on('data', collect);
  child.on('error', (error) => {
    finish({
      id: 'launchable',
      status: 'fail',
      message: 'MCP Server 启动失败。',
      detail: redactSecrets(error.message, server.env),
    });
  });

  timeout = setTimeout(() => {
    child.kill();
    finish({
      id: 'launchable',
      status: 'pass',
      message: 'MCP Server 可以启动并保持运行。',
      detail: '进程在检测窗口内保持存活，已自动结束检测进程。',
    });
  }, 2500);

  child.on('exit', (code) => {
    const detail = redactSecrets(output.trim(), server.env);
    finish({
      id: 'launchable',
      status: code === 0 ? 'warn' : 'fail',
      message: code === 0
        ? 'MCP Server 启动后很快退出，可能是自检型入口。'
        : `MCP Server 启动后退出，退出码 ${code ?? 'unknown'}。`,
      detail,
    });
  });
});

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
    message: 'Configuration is bound. Tool listing is discovered by the MTL-Code provider runtime after a session starts.',
    detail: 'v1 does not expose a separate MCP tool-list API.',
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

const diagnoseProviderMcpServer = async (
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

  const installDir = resolveInstalledMcpDir(server, workspacePath);
  const manifest = await readJsonIfExists(path.join(installDir, 'hub.mcp.json'));
  const packageJson = await readJsonIfExists(path.join(installDir, 'package.json'));
  const setupFields = normalizeSetupFields(manifest);
  const manifestTools = normalizeManifestTools(manifest);
  const checks: McpDiagnosticCheck[] = [];

  checks.push({
    id: 'config-written',
    status: 'pass',
    message: 'MCP 配置已写入 provider 配置。',
    detail: `${server.scope}:${server.transport}`,
  });

  checks.push({
    id: 'package-installed',
    status: await exists(installDir) ? 'pass' : 'fail',
    message: await exists(installDir)
      ? 'MCP 包已安装到本机。'
      : '未找到 MCP 安装目录。',
    detail: installDir,
  });

  const packageDependencies = packageJson && typeof packageJson === 'object' && packageJson.dependencies && typeof packageJson.dependencies === 'object'
    ? Object.keys(packageJson.dependencies as Record<string, unknown>)
    : [];
  const hasNodeModules = await exists(path.join(installDir, 'node_modules'));
  checks.push({
    id: 'dependencies-installed',
    status: packageDependencies.length === 0 || hasNodeModules ? 'pass' : 'fail',
    message: packageDependencies.length === 0
      ? 'MCP 包没有声明 npm 运行依赖。'
      : hasNodeModules
        ? 'MCP npm 依赖已安装。'
        : 'MCP npm 依赖缺失，请重新安装或执行 postInstall。',
    detail: packageDependencies.length > 0 ? packageDependencies.join(', ') : undefined,
  });

  const requiredFields = setupFields
    .filter((field) => field.required)
    .map((field) => {
      const configured = field.target === 'env'
        ? Boolean(server.env?.[field.key]?.trim())
        : field.target === 'header'
          ? Boolean(server.headers?.[field.key]?.trim())
          : Boolean(
              field.target === 'cwd'
                ? server.cwd
                : field.target === 'url'
                  ? server.url
                  : field.target === 'arg' || field.target === 'args'
                    ? server.args?.some((arg) => arg.includes(field.key))
                    : false,
            );
      return {
        key: field.key,
        label: field.label || field.key,
        type: field.type,
        target: field.target,
        required: field.required,
        configured,
      };
    });
  const missingRequiredFields = requiredFields.filter((field) => !field.configured);
  checks.push({
    id: 'required-setup',
    status: missingRequiredFields.length === 0 ? 'pass' : 'fail',
    message: missingRequiredFields.length === 0
      ? '必填配置已写入。'
      : '存在缺失的必填配置。',
    detail: requiredFields
      .map((field) => `${field.key}: ${field.configured ? 'configured' : 'missing'}`)
      .join(', '),
  });

  let executable: string | null = null;
  if (server.transport === 'stdio') {
    executable = await findExecutable(server.command || '');
    checks.push({
      id: 'command',
      status: executable ? 'pass' : 'fail',
      message: executable ? '启动命令可用。' : '启动命令不可用。',
      detail: executable || server.command || '',
    });
  }

  if (missingRequiredFields.length > 0) {
    checks.push({
      id: 'launchable',
      status: 'fail',
      message: '缺少必填配置，已跳过启动检测。',
      detail: missingRequiredFields.map((field) => `${field.key}: missing`).join(', '),
    });
  } else {
    checks.push(await checkLaunchable(server, executable, installDir));
  }

  checks.push({
    id: 'runtime-tools',
    status: manifestTools.length > 0 ? 'pass' : 'warn',
    message: manifestTools.length > 0
      ? 'manifest 中声明了可用工具；实际工具列表仍由 MTL-Code runtime 会话启动后发现。'
      : '未找到独立 tool-list API；工具列表将在会话启动后由 MTL-Code runtime 发现。',
    detail: manifestTools.join(', ') || 'runtime discovery',
  });

  const checkById = (id: string) => checks.find((check) => check.id === id);
  const configWrittenCheck = checkById('config-written');
  const packageInstalledCheck = checkById('package-installed');
  const dependenciesInstalledCheck = checkById('dependencies-installed');
  const launchableCheck = checkById('launchable');
  const runtimeToolsCheck = checkById('runtime-tools');
  const safeMessages = checks.map((check) => ({
    id: check.id,
    status: check.status,
    message: check.message,
    ...(check.detail ? { detail: redactSecrets(String(check.detail), server.env) } : {}),
  }));

  const failed = checks.some((check) => check.status === 'fail');
  const warned = checks.some((check) => check.status === 'warn');
  return {
    provider,
    server,
    scope: requestedScope,
    installDir,
    status: failed ? 'error' : warned ? 'warning' : 'ok',
    checkedAt: new Date().toISOString(),
    configWritten: configWrittenCheck?.status === 'pass',
    packageInstalled: packageInstalledCheck?.status === 'pass',
    dependenciesInstalled: dependenciesInstalledCheck?.status === 'pass',
    launchable: launchableCheck
      ? {
          status: launchableCheck.status,
          message: launchableCheck.message,
          detail: launchableCheck.detail ? redactSecrets(String(launchableCheck.detail), server.env) : '',
        }
      : null,
    runtimeToolsStatus: {
      status: runtimeToolsCheck?.status || 'warn',
      tools: manifestTools,
      message: runtimeToolsCheck?.message || 'Tool listing is discovered by the MTL-Code runtime after a session starts.',
    },
    safeMessages,
    requiredFields,
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

router.get(
  '/:provider/mcp/servers/:name/diagnose',
  asyncHandler(async (req: Request, res: Response) => {
    const provider = parseProvider(req.params.provider);
    const scope = parseMcpScope(req.query.scope);
    const workspacePath = readOptionalQueryString(req.query.workspacePath);
    const name = readPathParam(req.params.name, 'name');
    const diagnostics = await diagnoseProviderMcpServer(provider, name, scope, workspacePath);
    res.json(createApiSuccessResponse(diagnostics));
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
