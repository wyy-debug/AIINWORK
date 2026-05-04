# 2026-05-04 仓库更新落地说明

## 更新基线

本次本地仓库已执行 `git pull --ff-only origin main`，从 `2d96cbc` 快进到 `4785f3d`。

最新提交：

- `4785f3d Add Argus desktop workflow`

当前工作区只剩一个未跟踪目录 `soc-hunter-test-kit/`，本次文档落地不纳入该目录。

## 主要变更范围

### Argus Workbench

本次更新把 Argus 从纯聊天入口继续扩展为 chat-first 工作台：

- `src/components/actions/view/ActionsPanel.tsx`：Run/Actions 面板，支持项目命令、运行日志、Worktree 模式入口。
- `src/components/review/view/ReviewPanel.tsx`：Changes/Review 面板，承载本地 Git diff、暂存、取消暂存、丢弃和 review note。
- `src/components/browser/view/BrowserPanel.tsx`：Preview 面板，面向 localhost、127.0.0.1、::1 和项目文件 URL 的本地预览。
- `src/components/artifacts/view/ArtifactsPanel.tsx`：Results 面板，保存 review note、截图、action log、automation run 等结果。
- `src/components/command-menu/view/GlobalCommandMenu.tsx`：全局命令菜单，统一打开 visible Argus surfaces。

产品规则保持不变：Argus 是唯一用户可见 Provider，`claude` 仍只是 compatibility provider key。

### 后端工作流 API

新增和增强了一组后端路由：

- `server/routes/project-actions.js`：项目动作配置、运行、停止、日志。
- `server/routes/artifacts.js`：结果产物持久化和筛选。
- `server/routes/automations.js`、`server/routes/triage.js`：本地自动化定义、运行记录和 triage inbox。
- `server/routes/ide-bridge.js`：预留给 VS Code 等 IDE 的 token/state/context/open-file 通道。
- `server/routes/worktrees.js`：Worktree 派发继续增强，增加 handoff/setup 相关能力。
- `server/routes/git.js`：本地 Git review 能力继续补齐。

这些 API 都是本地优先能力；涉及命令执行的路径需要经过 shared runtime permission service。

### Runtime Permission

新增 `server/services/runtime-permission-service.js`，并接入 Shell、Actions、Worktree setup、Automation command execution 等路径。

Settings 里新增 Runtime 设置页，负责：

- 选择默认 terminal。
- 配置 WSL 和发行版。
- 配置 allowed paths。
- 配置危险命令确认策略。

注意：这是 Argus 本地运行权限策略，不是 OS 内核级 sandbox。

### OpenMythos 与 Subagent Dispatch

`claude-code` 侧新增硬派发相关能力：

- `claude-code/src/utils/openmythosHardDispatch.ts`
- `claude-code/src/coordinator/coordinatorMode.ts`
- `claude-code/src/coordinator/workerAgent.ts`

OpenMythos 仍是策略层；Coordinator/Agent worker 是执行层。`dispatchPlan` 出现时，硬派发通过现有 `Agent({ subagent_type: "worker" })` 路径运行。Worker 不继承 parent OpenMythos runtime state，避免 orient/plan 阶段的只读限制阻塞实际实现。

### Context Budget

旧的 Agent RAG runtime 已移除：

- 删除 `server/services/agent-rag-service.js`
- 删除 `docs/knowledge/2026-04-27-agent-rag-foundation.md`

新的上下文显示和统计统一走 ContextBudget：

- `server/services/context-budget-service.js`
- `src/components/chat/utils/contextBudget.ts`
- `src/components/chat/view/subcomponents/TokenUsagePie.tsx`

文档需要继续避免把“累计 token 消耗”误写成“当前上下文窗口占用”。Agent 知识上传/RAG 不再是运行时产品能力；Agent 上下文应来自 prompt、Skills、MCP bindings、memory metadata 和普通 workspace 文件。

### 文件写入保护

本次继续加强写文件稳定性：

- `claude-code/src/utils/file.ts` 增加底层写入后的内容验证。
- `server/services/file-mutation-service.js` 为 UI 文件保存提供 stale-save conflict 处理和 mutation 审计基础。
- `server/routes/project-actions.js`、`server/routes/git.js` 等路径使用统一 runtime permission 和结果记录。

目标是减少 Bash 拼接写文件、quote 断裂、外部改动覆盖等问题。

### Desktop / IDE Bridge

桌面端新增：

- `electron/preload.cjs`
- BrowserView 相关 IPC。
- `ide-extension/argus-vscode/` VS Code extension skeleton。

这批能力还属于本地桥接基础，不应在用户文案里承诺完整 IDE 同步体验；后续需要单独验收 token、open-file 和 context API。

## 文档状态

远端已同步新增以下知识库文档：

- `2026-05-02-codex-roadmap-v1.md`
- `2026-05-03-argus-workbench-integration.md`
- `2026-05-03-context-budget-alignment.md`
- `2026-05-03-file-write-guard-packaging.md`

本文件作为 2026-05-04 的仓库更新索引，记录这次 pull 后的实际落地点和后续验证重点。

## 验收建议

本次变更面较大，建议后续按下面顺序验收：

1. `npm run typecheck`
2. `npm run check:mojibake`
3. `git diff --check`
4. 目标 ESLint：Actions、Review、Browser、Artifacts、Settings Runtime、Chat、Worktree、server routes。
5. 手动打开 Settings，确认 Model/Hub、Runtime、MCP、Repository 长表单没有遮挡。
6. 项目会话和独立对话各发一条消息，确认模型按 session 生效。
7. 运行一个 Actions 命令，确认危险命令会走 runtime permission。
8. 打开 Review，检查 stage/unstage/discard 和 review note。
9. 打开 Browser/Preview，只验证本地 URL 和项目文件 URL。
10. 创建一个 managed worktree，确认会话绑定、进入会话、创建分支和 dirty 删除阻止。
11. 验证 ContextBudget 显示区分当前上下文占用和累计消耗。
12. 验证 OpenMythos dispatch 只在用户确认或设置允许时进入硬派发。

## 后续注意事项

- 不要重新暴露 legacy provider UI。可见品牌继续统一为 Argus。
- 不要恢复旧 Agent RAG 上传/检索运行时。若以后需要知识源，应另起设计，不复用已删除的 `agent-rag-service.js`。
- Runtime Permission 是所有本地命令执行入口的统一门面，新增命令入口必须接入它。
- Workbench 面板是 chat-first 的辅助面板，不要把它们做成脱离聊天的孤立首页。
- IDE Bridge 目前是基础设施，真正用户可见的 VS Code 打开/同步体验需要单独冒烟。
