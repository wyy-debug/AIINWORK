# K4 运行时流程

## App 启动与 Project 同步

```mermaid
sequenceDiagram
  participant Browser
  participant App as React App
  participant API as Express /api
  participant WS as WebSocket /ws
  participant Providers as Provider session folders

  Browser->>App: load app
  App->>API: auth status / user
  App->>WS: connect with token
  App->>API: GET /api/projects
  API->>Providers: scan native project/session stores
  Providers-->>API: projects and sessions
  API-->>App: project list
  API->>Providers: watch folders with chokidar
  Providers-->>API: file changes
  API-->>WS: projects_updated / loading_progress
  WS-->>App: refresh sidebar/session metadata
```

关键文件：

- `src/components/app/AppContent.tsx`
- `src/hooks/useProjectsState.ts`
- `src/contexts/WebSocketContext.tsx`
- `server/index.js`
- `server/projects.js`

## 打开 Session

1. 用户在 sidebar 选择 session。
2. `useProjectsState` 保存 `selectedProject` 和 `selectedSession`，并跳转到 `/session/:sessionId`。
3. `MainContent` 在 `chat` tab 渲染 `ChatInterface`。
4. `useSessionStore` 从 `/api/sessions/:sessionId/messages` 拉取持久化消息。
5. `server/routes/messages.js` 调用选中 Provider 的 session adapter。
6. Provider 历史被转换为 `NormalizedMessage[]`。
7. 前端合并 server messages 和 realtime messages 后渲染。

关键不变量：server history 是稳定来源，realtime messages 是飞行中的覆盖层。

## 发送 Agent 消息

```mermaid
sequenceDiagram
  participant Chat as ChatInterface
  participant WS as /ws
  participant Server as server/index.js
  participant Runtime as Provider runtime
  participant Store as useSessionStore

  Chat->>WS: provider command message
  WS->>Server: claude-command / cursor-command / codex-command / gemini-command
  Server->>Runtime: query or spawn provider
  Runtime-->>Server: native SDK/CLI events
  Server-->>WS: NormalizedMessage events
  WS-->>Chat: latestMessage
  Chat->>Store: append/update realtime messages
  Store-->>Chat: merged render state
```

`server/index.js` 当前处理的 Provider command message type：

- `claude-command`
- `cursor-command`
- `codex-command`
- `gemini-command`
- `abort-session`
- `check-session-status`
- `get-pending-permissions`
- `get-active-sessions`
- `claude-permission-response`

New-session UI invariant:

1. `useChatComposerState` creates a `new-session-*` display session before the backend has a real CLI session id.
2. The temporary id is only for frontend rendering; provider command payloads must not pass it as `options.sessionId` or `resume`.
3. `useChatRealtimeHandlers` routes early errors/stream events to the temporary id via `pendingViewSessionRef`.
4. When `session_created` arrives, `useSessionStore.replaceSessionId()` moves buffered messages from the temporary id to the real session id.
5. This keeps the first user message visible even when the backend is still starting or fails before emitting a native session id.

## Tool Permission 流程

1. Claude SDK 发出 permission request。
2. 后端通过 `/ws` 发送 normalized permission event。
3. Chat UI 渲染 permission request。
4. 用户允许或拒绝。
5. UI 携带 `requestId` 发送 `claude-permission-response`。
6. `server/claude-sdk.js` 解析 pending approval，然后继续或阻止工具调用。

除非产品明确要求“记住权限”，一次性 approval 不应被持久化。

## Workspace 文件流程

1. File tree 请求 `/api/projects/:projectName/files`。
2. 读取/编辑使用 `/api/projects/:projectName/file` 或 `/files/content`。
3. create/rename/delete/upload endpoint 会把目标路径校验在选中 project root 内。
4. Code editor 更新打开文档，并通过 `src/utils/api.js` 保存。

安全规则：所有文件操作都必须在读写前 resolve 并 validate path。

## Git 流程

1. `GitPanel` 调用 `/api/git/*` endpoints。
2. `server/routes/git.js` 解析 project context 并执行 Git 命令。
3. UI 渲染 status、diff、branch、commit history、remote state。
4. commit 和 remote 操作返回结构化状态或错误给 panel。

Git 改动影响 workspace，不影响 Provider 原生 session history。

## Shell 流程

1. Shell UI 打开 `/shell` WebSocket。
2. UI 发送 `init`，包含 project path、session id、provider 和可选 initial command。
3. 后端按 project/session/command 生成 key，创建或复用 PTY session。
4. PTY output 流式返回给 xterm。
5. login/auth command 会使用新 PTY session，不复用缓存 session。

关键文件：

- `src/components/shell`
- `src/components/standalone-shell`
- `server/index.js` 的 `handleShellConnection`

## MCP 管理流程

1. MCP UI 调用 `/api/providers/:provider/mcp/servers`。
2. `provider.routes.ts` 解析 provider、scope、transport payload。
3. `providerMcpService` 通过 registry 找到 Provider。
4. Provider-specific MCP adapter 读写原生 Provider config。
5. UI 按 scope 刷新 grouped server list。

Global add 走 `/api/providers/mcp/servers/global`，对支持的 scope 应用到所有 Provider。

Agent Builder 的“浏览应用 > 自定义 MCP”复用同一套 Provider MCP API：

1. 弹窗读取 `GET /api/providers/claude/mcp/servers?scope=user`，并在存在项目路径时追加读取 `scope=project&workspacePath=<path>`。
2. 新增或更新 MCP Server 调用 `POST /api/providers/claude/mcp/servers`，支持 `stdio`、`http`、`sse`。
3. `scope=user` 写入用户全局 Provider MCP config；`scope=project` 写入对应 workspace 的项目 MCP config。
4. 保存成功后，Agent config 增加 `appBindings` 项，格式为 `MCP: <serverName>`，槽位为 `高级工具` 或 `高级工具 / <projectName>`。
5. 当前绑定用于 Agent prompt 和配置可视化；实际 MCP 可用性来自 Provider 原生 MCP config，不是前端 mock。

Implemented app catalog invariant:

1. Agent Builder should only list app integrations that have a working runtime path.
2. Current app catalog lists `自定义 MCP` only.
3. Google, Slack, Notion, GitHub, Teams, SharePoint, Outlook, and demo apps stay hidden until their connector/runtime support is implemented.

MCP closure updates:

1. Agent Builder can inspect a configured MCP server with `GET /api/providers/:provider/mcp/servers/:name/inspect?scope=user|project&workspacePath=...`.
2. Stdio inspection checks whether the command is discoverable as an absolute path, relative path, or PATH executable. HTTP/SSE inspection performs a lightweight connectivity request with a short timeout.
3. The inspect endpoint intentionally reports provider-level availability only. Tool enumeration still belongs to the native provider runtime after the MCP server is started.
4. Agent Builder can unbind an MCP entry from the Agent without deleting the provider config, or delete the provider MCP server with `DELETE /api/providers/:provider/mcp/servers/:name`.
5. The MCP app binding remains a reference (`MCP: <serverName>`). Runtime execution is still provided by the provider's native MCP config.

MCP diagnostics updates:

1. Repository MCP cards can call `GET /api/providers/:provider/mcp/servers/:name/diagnose?scope=user|project&workspacePath=...`.
2. Diagnostics checks whether the package directory exists, npm dependencies are present, provider config was written, required setup fields are configured, and the stdio command can launch.
3. Password/token fields are reported only as `configured` or `missing`; secret values are never returned.
4. Manifest-declared tools are shown as a hint, but live tool discovery still belongs to the MTL-Code runtime after the conversation starts.

## Plugin 流程

1. `PluginsProvider` 加载 `/api/plugins`。
2. Plugin route 读取 manifests 和 enabled state。
3. 启用插件可能通过 `plugin-process-manager` 启动后端服务。
4. Plugin tab 通过 `PluginTabContent` 渲染。
5. Plugin WebSocket 可通过 `/plugin-ws/*` 代理。

插件错误应该显示在插件设置中，不应拖垮核心 app shell。

## Agent Template / Skill Repository Flow

1. Settings > Agents > Repository loads `GET /api/agent-repository/catalog`.
2. `server/routes/agent-repository.js` merges the local writable repository with enabled external HTTP(S) catalogs.
3. Upload writes agent templates, `SKILL.md` content, or complete Skill package folders into `~/.mtl-code-ui/agent-repository/local` and updates the local `catalog.json`.
4. Install pulls item content and writes agent templates to `~/.mtl-code/agents/<name>.md` or project `.claude/agents/<name>.md`; skills go to `~/.mtl-code/skills/<name>/` or project `.claude/skills/<name>/`, preserving package files when the catalog provides `packageFiles`.
5. Likes are stored in the local repository catalog for local items. Remote items can provide `likeUrl`; otherwise the UI backend stores a local like overlay.
6. Agent templates can include `supportedApps`, `appSlots`, and `capabilities`; the Repository UI renders these as a template gallery and setup dialog before installing.
7. Setup selections are sent as `configuration.appBindings`; the backend appends them to the installed Agent markdown as prompt-visible application context.
8. Installing an Agent template through the guided setup also creates or updates a runtime Agent config through `POST /api/agents`, using the installed markdown as the Agent system prompt.
9. Skills install as single files or full package directories. They are not auto-bound to an Agent until the user selects or references them in Agent configuration.
10. Agent Builder loads real installed Skills through `GET /api/agents/skills/installed`, scanning user and project skill roots for `SKILL.md`.
11. Skill discovery roots include `~/.mtl-code/skills`, `~/.claude/skills`, `~/.codex/skills`, and matching project-local `.mtl-code/.claude/.codex/skills` folders when a workspace path is available.
12. Bound Agent skills are marked as callable only when the Skill registry can find a matching installed package. Missing skills remain visible but show as not installed.

## Remote Agent Repository Server Flow

1. Remote repository serving is no longer embedded in MTL-Code UI. It lives in the standalone `agent-skill-hub` project.
2. MTL-Code UI acts as a client: users add `https://host/agent-repository/catalog.json` as a Repository source.
3. Public submissions call the Hub's `POST /agent-repository/submit` endpoint and are stored under the Hub data directory.
4. Admin review APIs live on the Hub under `/api/admin/*`; MTL-Code UI no longer mounts `/api/agent-repository-server`.
5. Published items appear in `GET /agent-repository/catalog.json` with relative `contentUrl` and `likeUrl` values.
6. Remote likes call `POST /agent-repository/items/:itemId/like`, update global counters, and are reflected in the next catalog sync.
7. Published Agent templates preserve ChatGPT-style metadata (`icon`, `supportedApps`, `appSlots`, `capabilities`) so downstream clients can render a guided creation flow.
8. Settings > Agents > Repository shows the standalone Hub catalog URL convention and keeps catalog consumption/install flows.
9. Hub administration is done in the standalone Hub web UI, not inside the desktop UI.

## Agent Runtime Invocation Flow

1. Agent runtime configs are persisted by `server/services/agent-config-service.js` in `~/.mtl-code-ui/agents/agents.json`.
2. The main Agent config page is a template/config management surface, not a workspace-start screen. It loads and edits configs through authenticated `/api/agents` endpoints, including model, context window, prompt, skills, tools, app bindings, guardrails, and trigger keywords.
3. Project chat never loads or displays Agent selection. It sends commands with `allowSessionAgentBinding: false`, so project sessions use the default MTL-Code runtime even if a stale binding row exists.
4. Standalone conversation chat loads enabled agents and binds selection to a single conversation, not to the workspace. Persisted conversation bindings use authenticated backend APIs:
   - `GET /api/sessions/:sessionId/agent?provider=claude`
   - `PUT /api/sessions/:sessionId/agent`
   - `DELETE /api/sessions/:sessionId/agent?provider=claude`
5. New standalone conversations show a yes/no choice for whether to use an Agent. Choosing no keeps the default MTL-Code conversation. Choosing yes asks for the Agent and, if needed, slot setup.
6. If the selected Agent declares application slots, the composer opens a setup dialog and requires slot-to-app selections before binding the Agent to the conversation.
7. Per-conversation Agent slot selections are stored as `session_agent_bindings.config_json`. New installs create the column with the table; existing installs add it during DB migration.
8. A leading `@agent` mention can match `id`, `name`, or `shortName` and overrides the conversation Agent for that one message only.
9. Frontend sends the resolved agent as `options.agentId`, resolved slot config as `options.agentAppBindings`, and the guard flag `options.allowSessionAgentBinding` in the existing WebSocket command payload. This keeps the provider command shape stable while making slots backend-visible.
10. `server/index.js` resolves the agent at send time. If a concrete session ID is available and the frontend did not send `options.agentId`, the backend falls back to the persisted session binding only when `allowSessionAgentBinding === true`. If fresh `options.agentAppBindings` are not sent, it falls back to the persisted `config_json`. Disabled, draft, or missing agents are ignored.
11. `server/services/agent-config-service.js` applies session slot configuration before building the Agent prompt, so the prompt reflects the per-conversation app choices rather than only the reusable Agent template defaults.
12. Agent knowledge sources are resolved through `server/services/agent-rag-service.js`. Indexed uploaded-file chunks are scored against the current user command and appended to the Agent prompt as RAG excerpts.
13. Agent skills are resolved through `server/services/agent-skill-service.js` at runtime. Installed skills include provider/scope/path details in the Agent prompt; missing skills are explicitly marked as unavailable.
14. For MTL-Code (`claude-command` compatibility path), the backend passes the agent profile through `--append-system-prompt`, preserving the default coding/safety prompt while adding the selected Agent role, skills, application bindings, RAG excerpts, memory metadata, and guardrails.
15. Agent `modelConfig.contextWindowTokens` is forwarded as `options.contextWindowTokens`; `server/claude-sdk.js` writes it into `MTL_CODE_MAX_CONTEXT_TOKENS` and `CONTEXT_WINDOW` for the spawned MTL-Code child. This is a real backend runtime override, not a GUI-only value.
16. Agent `modelConfig.model` overrides the MTL-Code model only when it is not `inherit`. Non-MTL providers receive the Agent prompt in-band but do not inherit the MTL-Code model override.
17. Agent MCP app bindings do not create a separate runtime transport. They reference MCP servers already persisted through Provider MCP config, so the spawned MTL-Code provider discovers them through its native config files.

Agent quick start:

1. Sidebar conversation mode uses the normal new-conversation button. There is no separate quick Agent selector in the sidebar.
2. Creating a new standalone conversation clears the selected project session and opens a blank chat.
3. The blank chat asks whether to use an Agent. If yes, the user selects the Agent and completes required slot setup before the Agent is considered active.
4. The empty conversation surface shows the selected Agent only after setup is complete.
5. The first sent Agent-backed message includes `options.agentId`, `options.agentAppBindings`, and `allowSessionAgentBinding: true`; after the real session ID is created, the session-agent binding flow persists both values for later reloads.

Project/conversation separation:

1. Project sessions and standalone conversations are independent sidebar modes.
2. `useProjectsState` clears `selectedConversationSession` when project mode or a project session is selected.

2026-04-28 implementation note:

1. Project chat uses the default MTL-Code runtime path. It does not load Agent lists or render Agent selectors in the composer. It can still show installed Skills; when a project session selects Skills, the UI persists an empty-Agent session binding with `configuration.skills` so later messages in that same session keep the Skill context.
2. Standalone conversation chat owns Agent and Skill binding. It loads enabled Agents, installed Skills, persisted session binding, and sends `allowSessionAgentBinding: true`.
3. Agent setup dialogs resolve MCP slots from real provider MCP configuration by reading user-scoped MCP servers and, when a workspace path is available, project-scoped MCP servers.
4. Placeholder app values such as `Custom MCP` or `自定义 MCP` are not valid final slot selections. A user must choose a concrete `MCP: <serverName>` entry before enabling the Agent for the conversation.
5. The composer shows a runtime binding strip for standalone conversations. It lists the active Agent, selected `MCP: <serverName>` bindings, and selected Skills with callable/missing status.
6. The composer shows selected Skills in project sessions too, but never exposes an Agent selector there.
7. The backend emits `agent_runtime_debug` status events and console logs whenever an Agent or session Skill prompt is applied. The payload includes Agent identity, app/MCP bindings, session/effective Skills, prompt length, model, context window, project path, session id, and the permission snapshot.
8. The chat UI intentionally keeps `agent_runtime_debug` out of the message list and visible run status. It is exposed only through the composer diagnostics panel.
9. Switching to conversation mode clears `selectedSession` so project-backed sessions do not remain active behind the standalone conversation list.
10. Switching between project and conversation modes navigates back to `/` and ignores the previous `/session/:id` route once, preventing the route synchronization effect from immediately pulling the UI back into the old project session.
11. `MainContent` keys `ChatInterface` by mode, project, and session ID so stale local state does not leak when switching modes.

## Worktree Dispatch Management

1. Parent projects can create managed worktrees through `POST /api/projects/:projectName/worktrees`.
2. Managed worktrees are created with `git worktree add --detach`, registered as separate projects, and optionally linked to a session.
3. Parent projects can list their tasks through `GET /api/projects/:projectName/worktrees`.
4. The Worktree task list shows status, task title, base ref/commit, branch state, session binding, path, and creation time.
5. Users can continue opening a worktree project, enter its bound session, create a branch, or delete/archived a clean managed worktree.
6. Dirty worktrees are protected by the existing backend `git status --porcelain` deletion check.

## Session Management Metadata

1. Session rename still writes to `session_names.custom_name`.
2. `PATCH /api/sessions/:sessionId/metadata` updates lightweight UI metadata such as pinned and archived state.
3. Session lists receive `isPinned`, `pinnedAt`, `isArchived`, and `archivedAt` through `applyCustomSessionNames`.
4. Pinned sessions sort first, archived sessions sort last and remain visible with a dimmed style so recovery stays obvious.

Channel status:

1. The Agent Builder channel cards are currently configuration placeholders only.
2. DingTalk, Slack, webhook, and other external channel runtimes are intentionally deferred until the Agent/MCP/RAG/repository loop is stable.

Agent management APIs:

1. `GET /api/agents?includePaused=true|false` lists Agent configs.
2. `GET /api/agents/:agentId` reads one Agent config.
3. `GET /api/agents/skills/installed?workspacePath=...` lists installed Skill packages and their callable status.
4. `POST /api/agents` creates or upserts an Agent.
5. `PUT /api/agents/:agentId` and `PATCH /api/agents/:agentId` update an Agent.
6. `DELETE /api/agents/:agentId` deletes the Agent, removes its uploaded knowledge directory, and clears session bindings for that Agent.

## MTLCode Anthropic-Compatible Model Config Flow

1. User opens Settings > Agents; the only visible agent is `MTLCode`, while the internal provider key remains `claude`.
2. The Model tab calls `GET /api/settings/mtl-code-model`.
3. `server/routes/settings.js` reads `~/.mtl-code/settings.json`, with a legacy read-only fallback to `~/.claude/settings.json`.
4. The UI saves changes with `PUT /api/settings/mtl-code-model`.
5. The route writes `modelType: "anthropic"`, `model`, `env.ANTHROPIC_AUTH_TOKEN`, `env.ANTHROPIC_BASE_URL`, `env.ANTHROPIC_MODEL`, and Anthropic default model aliases.
6. The route clears legacy `env.OPENAI_*` keys so new sessions cannot accidentally route through OpenAI Chat Completions.
7. New MTL-Code backend sessions load those settings and use the Anthropic Messages API request format.
8. Auth status reports `method: "anthropic_compatible"` when an Anthropic token is configured for a custom base URL.

Invariant: visible naming is MTLCode, but backend/session compatibility still uses the `claude` provider key until the full provider ID migration is completed.

New-chat invariant: `ProviderSelectionEmptyState.tsx` is not a provider/model picker. It shows one `MTL-Code / MTLCode` surface, and `useChatProviderState.ts` rewrites stale local storage values back to `selected-provider=claude` and `claude-model=mtlcode`.

DeepSeek Anthropic adapter invariant:

1. DeepSeek custom runtime config uses the Anthropic-compatible endpoint, typically `ANTHROPIC_BASE_URL=https://api.deepseek.com/anthropic`.
2. `server/claude-sdk.js` merges `~/.mtl-code/settings.json.env` into the spawned MTL-Code child process so model/base URL/token/effort settings are active even when the UI server itself was started without those env vars.
3. UI-spawned MTL-Code uses the `runtime.bareMode` setting from `/api/settings/mtl-code-model`; when enabled, `server/claude-sdk.js` adds `--bare` to avoid hooks, auto-memory, plugin sync, LSP startup, and CLAUDE.md auto-discovery unless context is explicitly provided.
4. When the endpoint or model is DeepSeek, the spawn env supplies both `MTL_CODE_EFFORT_LEVEL` and `CLAUDE_CODE_EFFORT_LEVEL` with a default of `high`, plus `MTL_CODE_SUBAGENT_MODEL` / `CLAUDE_CODE_SUBAGENT_MODEL` from the configured Haiku/small model.
5. The MTL-Code backend treats DeepSeek as Anthropic-compatible but suppresses Anthropic `thinking.budget_tokens`; DeepSeek thinking strength is controlled through `output_config.effort`.
6. Context window length is part of the same saved settings flow. The UI writes `runtime.contextWindowTokens`; `server/routes/settings.js` persists it as `MTL_CODE_MAX_CONTEXT_TOKENS` and `CONTEXT_WINDOW`; `server/claude-sdk.js` passes it to the spawned MTL-Code child process. DeepSeek 1M endpoints should be set explicitly to `1000000`; there is no provider-specific automatic context-window override.
7. A high `cache_read_input_tokens` number on a simple prompt is usually the coding-agent prompt/tool/project context being read from provider cache, not the literal user prompt size. `--bare` reduces avoidable auto-context, but agent tool schemas still cost context.

Project session discovery invariant:

1. Provider project folders live under `~/.mtl-code/projects/<encoded-project-name>` with `~/.claude/projects` as a legacy fallback.
2. `findProjectDir()` must return the concrete encoded project directory, not the parent `projects` root.
3. `getSessions()` reads JSONL files from that concrete directory and converts entries with `sessionId` into sidebar sessions.
4. A project showing chat messages in the main panel but `0` sidebar sessions usually means discovery is pointed at the wrong folder level or the native JSONL parser no longer matches the persisted message shape.

Context compaction visibility:

1. MTL-Code / Claude Code owns actual context compaction. The UI does not summarize chat history itself.
2. Claude JSONL `system` entries with `subtype=compact_boundary` or `subtype=microcompact_boundary` are normalized as `context_compaction` messages.
3. When a `compact_boundary` is followed by an `isCompactSummary` transcript-only user entry, `ClaudeSessionsProvider.fetchHistory()` attaches that summary to the same normalized compaction event and skips the synthetic user entry.
4. Realtime compaction events can still render without a summary first; if the runtime later streams an orphan compact summary, it renders as a separate summary card rather than a normal user message.
5. The chat message renderer displays a centered compaction boundary card with trigger, pre-compact tokens, saved tokens, affected tool count, and an expandable summary section when available.

## TaskMaster / PRD 流程

1. Task settings 决定 tasks tab 是否可见。
2. `TaskMasterPanel` 绑定当前选中的 project。
3. `server/routes/taskmaster.js` 处理 install/status/tasks/PRD/template 动作。
4. PRD editor 管理 PRD 文档，并可触发 task generation。

TaskMaster 必须保持可选；不可用或关闭时，主 tab 应回到 chat。
