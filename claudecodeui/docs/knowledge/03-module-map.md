# K3 模块地图

## 顶层目录

| 路径 | 角色 |
| --- | --- |
| `src/` | React 前端应用。 |
| `server/` | Express 后端、WebSocket、Provider runtime、数据库、routes。 |
| `shared/` | 前后端构建都会用到的常量和 helper。 |
| `public/` | 静态资源、截图、service worker 资源。 |
| `plugins/` | 本地插件工作区。 |
| `docker/` | 支持多 agent 的 Docker sandbox。 |
| `scripts/` | 安装、构建和维护脚本。 |
| `redirect-package/` | package redirect/support metadata。 |

## 前端模块归属

| 区域 | 主要路径 | 说明 |
| --- | --- | --- |
| App shell | `src/App.tsx`，`src/components/app`，`src/components/main-content` | Provider 组合、选中 project/session、tabs、布局。 |
| Sidebar/projects | `src/components/sidebar`，`src/hooks/useProjectsState.ts` | 项目/会话列表、active tab、settings modal 状态。 |
| Chat | `src/components/chat`，`src/stores/useSessionStore.ts` | 输入框、实时处理、消息合并、工具渲染。 |
| Chat tools | `src/components/chat/tools` | 工具渲染 registry 和内容/交互 renderer。 |
| Files/editor | `src/components/file-tree`，`src/components/code-editor` | 文件树、CodeMirror 编辑器、二进制/图片处理。 |
| Git | `src/components/git-panel` | status、diff、stage/commit、branch、history、remote 操作。 |
| Shell | `src/components/shell`，`src/components/standalone-shell` | xterm runtime 和 `/shell` WebSocket。 |
| MCP | `src/components/mcp` | Provider MCP server 的 list/create/update/remove UI。 |
| Auth | `src/components/auth` | login/setup/protected route 和 auth context。 |
| Settings | `src/components/settings`，`src/components/quick-settings-panel`，`src/components/provider-auth` | Agents、API keys、credentials、Git config、appearance、notifications。 |
| Plugins | `src/contexts/PluginsContext.tsx`，`src/components/plugins` | 插件列表、install/update/toggle、插件 tab 内容。 |
| Task planning | `src/components/task-master`，`src/components/prd-editor`，`src/contexts/TaskMasterContext.ts` | TaskMaster panel、PRD 编辑、任务生成。 |
| Project creation | `src/components/project-creation-wizard` | workspace 创建、GitHub token、clone/create 流程。 |
| Worktree dispatch | `src/components/sidebar/view/subcomponents/WorktreeDispatchModal.tsx`，`src/components/main-content/view/subcomponents/WorktreeProjectBadge.tsx` | Git worktree 派发入口、Agent/Skill 预绑定、worktree 项目头部状态和分支/删除操作。 |
| Shared UI | `src/shared/view/ui` | 可复用 UI primitives。 |
| API/types | `src/utils/api.js`，`src/types/app.ts` | HTTP wrapper 和前端 app contracts。 |

## 后端模块归属

| 区域 | 主要路径 | 说明 |
| --- | --- | --- |
| Composition root | `server/index.js` | Express setup、WebSocket routing、历史 project/file endpoints、shell/chat dispatch。 |
| Auth middleware | `server/middleware/auth.js` | JWT/API key 校验和 WebSocket auth。 |
| App DB | `server/database/db.js`，`server/database/schema.js` | SQLite schema 和 persistence helpers。 |
| Provider contracts | `server/shared/interfaces.ts`，`server/shared/types.ts`，`server/shared/utils.ts` | 后端共享类型、错误、响应 helpers、normalized messages。 |
| Provider module | `server/modules/providers` | Provider registry、provider routes、auth/MCP/session contracts。 |
| Claude runtime | `server/claude-sdk.js`，`server/modules/providers/list/claude` | Claude SDK query、permissions、auth/MCP/session adapters。 |
| Cursor runtime | `server/cursor-cli.js`，`server/modules/providers/list/cursor`，`server/routes/cursor.js` | Cursor command spawning、auth/MCP/session adapters。 |
| Codex runtime | `server/openai-codex.js`，`server/modules/providers/list/codex`，`server/routes/codex.js` | Codex SDK/session deletion/MCP/auth adapters。 |
| Gemini runtime | `server/gemini-cli.js`，`server/modules/providers/list/gemini`，`server/routes/gemini.js` | Gemini CLI/session deletion/MCP/auth adapters。 |
| Projects/session discovery | `server/projects.js`，`server/index.js` 中的 project endpoints | 聚合 projects、sessions、search、names、path extraction。 |
| Workspace creation | `server/routes/projects.js` | workspace 校验、GitHub clone/create 流程。 |
| Worktree dispatch | `server/routes/worktrees.js`，`server/database/db.js` | managed detached worktree 创建、元数据、session 关联、分支创建和 dirty 删除检查。 |
| Git | `server/routes/git.js` | status、diff、commit、branch、remote 操作。 |
| Commands | `server/routes/commands.js` | command listing/execution 支持。 |
| Settings | `server/routes/settings.js`，`server/routes/user.js` | API keys、credentials、notifications、server env、user Git config、onboarding。 |
| Plugins | `server/routes/plugins.js`，`server/utils/plugin-loader.js`，`server/utils/plugin-process-manager.js` | 插件发现、install/update/remove、进程生命周期。 |
| TaskMaster | `server/routes/taskmaster.js`，`server/utils/taskmaster-websocket.js` | TaskMaster install/status/tasks/PRD/template routes 和 websocket 支持。 |
| Notifications | `server/services/notification-orchestrator.js`，`server/services/vapid-keys.js` | Web Push key/subscription 和通知投递。 |

## 2026-04-26 MTLCode Agent Model Config Anchors

| Area | Owner files | Notes |
| --- | --- | --- |
| Agent settings provider list | `src/components/settings/view/tabs/agents-settings/AgentsSettingsTab.tsx`, `AgentSelectorSection.tsx` | Only the internal `claude` provider key is visible, labelled as `MTLCode`. |
| Chat first screen model surface | `src/components/chat/view/subcomponents/ProviderSelectionEmptyState.tsx`, `src/components/chat/hooks/useChatProviderState.ts`, `shared/modelConstants.js` | New-chat UI shows one static `MTL-Code / MTLCode` card and normalizes stale local model/provider values. |
| MTL-Code direct runtime | `server/claude-sdk.js`, `scripts/package-preview-win.mjs`, `scripts/preview-launcher.mjs`, `package.json` | UI backend keeps the legacy `queryClaudeSDK` export but launches paired MTL-Code directly through stream-json. Packaged preview sets `MTL_CODE_CLI_PATH` and `MTL_CODE_RESOURCES_DIR`, while `server/claude-sdk.js` falls back only through existing absolute-path candidates such as `mtl-code.exe` and bundled CLI entrypoints; the Anthropic Agent SDK must not be an app dependency. |
| Project cwd repair | `server/projects.js`, `server/claude-sdk.js` | Project discovery repairs Windows provider project names decoded into paths like `C//Users/.../new/web/app`; chat runtime validates the cwd before spawning MTL-Code so missing directories are not mistaken for missing executables. |
| Agent model config UI | `src/components/settings/view/tabs/agents-settings/sections/content/ModelConfigContent.tsx` | Reads and saves `/api/settings/mtl-code-model`. |
| Model config API | `server/routes/settings.js` | Reads `~/.mtl-code/settings.json`, falls back to `~/.claude/settings.json` for display, and writes only to the MTL-Code path. |
| DeepSeek Anthropic adapter | `server/claude-sdk.js`, `server/routes/settings.js`, `src/components/settings/view/tabs/agents-settings/sections/content/ModelConfigContent.tsx`, `../claude-code/src/utils/model/deepseek.ts`, `../claude-code/src/utils/effort.ts`, `../claude-code/src/utils/thinking.ts`, `../claude-code/src/services/api/claude.ts` | DeepSeek runs through the Anthropic-compatible route, with child-process env injection, configurable `--bare` UI launches, `output_config.effort`, and no Anthropic `thinking.budget_tokens`. |
| MTL-Code auth status | `server/modules/providers/list/claude/claude-auth.provider.ts` | `modelType: "anthropic"` plus `ANTHROPIC_AUTH_TOKEN` reports `anthropic_compatible` for custom Anthropic endpoints. |
| About page removal | `src/components/settings/view/Settings.tsx`, `SettingsSidebar.tsx`, `SettingsMainTabs.tsx`, `types.ts` | Keep Settings without an About tab. |
| First-use optional UI removal | `src/components/settings`, `src/contexts/TasksSettingsContext.jsx`, `src/components/sidebar/view/subcomponents`, `src/hooks/useProjectsState.ts` | Settings shows Agents/Appearance only, TaskMaster checks are disabled, and the community link is hidden. |

## 改动起手点

| 目标改动 | 起手文件 |
| --- | --- |
| 新增 Provider | `server/shared/types.ts`，`server/shared/interfaces.ts`，`server/modules/providers/provider.registry.ts`，`server/modules/providers/list`，再到 `src/types/app.ts` 和 Provider UI。 |
| 新增 Provider MCP 操作 | `server/modules/providers/services/mcp.service.ts`，Provider 的 `*-mcp.provider.ts`，`src/components/mcp`。 |
| 新增 Provider auth indicator | Provider 的 `*-auth.provider.ts`，`server/modules/providers/services/provider-auth.service.ts`，`src/components/provider-auth`，settings agents tab。 |
| 修改聊天消息渲染 | `src/components/chat/view/subcomponents/MessageComponent.tsx`，`src/components/chat/tools`，`src/stores/useSessionStore.ts`。 |
| 修改消息历史加载 | `server/routes/messages.js`，Provider 的 `*-sessions.provider.ts`，`src/stores/useSessionStore.ts`。 |
| 新增文件操作 | `server/index.js` 中的 project/file endpoints，`src/components/file-tree`，`src/components/code-editor`，`src/utils/api.js`。 |
| 新增 Git 操作 | `server/routes/git.js`，`src/components/git-panel`，`src/utils/api.js`。 |
| 新增 settings | `server/routes/settings.js` 或 `server/routes/user.js`，对应的 `src/components/settings` tab/hook。 |
| 新增插件能力 | `server/routes/plugins.js`，`server/utils/plugin-*`，`src/contexts/PluginsContext.tsx`，`src/components/plugins`。 |
| 新增模型选项 | `shared/modelConstants.js`，再到 Provider 选择 UI 或 command option mapping。 |
