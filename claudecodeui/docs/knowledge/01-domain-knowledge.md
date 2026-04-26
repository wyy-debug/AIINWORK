# K1 领域知识

CloudCLI UI 是一个面向本地或远程 coding agent 的浏览器 UI。它把 Claude Code、Cursor CLI、Codex、Gemini CLI 包装成统一的项目、会话、聊天、文件、Git、Shell、MCP、插件和 TaskMaster 工作台。

## 核心术语

| 术语 | 含义 | 当前代码锚点 |
| --- | --- | --- |
| Provider | 一个受支持的 agent 后端：`claude`、`cursor`、`codex`、`gemini`。 | `src/types/app.ts`，`server/shared/types.ts`，`server/modules/providers` |
| Project | 侧边栏展示的工作区项目，包含名称、展示名、路径、会话和可选 TaskMaster 信息。 | `src/types/app.ts`，`server/projects.js`，`server/index.js` |
| Session | 绑定到 Project 的一次 Provider 对话。不同 Provider 用各自原生位置保存历史。 | `server/projects.js`，`server/modules/providers/list/*/*-sessions.provider.ts` |
| NormalizedMessage | REST 历史和实时事件共同使用的 Provider 中立消息形状。 | `server/shared/types.ts`，`src/stores/useSessionStore.ts` |
| MCP server | 按 Provider 和 scope 管理的工具服务配置，scope 包括 `user`、`local`、`project`。 | `server/modules/providers/*mcp*`，`src/components/mcp` |
| Tool permission | 工具调用审批/拒绝流程，当前主要服务 Claude SDK 工具调用。 | `server/claude-sdk.js`，`src/components/chat/tools` |
| Workspace | 文件操作、Shell、Git、项目创建使用的文件系统根路径。 | `server/routes/projects.js`，`server/index.js` |
| Plugin | 可选 tab 和可选后端服务，可从 `plugins/` 或安装仓库加载。 | `src/contexts/PluginsContext.tsx`，`server/routes/plugins.js`，`server/utils/plugin-*` |
| TaskMaster | 可选任务规划与 PRD 流程。 | `src/components/task-master`，`src/components/prd-editor`，`server/routes/taskmaster.js` |
| App account | 本地 UI 登录、API key、凭据、onboarding、通知偏好。 | `server/database/schema.js`，`server/routes/auth.js`，`server/routes/settings.js`，`server/routes/user.js` |

## 领域边界

| 领域 | 负责 | 不负责 |
| --- | --- | --- |
| Provider Integration | Provider 认证、MCP 配置、原生会话历史、消息标准化、命令执行。 | 通用 UI 布局或 App 账户存储。 |
| Project Discovery | 从 Provider 存储聚合项目/会话、自定义会话名、会话搜索。 | 聊天消息渲染。 |
| Conversation Runtime | 聊天输入、Provider 命令派发、流式事件、工具结果渲染、会话活跃状态。 | 文件树操作或 Git 实现。 |
| Workspace Tools | 文件树、代码编辑器、上传、Shell PTY、Git 状态/diff/commit/branch/pull/push。 | Provider 认证和 MCP 规则。 |
| Identity And Settings | 登录、JWT/API key、凭据、onboarding、外观、通知。 | Provider 原生会话历史。 |
| Extensibility | 插件发现、manifest 读取、后端插件进程生命周期、插件 tab 渲染。 | 核心 Provider 命令协议。 |
| Task Planning | TaskMaster 安装/状态、任务、PRD 文档、PRD 模板、任务生成。 | 通用聊天持久化。 |

## 领域规则

- Provider 是一等对象。跨 Provider 能力应优先使用 `LLMProvider` 和 Provider 中立契约，而不是只写 Claude 特例。
- Provider 原生历史是对话历史的稳定来源。App DB 保存 App 自己拥有的数据，例如用户、API key、凭据、通知、VAPID key、自定义会话名。
- `NormalizedMessage` 是聊天展示的统一语言。Provider 的 SDK/CLI 原生事件进入渲染层前要先标准化。
- Self-hosted 模式会读写本机 Provider 配置，例如 `~/.claude`、`~/.codex`、`~/.cursor`、`~/.gemini`。
- Workspace 操作必须限制在校验后的 workspace/project 路径内，避开系统关键目录。
- Plugin 可以扩展 UI 和后端服务，但不应该暗中接管核心 Provider 行为。
- TaskMaster 是可选能力。UI 必须能处理它被关闭、未安装或未准备好的状态。

## 命名约定

新增文件和函数优先使用领域名。用 `providerAuthService`、`McpServers`、`GitPanel`、`useSessionStore` 这类名字，避免 `helpers`、`common`、`misc` 这种无法表达归属的名字。
