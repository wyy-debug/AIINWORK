# K3 模块地图

## 顶层目录

| 路径 | 角色 |
| --- | --- |
| `src/` | React 前端应用。 |
| `server/` | Express 后端、WebSocket、Argus compatibility runtime、数据库、routes。 |
| `shared/` | 前后端构建都会用到的常量和 helper。 |
| `public/` | 静态资源、截图、service worker 资源。 |
| `plugins/` | 本地插件工作区。 |
| `docker/` | legacy 多 agent Docker sandbox。当前 first-use UI 不依赖它。 |
| `scripts/` | 安装、构建和维护脚本。 |
| `redirect-package/` | package redirect/support metadata。 |

## 前端模块归属

| 区域 | 主要路径 | 说明 |
| --- | --- | --- |
| App shell | `src/App.tsx`，`src/components/app`，`src/components/main-content` | Argus compatibility provider、选中 project/session、tabs、布局。 |
| Sidebar/projects | `src/components/sidebar`，`src/hooks/useProjectsState.ts` | 项目/会话列表、active tab、settings modal 状态；first-use 只显示 Argus sessions，legacy provider arrays 不进入可见列表。 |
| Chat | `src/components/chat`，`src/stores/useSessionStore.ts` | 输入框、实时处理、消息合并、工具渲染。 |
| Chat message normalization | `src/components/chat/hooks/useChatMessages.ts`, `server/modules/providers/list/claude/claude-sessions.provider.ts` | NormalizedMessage 到 UI ChatMessage 的转换；内部 `<task-notification>` 只供 coordinator/subagent 使用，不应渲染为用户消息。 |
| Subagent activity display | `src/components/chat/view/ChatInterface.tsx`, `src/components/chat/view/subcomponents/ChatComposer.tsx`, `src/components/chat/types/types.ts` | 从当前会话的 `Task` / `Agent` 容器聚合 subagent 总数、运行中、已结束和输出中状态，展示在输入框上方；不要把 `<task-notification>` 当作用户蓝色气泡。 |
| Chat tools | `src/components/chat/tools` | 工具渲染 registry 和内容/交互 renderer。 |
| Files/editor | `src/components/file-tree`，`src/components/code-editor` | 文件树、CodeMirror 编辑器、二进制/图片处理。 |
| Review/Git | `src/components/review`，`src/components/git-panel` | first-use UI exposes a focused Review panel for local changes, diff, stage, unstage, and discard. The broader legacy Git panel/branch/remote surfaces remain hidden until productized. |
| Shell | `src/components/shell`，`src/components/standalone-shell` | xterm runtime 和 `/shell` WebSocket。 |
| MCP | `src/components/mcp` | Argus/`claude` compatibility MCP server 的 list/create/update/remove UI。 |
| Auth | `src/components/auth` | legacy login/setup/protected route 和 auth context；desktop first-use 走 local user。 |
| Settings | `src/components/settings`，`src/components/quick-settings-panel`，`src/components/provider-auth` | first-use 只保留 Agents、appearance、Argus model/runtime config；Git/Auth/About/TaskMaster/community surface 保持隐藏。 |
| Plugins | `src/contexts/PluginsContext.tsx`，`src/components/plugins` | 插件列表、install/update/toggle、插件 tab 内容。 |
| Task planning | `src/components/task-master`，`src/components/prd-editor`，`src/contexts/TaskMasterContext.ts` | legacy/hidden TaskMaster panel、PRD 编辑、任务生成。 |
| Project creation | `src/components/project-creation-wizard` | workspace 创建主路径；GitHub token、clone/create 流程属于 legacy/hidden surface。 |
| Worktree dispatch | `src/components/sidebar/view/subcomponents/WorktreeDispatchModal.tsx`，`src/components/main-content/view/subcomponents/WorktreeProjectBadge.tsx` | 从项目会话派生 Git worktree、继承会话绑定、worktree 项目头部状态和分支/删除操作。 |
| Shared UI | `src/shared/view/ui` | 可复用 UI primitives。 |
| API/types | `src/utils/api.js`，`src/types/app.ts` | HTTP wrapper 和前端 app contracts。 |

## 后端模块归属

| 区域 | 主要路径 | 说明 |
| --- | --- | --- |
| Composition root | `server/index.js` | Express setup、WebSocket routing、历史 project/file endpoints、shell/chat dispatch。 |
| Auth middleware | `server/middleware/auth.js` | JWT/API key 校验和 WebSocket auth。 |
| App DB | `server/database/db.js`，`server/database/schema.js` | SQLite schema 和 persistence helpers。 |
| Provider contracts | `server/shared/interfaces.ts`，`server/shared/types.ts`，`server/shared/utils.ts` | 后端共享类型、错误、响应 helpers、normalized messages；保留 legacy provider enum 以兼容旧数据。 |
| Provider module | `server/modules/providers` | Provider registry、provider routes、auth/MCP/session contracts；当前可见产品只使用 Argus/`claude` compatibility provider。 |
| Argus runtime | `server/claude-sdk.js`，`server/modules/providers/list/claude` | Argus process spawning、permissions、auth/MCP/session adapters。文件名和 provider key 仍是 `claude` 兼容层；默认权限为 `acceptEdits`，并清理历史整类 `Bash/Edit/Write` deny，保证 Task/Agent worker 可以通过编辑工具落盘。 |
| Cursor runtime | `server/cursor-cli.js`，`server/modules/providers/list/cursor`，`server/routes/cursor.js` | legacy/hidden Cursor command spawning、auth/MCP/session adapters。 |
| Codex runtime | `server/openai-codex.js`，`server/modules/providers/list/codex`，`server/routes/codex.js` | legacy/hidden Codex SDK/session deletion/MCP/auth adapters。 |
| Gemini runtime | `server/gemini-cli.js`，`server/modules/providers/list/gemini`，`server/routes/gemini.js` | legacy/hidden Gemini CLI/session deletion/MCP/auth adapters。 |
| Projects/session discovery | `server/projects.js`，`server/index.js` 中的 project endpoints | 聚合 Argus projects/sessions、search、names、path extraction；legacy provider arrays 不应进入 first-use visible UI。 |
| Workspace creation | `server/routes/projects.js` | workspace 校验、GitHub clone/create 流程。 |
| Worktree dispatch | `server/routes/worktrees.js`，`server/database/db.js` | managed detached worktree 创建、元数据、session 关联、分支创建和 dirty 删除检查。 |
| Review/Git | `server/routes/git.js` | status/diff/stage/unstage/discard power the visible Review panel. Commit, branch, history, and remote routes remain compatibility/future surfaces. |
| File mutation guard | `server/services/file-mutation-service.js`，`server/index.js` | 文本保存统一使用 `baseHash` 冲突检测、同目录临时文件写入、rename 替换、写后 hash 校验，并把 create/update/rename/delete/upload 记录到 `file-mutations.jsonl`。 |
| Commands | `server/routes/commands.js` | command listing/execution 支持。 |
| Settings | `server/routes/settings.js`，`server/routes/user.js` | API keys、credentials、notifications、server env、Argus model/runtime config；user Git config 属于 legacy/hidden surface。 |
| Plugins | `server/routes/plugins.js`，`server/utils/plugin-loader.js`，`server/utils/plugin-process-manager.js` | 插件发现、install/update/remove、进程生命周期。 |
| TaskMaster | `server/routes/taskmaster.js`，`server/utils/taskmaster-websocket.js` | legacy/hidden TaskMaster install/status/tasks/PRD/template routes 和 websocket 支持。 |
| Notifications | `server/services/notification-orchestrator.js`，`server/services/vapid-keys.js` | Web Push key/subscription 和通知投递。 |
| Context budget | `server/services/context-budget-service.js`，`server/claude-sdk.js`，`server/projects.js`，`server/routes/messages.js` | 统一 Argus 实时 `modelUsage`、历史 JSONL 和 `/token-usage` 的 `ContextBudget` 口径；旧 `used/total` 字段只做兼容。 |
| Runtime diagnostics | `server/index.js`, `src/components/chat/hooks/useChatRealtimeHandlers.ts`, `src/components/chat/view/ChatInterface.tsx`, `src/components/chat/view/subcomponents/AgentRuntimeDiagnosticsPanel.tsx` | 后端在发送前 emit `agent_runtime_debug`，前端按 session 缓存并在临时 session id 替换为真实 id 时迁移，避免诊断面板显示空态。OpenMythos 自动派发需要先经过发送前预览/确认，确认状态随 command options 进入 diagnostics。 |
| OpenMythos dispatch preview | `server/routes/settings.js`, `server/claude-sdk.js`, `src/components/chat/hooks/useChatComposerState.ts` | `POST /api/settings/openmythos-dispatch-preview` 使用后端同一套 OpenMythos 规则预估 `dispatchPlan`；聊天发送前提示用户确认，未确认或预览失败时本轮通过 env 覆盖禁用自动派发。 |

## 2026-04-26 Argus Agent Model Config Anchors

| Area | Owner files | Notes |
| --- | --- | --- |
| Agent settings provider list | `src/components/settings/view/tabs/agents-settings/AgentsSettingsTab.tsx`, `AgentSelectorSection.tsx` | Only the internal `claude` provider key is visible, labelled as `Argus`. |
| Chat first screen model surface | `src/components/chat/view/subcomponents/ProviderSelectionEmptyState.tsx`, `src/components/chat/hooks/useChatProviderState.ts`, `shared/modelConstants.js` | New-chat UI shows one static `Argus` card and normalizes stale local model/provider values. |
| Argus direct runtime | `server/claude-sdk.js`, `scripts/package-preview-win.mjs`, `scripts/preview-launcher.mjs`, `package.json` | UI backend keeps the legacy `queryClaudeSDK` export but launches paired Argus directly through stream-json. Packaged preview sets `MTL_CODE_CLI_PATH` and `MTL_CODE_RESOURCES_DIR`, while `server/claude-sdk.js` falls back only through existing absolute-path candidates such as `mtl-code.exe` and bundled CLI entrypoints; the Anthropic Agent SDK must not be an app dependency. |
| Project cwd repair | `server/projects.js`, `server/claude-sdk.js` | Project discovery repairs Windows provider project names decoded into paths like `C//Users/.../new/web/app`; chat runtime validates the cwd before spawning Argus so missing directories are not mistaken for missing executables. |
| Agent model config UI | `src/components/settings/view/tabs/agents-settings/sections/content/ModelConfigContent.tsx` | Reads and saves `/api/settings/mtl-code-model`. |
| Model config API | `server/routes/settings.js` | Reads `~/.mtl-code/settings.json`, falls back to `~/.claude/settings.json` for display, and writes only to the Argus path. |
| DeepSeek Anthropic adapter | `server/claude-sdk.js`, `server/services/context-budget-service.js`, `server/routes/settings.js`, `src/components/settings/view/tabs/agents-settings/sections/content/ModelConfigContent.tsx`, `../claude-code/src/utils/model/deepseek.ts`, `../claude-code/src/utils/effort.ts`, `../claude-code/src/utils/thinking.ts`, `../claude-code/src/services/api/claude.ts` | DeepSeek runs through the Anthropic-compatible route, with child-process env injection, configurable `--bare` UI launches, `output_config.effort`, no Anthropic `thinking.budget_tokens`, and 1M context-window display through `ContextBudget`. |
| Argus auth status | `server/modules/providers/list/claude/claude-auth.provider.ts` | `modelType: "anthropic"` plus `ANTHROPIC_AUTH_TOKEN` reports `anthropic_compatible` for custom Anthropic endpoints. |
| About page removal | `src/components/settings/view/Settings.tsx`, `SettingsSidebar.tsx`, `SettingsMainTabs.tsx`, `types.ts` | Keep Settings without an About tab. |
| First-use optional UI removal | `src/components/settings`, `src/contexts/TasksSettingsContext.jsx`, `src/components/sidebar/view/subcomponents`, `src/hooks/useProjectsState.ts` | Settings shows Agents/Appearance only, TaskMaster checks are disabled, the community link is hidden, and the separate Agent config dashboard is not exposed from the sidebar. |
| Argus-only sidebar | `src/hooks/useProjectsState.ts`, `src/components/sidebar/utils/utils.ts`, `src/components/sidebar/hooks/useSidebarController.ts`, `src/components/sidebar/view/Sidebar.tsx`, `SidebarHeader.tsx`, `SidebarContent.tsx`, `SidebarProjectItem.tsx`, `SidebarSessionItem.tsx`, `SidebarProjectSessions.tsx` | Project, standalone conversation, search, and route-sync surfaces consume only Argus sessions. Legacy `codexSessions`, `cursorSessions`, and `geminiSessions` stay out of visible conversation UI. Desktop sidebar follows a compact Codex-style list: quick actions above, simple project rows, and simple session rows with the context menu collapsed into `...`. |
| Desktop project root picker | `electron/main.mjs`, `electron/preload.cjs`, `src/types/global.d.ts`, `src/components/project-creation-wizard/components/WorkspacePathField.tsx` | Packaged desktop uses Electron's native `openDirectory` dialog for project root selection so Windows users get the system folder picker; the in-app folder browser remains the browser fallback. |

## 改动起手点

| 目标改动 | 起手文件 |
| --- | --- |
| 新增 Provider | 需要产品决策。默认不要新增可见 Provider；若确实恢复多 Provider，先改 `server/shared/types.ts`、`server/shared/interfaces.ts`、`server/modules/providers/provider.registry.ts`、`server/modules/providers/list`，再同步 `src/types/app.ts`、Provider UI、sidebar/search/route-sync、K1-K5 和 smoke checklist。 |
| 新增 Provider MCP 操作 | 默认面向 Argus/`claude` compatibility provider：`server/modules/providers/services/mcp.service.ts`，`claude-mcp.provider.ts`，`src/components/mcp`。 |
| 新增 Provider auth indicator | 默认面向 Argus：`claude-auth.provider.ts`，`server/modules/providers/services/provider-auth.service.ts`，`src/components/provider-auth`，settings agents tab。 |
| 修改聊天消息渲染 | `src/components/chat/view/subcomponents/MessageComponent.tsx`，`src/components/chat/tools`，`src/stores/useSessionStore.ts`。 |
| 修改消息历史加载 | `server/routes/messages.js`，Provider 的 `*-sessions.provider.ts`，`src/stores/useSessionStore.ts`。 |
| 新增文件操作 | `server/services/file-mutation-service.js`，`server/index.js` 中的 project/file endpoints，`src/components/file-tree`，`src/components/code-editor`，`src/utils/api.js`。 |
| 新增 Review/Git 操作 | Prefer the visible `src/components/review` flow for local change review. Keep branch/remote/commit expansion deliberate and aligned with the Codex-style Review roadmap. |
| 新增 settings | `server/routes/settings.js` 或 `server/routes/user.js`，对应的 `src/components/settings` tab/hook。 |
| 新增插件能力 | `server/routes/plugins.js`，`server/utils/plugin-*`，`src/contexts/PluginsContext.tsx`，`src/components/plugins`。 |
| 新增模型选项 | 默认通过 `server/routes/settings.js` 和 Argus model profile/config 流程处理；不要恢复 searchable provider/model picker。 |
