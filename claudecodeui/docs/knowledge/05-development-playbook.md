# K5 开发手册

## 本地命令

| 命令 | 用途 |
| --- | --- |
| `npm run dev` | 同时启动后端和 Vite 前端。 |
| `npm run server:dev` | 只通过 `tsx` 启动后端。 |
| `npm run client` | 只启动 Vite。 |
| `npm run typecheck` | 同时 typecheck 前端和后端配置。 |
| `npm run lint` | lint `src/` 和 `server/`。 |
| `npm run build` | 构建 client 和 server output。 |

使用 Node 22+；当前 `.nvmrc` 指向 major version `22`。

## 通用改动清单

1. 在 K1 确认需求对应的领域概念。
2. 在 K3 找到 owner 模块。
3. 保持已有边界：HTTP 走 REST，聊天/项目实时走 `/ws`，PTY 走 `/shell`，Provider 专属行为进 Provider 模块。
4. 新增自定义 helper 前，先复用现有库和本地模式。
5. 在消费边界附近补齐或更新类型。
6. 至少运行 `npm run typecheck`；改到 ESLint 覆盖的代码路径时运行 `npm run lint`。
7. 路由、消息类型、Provider 契约、模块归属变化时，同步更新知识架构。

## 新增后端行为

- 优先新增聚焦 route/module，不要继续膨胀 `server/index.js`，除非相邻 endpoint 已经在那里。
- App API 使用与邻近 route 一致的 auth middleware。
- 在模块化 TypeScript route 中沿用 `AppError`、`asyncHandler`、`createApiSuccessResponse`。
- Provider 专属的文件系统/config 知识留在 Provider adapter 内。
- 共享后端契约放在 `server/shared/types.ts` 和 `server/shared/interfaces.ts`。
- 文件写入、删除、上传、Shell action 前必须校验 workspace path。

## 新增前端行为

- feature-specific state 优先放到 feature hook，不要过早放全局 context。
- view component 专注渲染和交互；fetch/transform 放 hook 或数据模块。
- 复用现有功能目录结构：`constants`、`hooks`、`types`、`utils`、`view`。
- authenticated fetch 走 `src/utils/api.js`，必要时集中 endpoint 字符串。
- App-wide realtime event 从 `WebSocketContext` 的 `latestMessage` 消费，处理逻辑保持幂等。
- 修改聊天消息时，要同步考虑 `NormalizedMessage`、store 合并逻辑和 renderer。

## 新增或修改 Provider

1. 如果 Provider 集合变化，同时更新前端和后端的 `LLMProvider`。
2. 在 `server/modules/providers/list/<provider>` 下实现 auth、MCP、sessions。
3. 在 `server/modules/providers/provider.registry.ts` 注册 Provider。
4. 把 Provider 原生事件标准化为 `NormalizedMessage`。
5. 只在 runtime 派发位置新增 command dispatch。
6. 更新前端 Provider selection、auth status、icons、model constants、settings UI。
7. 验证 project discovery、history loading、新 session、resume session、abort、auth status、MCP list/upsert/remove。

## 新增或修改 Chat Tools

- 先看 `src/components/chat/tools/README.md`。
- 在 `src/components/chat/tools/configs` 增加配置。
- 在 `ContentRenderers` 或 `InteractiveRenderers` 增加或复用 renderer。
- Tool display 应由 normalized message data 驱动，不要绑死 Provider 特例。
- 验证 collapsed/expanded、raw parameter display、thinking visibility、permission interactions。

## 2026-04-26 Agent Model Config Checklist

- Keep the first-use Settings > Agents UI to one visible agent: `MTLCode`.
- Keep the first-use Chat empty state to one visible static model card: `MTL-Code / MTLCode`; do not reintroduce the searchable model picker.
- Keep the internal provider key as `claude` until WebSocket, session, MCP, and normalized message contracts are migrated together.
- Chat execution must call the paired MTL-Code runtime directly through stream-json; do not reintroduce `@anthropic-ai/claude-agent-sdk` for MTL-Code chat turns.
- Keep `@anthropic-ai/claude-agent-sdk` out of app dependencies and packaged `resources/app/node_modules`; the UI backend must launch MTL-Code directly.
- Local development should prefer Bun plus `../claude-code/dist/cli-bun.js`; packaged preview should prefer `resources/mtl-code/mtl-code.exe` but keep automatic fallback to bundled CLI entrypoints for Windows `spawn ENOENT` cases.
- Never add bare `mtl-code` to the chat runtime fallback list on Windows; it can require `cmd.exe` and fail before reaching a real backend.
- Keep packaged `mtl-code.cmd` Bun-first so fallback execution still uses `dist/cli-bun.js` when Bun is installed.
- Before diagnosing Windows `spawn ENOENT` as a missing MTL-Code executable, check whether the child-process `cwd` exists. Project discovery can decode provider project names into malformed paths such as `C//Users/.../new/web/app`; repair the cwd or return a clear missing-directory error before spawning.
- Anthropic-compatible model config belongs in `server/routes/settings.js` and writes to `~/.mtl-code/settings.json`.
- Align saved keys with MTL-Code: `modelType: "anthropic"`, `model`, and `env.ANTHROPIC_*`; clear legacy `env.OPENAI_*` so chat does not choose the OpenAI provider.
- Keep first-use Settings to Agents/Appearance only; keep TaskMaster/community surfaces hidden unless explicitly reintroduced.
- Verify this surface with `npm run typecheck`, `npm run lint`, and a GET/PUT smoke test for `/api/settings/mtl-code-model` when a dev server is running.

## 验证矩阵

| 改动类型 | 最小检查 |
| --- | --- |
| 仅文档 | 读一遍改动文档，检查 `git diff` 或 untracked 文件列表。 |
| 前端 UI | `npm run typecheck`，`npm run lint`，通过 `npm run dev` 做浏览器 smoke test。 |
| 后端 route | `npm run typecheck`，`npm run lint`，手动或通过 UI 调 endpoint。 |
| WebSocket/chat | typecheck/lint，发消息，resume session，abort session，刷新浏览器重连。 |
| Provider | typecheck/lint，auth status，session history，新 session，resumed session，MCP config。 |
| Files/Git/Shell | typecheck/lint，path safety smoke test，project root 和 nested path 都测。 |
| Plugins | typecheck/lint，list/install/enable/disable，plugin tab render，backend process start/stop。 |

## Review 启发式

- 改到 Provider contract，通常需要同步 K1、K2、K3、K4。
- 改到 `server/index.js`，先确认有没有更合适的模块化归宿。
- 新增 global context 时，要证明它真的是跨 App 状态。
- 任何读写文件的改动，都要能在操作附近看到 path validation。
- 渲染 Provider message 的改动，要么支持所有 Provider，要么明确按 Provider gate。
