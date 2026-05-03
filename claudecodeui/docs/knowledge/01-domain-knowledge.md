# K1 领域知识

Argus 是一个 local-first 的 coding agent 工作台。当前产品默认只面向 Argus：用户看到的模型、Agent、会话和运行时都应写作 Argus。代码中仍保留 `claude` provider key 作为兼容层，用来复用既有 WebSocket、session、MCP、permission 和 normalized message 契约。

历史 Provider（Cursor、Codex、Gemini，以及旧 Claude Code 命名）仍可能存在于类型、后端 adapter 或旧路由中，但它们在当前 first-use 产品里属于 legacy / hidden / compatibility surface。除非有明确产品决策，不应把这些 Provider 重新暴露到侧边栏、模型选择、设置页或新会话入口。

## 核心术语

| 术语 | 含义 | 当前代码锚点 |
| --- | --- | --- |
| Provider | 运行时后端。当前可见 Provider 是 Argus；内部仍使用 `claude` 作为兼容 key。`cursor`、`codex`、`gemini` 是 legacy hidden adapters。 | `src/types/app.ts`，`server/shared/types.ts`，`server/modules/providers` |
| Project | 侧边栏展示的工作区项目，包含名称、展示名、路径和 Argus 会话。 | `src/types/app.ts`，`server/projects.js`，`server/index.js` |
| Session | 绑定到 Project 或独立 conversation 的一次 Argus 对话。会话历史优先来自 `~/.mtl-code/projects`，必要时读取 `~/.claude/projects` 作为 legacy fallback。 | `server/projects.js`，`server/modules/providers/list/claude/claude-sessions.provider.ts` |
| NormalizedMessage | REST 历史和实时事件共同使用的消息形状。名称保持 provider-neutral，但当前产品语义是 Argus runtime events。 | `server/shared/types.ts`，`src/stores/useSessionStore.ts` |
| MCP server | 按 `claude` compatibility provider 和 scope 管理的工具服务配置，scope 包括 `user`、`local`、`project`。 | `server/modules/providers/*mcp*`，`src/components/mcp` |
| Tool permission | 工具调用审批/拒绝流程，当前服务 Argus 的 `claude-command` compatibility path。 | `server/claude-sdk.js`，`src/components/chat/tools` |
| Workspace | 文件操作、Shell、项目创建和可选 legacy Git route 使用的文件系统根路径。 | `server/routes/projects.js`，`server/index.js` |
| Plugin | 可选 tab 和可选后端服务，可从 `plugins/` 或安装仓库加载。 | `src/contexts/PluginsContext.tsx`，`server/routes/plugins.js`，`server/utils/plugin-*` |
| TaskMaster | legacy optional 任务规划与 PRD 流程。当前 first-use UI 隐藏，保留后端/文档只为兼容或以后重新引入。 | `src/components/task-master`，`src/components/prd-editor`，`server/routes/taskmaster.js` |
| Local identity | 本地 first-use 账号/凭据/通知偏好。当前安装包默认走 local user；显式登录 UI 属于 legacy/auth compatibility surface。 | `server/database/schema.js`，`server/routes/auth.js`，`server/routes/settings.js`，`server/routes/user.js` |

## 领域边界

| 领域 | 负责 | 不负责 |
| --- | --- | --- |
| Provider Integration | Argus 认证/配置、MCP 配置、原生会话历史、消息标准化、命令执行；legacy Provider adapter 只在兼容边界内维护。 | 通用 UI 布局或 App 账户存储。 |
| Project Discovery | 从 Argus 存储发现项目/会话、自定义会话名、会话搜索；可忽略 legacy Provider session arrays。 | 聊天消息渲染。 |
| Conversation Runtime | 聊天输入、`claude-command` compatibility 派发、Argus 流式事件、工具结果渲染、会话活跃状态。 | 文件树操作或 Git 实现。 |
| Workspace Tools | 文件树、代码编辑器、上传、Shell PTY；Git route 为 legacy optional，不是 first-use UI 默认能力。 | Provider 认证和 MCP 规则。 |
| Identity And Settings | 本地用户、API key、凭据、外观、通知、Argus model/runtime 设置。 | Argus 原生会话历史。 |
| Extensibility | 插件发现、manifest 读取、后端插件进程生命周期、插件 tab 渲染。 | 核心 Provider 命令协议。 |
| Task Planning | legacy optional TaskMaster 安装/状态、任务、PRD 文档、PRD 模板、任务生成。 | 通用聊天持久化。 |

## 领域规则

- 当前产品默认是 Argus-only。新增 UI 或设置项时，默认不要重新暴露 Cursor、Codex、Gemini 或旧 Claude Code 品牌。
- `claude` provider key 是兼容 key，不是用户可见品牌。用户可见文案、图标、诊断和安装包都应使用 Argus。
- Legacy Provider 代码可以保留，但只能作为 hidden compatibility surface 维护；若要重新启用，必须同步更新 K1-K5、模型 UI、sidebar、settings、provider auth、session discovery 和 smoke checklist。
- Argus 原生历史是对话历史的稳定来源。App DB 保存 App 自己拥有的数据，例如本地用户、API key、凭据、通知、VAPID key、自定义会话名和 lightweight session metadata。
- `NormalizedMessage` 是聊天展示的统一语言。Argus/legacy Provider 的原生事件进入渲染层前要先标准化。
- Self-hosted 模式优先读写 `~/.mtl-code`；`~/.claude` 只作为 legacy fallback。不要把 `~/.codex`、`~/.cursor`、`~/.gemini` 的内容重新合并进 first-use conversation UI。
- Workspace 操作必须限制在校验后的 workspace/project 路径内，避开系统关键目录。
- Plugin 可以扩展 UI 和后端服务，但不应该暗中接管核心 Provider 行为。
- TaskMaster、Git UI、community、About、multi-provider model picker 都属于 first-use 隐藏面；除非明确恢复，不应出现在默认产品路径。

## 命名约定

新增文件和函数优先使用领域名。用 `providerAuthService`、`McpServers`、`GitPanel`、`useSessionStore` 这类名字，避免 `helpers`、`common`、`misc` 这种无法表达归属的名字。
