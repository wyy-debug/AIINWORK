import os from 'os';
import path from 'path';
import { promises as fs } from 'fs';

import { buildAgentKnowledgePrompt } from './agent-rag-service.js';
import { listInstalledSkills } from './agent-skill-service.js';

const UI_DATA_DIR = process.env.MTL_CODE_UI_DATA_DIR || path.join(os.homedir(), '.mtl-code-ui');
const AGENTS_DIR = process.env.MTL_CODE_AGENTS_CONFIG_DIR || path.join(UI_DATA_DIR, 'agents');
const AGENTS_PATH = path.join(AGENTS_DIR, 'agents.json');
const DEFAULT_CONTEXT_WINDOW_TOKENS = 200_000;
const MAX_CONTEXT_WINDOW_TOKENS = 4_000_000;
const MTL_CODE_HOME_DIR = process.env.MTL_CODE_CONFIG_DIR || path.join(os.homedir(), '.mtl-code');
const LEGACY_CLAUDE_HOME_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const MTL_CODE_MODEL_ENV_KEYS = {
  anthropicModel: 'ANTHROPIC_MODEL',
  maxContextTokens: 'MTL_CODE_MAX_CONTEXT_TOKENS',
  contextWindow: 'CONTEXT_WINDOW',
};
const DEFAULT_AGENT_CHANNELS = [
  {
    id: 'chat',
    type: 'chat',
    name: '应用内对话',
    description: '在 MTL-Code 中使用你的智能体',
    enabled: true,
  },
];

const nowIso = () => new Date().toISOString();

function isImplementedAppBinding(app) {
  return String(app || '').trim().startsWith('MCP: ');
}

const DEFAULT_AGENT_CONFIGS = [
  {
    id: 'task-manager',
    name: '任务管理',
    shortName: '任务',
    description: '拆解需求、维护工作记忆，并把项目推进状态同步给团队。',
    status: 'enabled',
    scope: 'global',
    modelConfig: {
      provider: 'mtl-code',
      model: 'deepseek-reasoner',
      contextWindowTokens: 1_000_000,
      temperature: 0.2,
    },
    repository: 'seed/default/task-manager',
    systemPrompt:
      '你是任务管理 Agent。优先澄清目标、拆解步骤、维护上下文，并在工具可用时同步日历、项目追踪器和知识库。输出要清晰、可执行；外部应用未连接时先询问用户。',
    appBindings: [],
    skills: ['需求拆解', '会议纪要', '风险提醒', '状态周报'],
    tools: ['Read', 'TodoRead', 'TodoWrite', 'Task'],
    guardrails: ['执行破坏性操作前必须确认', '跨项目写入前必须确认', '外部上传前清理密钥和隐私信息'],
    triggerRules: {
      mode: 'suggest',
      keywords: ['拆任务', '任务管理', '项目推进', '状态同步', '周报'],
      confidenceThreshold: 0.8,
    },
  },
  {
    id: 'code-reviewer',
    name: '代码审查',
    shortName: '审查',
    description: '关注回归风险、测试缺口和安全边界，输出可执行的 review 结论。',
    status: 'enabled',
    scope: 'project',
    modelConfig: {
      provider: 'mtl-code',
      model: 'inherit',
      contextWindowTokens: DEFAULT_CONTEXT_WINDOW_TOKENS,
      temperature: 0.1,
    },
    repository: 'seed/default/code-reviewer',
    systemPrompt:
      '你是代码审查 Agent。优先查找 bug、回归风险、安全问题和缺失测试。结论必须绑定文件和行号；如果没有发现问题，要明确说明剩余风险和未验证项。',
    appBindings: [],
    skills: ['安全审查', '测试建议', '变更摘要'],
    tools: ['Read', 'Grep', 'TodoRead'],
    guardrails: ['不回滚用户改动', '不暴露密钥', 'review 先列问题再总结'],
    triggerRules: {
      mode: 'suggest',
      keywords: ['review', '审查', '看一下 diff', '有没有问题', '测试缺口'],
      confidenceThreshold: 0.8,
    },
  },
  {
    id: 'product-planner',
    name: '产品规划',
    shortName: '产品',
    description: '把用户反馈整理成需求、优先级和可交付范围，适合迭代规划。',
    status: 'draft',
    scope: 'global',
    modelConfig: {
      provider: 'mtl-code',
      model: 'deepseek-chat',
      contextWindowTokens: 1_000_000,
      temperature: 0.4,
    },
    repository: 'seed/default/product-planner',
    systemPrompt:
      '你是产品规划 Agent。将分散反馈整理成问题、用户价值、验收标准和分阶段实施计划。对不确定信息标记假设，不替用户承诺排期。',
    appBindings: [],
    skills: ['PRD 生成', '优先级排序', '竞品分析'],
    tools: ['Read', 'TodoWrite'],
    guardrails: ['不替用户承诺排期', '不编造外部数据', '高不确定项标记假设'],
    triggerRules: {
      mode: 'suggest',
      keywords: ['PRD', '产品规划', '需求', '优先级', '路线图'],
      confidenceThreshold: 0.8,
    },
  },
];

function sanitizeAgentId(value, fallback = 'agent') {
  const id = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return id || fallback;
}

function validateAgentId(id) {
  return /^[a-z0-9][a-z0-9_-]{0,79}$/.test(id);
}

function normalizeString(value, fallback = '', maxLength = 4000) {
  const text = typeof value === 'string' ? value.trim() : '';
  return (text || fallback).slice(0, maxLength);
}

function normalizeStringArray(value, maxItems = 40, maxLength = 120) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => normalizeString(entry, '', maxLength))
    .filter(Boolean)
    .slice(0, maxItems);
}

function normalizeStatus(value) {
  return ['enabled', 'draft', 'paused'].includes(value) ? value : 'draft';
}

function normalizeScope(value) {
  return value === 'project' ? 'project' : 'global';
}

function normalizePositiveInteger(value, fallback, max = MAX_CONTEXT_WINDOW_TOKENS) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

function normalizeTemperature(value, fallback = 0.2) {
  const parsed = Number.parseFloat(String(value ?? ''));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.min(parsed, 2));
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch {
    return {};
  }
}

async function readMtlCodeRuntimeSettings() {
  const settingsCandidates = [
    path.join(MTL_CODE_HOME_DIR, 'settings.json'),
    path.join(LEGACY_CLAUDE_HOME_DIR, 'settings.json'),
  ];

  for (const settingsPath of settingsCandidates) {
    const settings = await readJsonIfExists(settingsPath);
    if (!settings || typeof settings !== 'object' || Object.keys(settings).length === 0) {
      continue;
    }

    const env = settings.env && typeof settings.env === 'object' ? settings.env : {};
    const contextWindowTokens = normalizePositiveInteger(
      env[MTL_CODE_MODEL_ENV_KEYS.maxContextTokens] || env[MTL_CODE_MODEL_ENV_KEYS.contextWindow],
      DEFAULT_CONTEXT_WINDOW_TOKENS,
    );
    const model = normalizeString(
      env[MTL_CODE_MODEL_ENV_KEYS.anthropicModel] || settings.model,
      '',
      160,
    );

    return {
      model,
      contextWindowTokens,
    };
  }

  return {
    model: '',
    contextWindowTokens: DEFAULT_CONTEXT_WINDOW_TOKENS,
  };
}

function normalizeAppBindings(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((binding) => {
      const item = binding && typeof binding === 'object' ? binding : {};
      const slot = normalizeString(item.slot, '', 80);
      const app = normalizeString(item.app, '', 120);
      if (!slot || !app) return null;
      if (!isImplementedAppBinding(app)) return null;
      const status = ['connected', 'optional', 'disabled'].includes(item.status)
        ? item.status
        : 'optional';
      return { slot, app, status };
    })
    .filter(Boolean)
    .slice(0, 30);
}

function normalizeChannels(value) {
  const source = Array.isArray(value) && value.length > 0 ? value : DEFAULT_AGENT_CHANNELS;
  return source
    .map((channel) => {
      const item = channel && typeof channel === 'object' ? channel : {};
      const id = sanitizeAgentId(item.id || item.type || item.name, 'channel');
      const type = ['chat', 'dingtalk', 'slack', 'webhook'].includes(item.type) ? item.type : 'chat';
      const fallbackName = type === 'chat' ? '应用内对话' : type === 'dingtalk' ? '钉钉' : id;
      const rawName = normalizeString(item.name, fallbackName, 80);
      return {
        id,
        type,
        name: rawName === 'ChatGPT' ? '应用内对话' : rawName,
        description: normalizeString(
          item.description,
          type === 'dingtalk' ? '在钉钉中使用你的智能体' : '',
          240,
        ).replace('在 Slack 中使用你的智能体', '在钉钉中使用你的智能体'),
        enabled: item.enabled !== false,
      };
    })
    .slice(0, 12);
}

function normalizeKnowledgeSources(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((source) => {
      const item = source && typeof source === 'object' ? source : {};
      const name = normalizeString(item.name, '', 160);
      if (!name) return null;
      const id = sanitizeAgentId(item.id || name, `knowledge-${Date.now()}`);
      const type = item.type === 'folder' ? 'folder' : 'file';
      const status = ['mock', 'pending', 'indexed', 'failed'].includes(item.status)
        ? item.status
        : 'pending';
      return {
        id,
        type,
        name,
        path: normalizeString(item.path, '', 1000),
        status,
        storageKey: normalizeString(item.storageKey, id, 160),
        fileCount: normalizePositiveInteger(item.fileCount, 0, 10000),
        chunkCount: normalizePositiveInteger(item.chunkCount, 0, 10000),
        addedAt: normalizeString(item.addedAt, '', 80),
      };
    })
    .filter(Boolean)
    .slice(0, 80);
}

function normalizeMemoryConfig(value, agentId) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    enabled: source.enabled !== false,
    namespace: normalizeString(source.namespace, `agent:${agentId}:memory`, 160),
    privacy: source.privacy === 'shared' ? 'shared' : 'private',
    description: normalizeString(
      source.description,
      '代理用来保存笔记、草稿和输出的持久文件夹，让它能长期持续工作。',
      400,
    ),
  };
}

function normalizeTriggerRules(value) {
  const rules = value && typeof value === 'object' ? value : {};
  const confidenceThreshold = Number.parseFloat(String(rules.confidenceThreshold ?? ''));
  return {
    mode: ['manual', 'suggest', 'auto'].includes(rules.mode) ? rules.mode : 'suggest',
    keywords: normalizeStringArray(rules.keywords, 40, 80),
    confidenceThreshold: Number.isFinite(confidenceThreshold)
      ? Math.max(0, Math.min(confidenceThreshold, 1))
      : 0.8,
  };
}

function normalizeModelConfig(value) {
  const modelConfig = value && typeof value === 'object' ? value : {};
  return {
    provider: normalizeString(modelConfig.provider, 'mtl-code', 80),
    model: normalizeString(modelConfig.model, 'inherit', 160),
    contextWindowTokens: normalizePositiveInteger(
      modelConfig.contextWindowTokens,
      DEFAULT_CONTEXT_WINDOW_TOKENS,
    ),
    temperature: normalizeTemperature(modelConfig.temperature, 0.2),
  };
}

function mergeNestedAgentPatch(existing, input) {
  const source = input && typeof input === 'object' ? input : {};
  return {
    ...existing,
    ...source,
    id: existing.id,
    modelConfig: {
      ...(existing.modelConfig || {}),
      ...(source.modelConfig && typeof source.modelConfig === 'object' ? source.modelConfig : {}),
    },
    memory: {
      ...(existing.memory || {}),
      ...(source.memory && typeof source.memory === 'object' ? source.memory : {}),
    },
    triggerRules: {
      ...(existing.triggerRules || {}),
      ...(source.triggerRules && typeof source.triggerRules === 'object' ? source.triggerRules : {}),
    },
  };
}

export function normalizeAgentConfig(value, existing = null) {
  const source = value && typeof value === 'object' ? value : {};
  const createdAt = normalizeString(existing?.createdAt, nowIso(), 80);
  const id = sanitizeAgentId(source.id || existing?.id || source.name);
  if (!validateAgentId(id)) {
    throw new Error('Invalid agent id');
  }

  return {
    id,
    name: normalizeString(source.name, existing?.name || id, 120),
    shortName: normalizeString(source.shortName, existing?.shortName || id.slice(0, 2).toUpperCase(), 16),
    description: normalizeString(source.description, existing?.description || '', 800),
    status: normalizeStatus(source.status ?? existing?.status),
    scope: normalizeScope(source.scope ?? existing?.scope),
    modelConfig: normalizeModelConfig(source.modelConfig ?? existing?.modelConfig),
    repository: normalizeString(source.repository, existing?.repository || '', 240),
    systemPrompt: normalizeString(source.systemPrompt, existing?.systemPrompt || '', 12_000),
    channels: normalizeChannels(source.channels ?? existing?.channels),
    appBindings: normalizeAppBindings(source.appBindings ?? existing?.appBindings),
    skills: normalizeStringArray(source.skills ?? existing?.skills, 60, 120),
    knowledgeSources: normalizeKnowledgeSources(source.knowledgeSources ?? existing?.knowledgeSources),
    memory: normalizeMemoryConfig(source.memory ?? existing?.memory, id),
    tools: normalizeStringArray(source.tools ?? existing?.tools, 80, 120),
    guardrails: normalizeStringArray(source.guardrails ?? existing?.guardrails, 40, 240),
    triggerRules: normalizeTriggerRules(source.triggerRules ?? existing?.triggerRules),
    version: normalizeString(source.version, existing?.version || '1.0.0', 40),
    createdAt,
    updatedAt: nowIso(),
  };
}

async function ensureAgentsStore() {
  await fs.mkdir(AGENTS_DIR, { recursive: true, mode: 0o700 });
  try {
    await fs.access(AGENTS_PATH);
  } catch {
    const agents = DEFAULT_AGENT_CONFIGS.map((agent) => normalizeAgentConfig(agent));
    await writeAgents(agents);
  }
}

async function readAgentsRaw() {
  await ensureAgentsStore();
  try {
    const raw = JSON.parse(await fs.readFile(AGENTS_PATH, 'utf8'));
    const agents = Array.isArray(raw.agents) ? raw.agents : [];
    return agents.map((agent) => normalizeAgentConfig(agent));
  } catch {
    const agents = DEFAULT_AGENT_CONFIGS.map((agent) => normalizeAgentConfig(agent));
    await writeAgents(agents);
    return agents;
  }
}

async function writeAgents(agents) {
  await fs.mkdir(AGENTS_DIR, { recursive: true, mode: 0o700 });
  await fs.writeFile(
    AGENTS_PATH,
    JSON.stringify({ schemaVersion: 1, updatedAt: nowIso(), agents }, null, 2),
    { mode: 0o600 },
  );
}

export async function listAgentConfigs({ includePaused = true } = {}) {
  const agents = await readAgentsRaw();
  return includePaused ? agents : agents.filter((agent) => agent.status !== 'paused');
}

export async function getAgentConfig(agentId) {
  const id = sanitizeAgentId(agentId);
  const agents = await readAgentsRaw();
  return agents.find((agent) => agent.id === id) || null;
}

export async function upsertAgentConfig(input) {
  const agents = await readAgentsRaw();
  const id = sanitizeAgentId(input?.id || input?.name);
  if (!validateAgentId(id)) {
    throw new Error('Invalid agent id');
  }
  const existingIndex = agents.findIndex((agent) => agent.id === id);
  const existing = existingIndex >= 0 ? agents[existingIndex] : null;
  const next = normalizeAgentConfig({ ...input, id }, existing);
  if (existingIndex >= 0) {
    agents[existingIndex] = next;
  } else {
    agents.push(next);
  }
  await writeAgents(agents);
  return next;
}

export async function patchAgentConfig(agentId, input) {
  const agents = await readAgentsRaw();
  const id = sanitizeAgentId(agentId);
  const existingIndex = agents.findIndex((agent) => agent.id === id);
  if (existingIndex < 0) {
    return null;
  }
  const existing = agents[existingIndex];
  const next = normalizeAgentConfig(mergeNestedAgentPatch(existing, input), existing);
  agents[existingIndex] = next;
  await writeAgents(agents);
  return next;
}

export async function deleteAgentConfig(agentId) {
  const agents = await readAgentsRaw();
  const id = sanitizeAgentId(agentId);
  const existingIndex = agents.findIndex((agent) => agent.id === id);
  if (existingIndex < 0) {
    return null;
  }
  const [removed] = agents.splice(existingIndex, 1);
  await writeAgents(agents);
  return removed;
}

export async function buildAgentSystemPrompt(agent, options = {}) {
  const lines = [
    `You are running with the selected MTL-Code Agent profile: ${agent.name} (${agent.id}).`,
    '',
    'Agent responsibility:',
    agent.description,
    '',
    'Agent instructions:',
    agent.systemPrompt,
  ];

  const skillsPrompt = await buildSkillReferencePrompt(agent.skills, options);
  if (skillsPrompt) {
    lines.push('', skillsPrompt);
  }

  if (agent.appBindings.length > 0) {
    lines.push(
      '',
      'Configured applications:',
      ...agent.appBindings.map((binding) => `- ${binding.slot}: ${binding.app} (${binding.status})`),
      'Use configured applications only when the matching connector, MCP server, or tool is actually available. If it is not available, ask the user before substituting another application.',
    );
  }

  if (agent.knowledgeSources.length > 0) {
    lines.push(
      '',
      'Configured knowledge sources:',
      ...agent.knowledgeSources.map((source) => `- ${source.name} (${source.type}, ${source.status}, ${source.chunkCount || 0} chunks)`),
      'Only rely on knowledge sources when their content is actually available through the retrieval/indexing layer.',
    );
  }

  const knowledgePrompt = await buildAgentKnowledgePrompt(agent, options.query || '');
  if (knowledgePrompt) {
    lines.push('', knowledgePrompt);
  }

  if (agent.memory?.enabled) {
    lines.push(
      '',
      `Agent memory namespace: ${agent.memory.namespace}`,
      `Memory privacy: ${agent.memory.privacy}`,
      agent.memory.description,
    );
  }

  if (agent.guardrails.length > 0) {
    lines.push('', 'Agent guardrails:', ...agent.guardrails.map((guardrail) => `- ${guardrail}`));
  }

  lines.push(
    '',
    'Preserve the default MTL-Code coding, safety, workspace, and tool-use behavior. This Agent profile narrows intent and context; it does not grant extra permissions by itself.',
  );

  return lines.filter((line) => line !== undefined && line !== null).join('\n');
}

export async function buildSkillReferencePrompt(skillNames = [], options = {}) {
  const normalizedSkillNames = normalizeStringArray(skillNames, 60, 120);
  if (normalizedSkillNames.length === 0) {
    return '';
  }

  let installedSkills = [];
  try {
    const registry = await listInstalledSkills({ workspacePath: options.workspacePath || '' });
    installedSkills = Array.isArray(registry.skills) ? registry.skills : [];
  } catch {
    installedSkills = [];
  }

  const lines = [
    'Preferred skills for this conversation:',
    ...normalizedSkillNames.map((skillName) => {
      const installed = installedSkills.find((skill) => (
        skill.name.toLowerCase() === String(skillName).toLowerCase()
        || skill.title.toLowerCase() === String(skillName).toLowerCase()
      ));
      return installed
        ? `- ${skillName} (installed, ${installed.provider}/${installed.scope}, ${installed.skillPath})`
        : `- ${skillName} (not installed; do not rely on this Skill until the user installs it)`;
    }),
    'When a preferred Skill is installed, read and follow its SKILL.md instructions before applying that specialized workflow. These Skills narrow the workflow for this conversation and do not grant extra permissions by themselves.',
  ];

  return lines.join('\n');
}

function applyRuntimeAgentConfiguration(agent, configuration = {}) {
  const appBindings = normalizeAppBindings(configuration?.appBindings);
  const skills = normalizeStringArray(configuration?.skills, 60, 120);
  if (appBindings.length === 0 && skills.length === 0) {
    return agent;
  }
  return {
    ...agent,
    appBindings: appBindings.length > 0 ? appBindings : agent.appBindings,
    skills: skills.length > 0 ? Array.from(new Set([...agent.skills, ...skills])) : agent.skills,
  };
}

export async function resolveAgentRuntime(agentId, options = {}) {
  if (!agentId) return null;
  const agent = await getAgentConfig(agentId);
  if (!agent || agent.status !== 'enabled') {
    return null;
  }
  const runtimeAgent = applyRuntimeAgentConfiguration(agent, options.sessionConfiguration || options.configuration);

  const runtimeSettings = await readMtlCodeRuntimeSettings();
  const model = runtimeSettings.model || undefined;

  return {
    agent: runtimeAgent,
    appendSystemPrompt: await buildAgentSystemPrompt(runtimeAgent, options),
    model,
    contextWindowTokens: runtimeSettings.contextWindowTokens,
  };
}

export function findAgentMention(input, agents) {
  const text = typeof input === 'string' ? input.trimStart() : '';
  if (!text.startsWith('@')) {
    return { agentId: null, content: input };
  }

  const match = text.match(/^@([^\s]+)\s*/);
  if (!match) {
    return { agentId: null, content: input };
  }

  const token = match[1].trim().toLowerCase();
  const agent = agents.find((entry) => (
    entry.id.toLowerCase() === token
    || entry.name.toLowerCase() === token
    || entry.shortName.toLowerCase() === token
  ));

  if (!agent || agent.status !== 'enabled') {
    return { agentId: null, content: input };
  }

  return {
    agentId: agent.id,
    content: text.slice(match[0].length),
  };
}
