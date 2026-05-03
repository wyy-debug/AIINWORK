# Codex 风格对话派生 Worktree

日期：2026-04-28

Argus 支持从 Git 项目里的某条会话派生本地 managed worktree。项目只提供仓库根目录和 base ref；真正的入口、上下文和绑定都来自源会话。目标是在独立 checkout 中继续处理同一任务，同时让父项目保持干净。

## 运行形态

- 默认根目录：`~/.mtl-code/worktrees`。
- 创建命令：`git worktree add --detach <worktreePath> <baseRef>`。
- `baseRef` 默认使用父仓库当前分支的 `HEAD`。
- 新 worktree 会注册为普通项目，并带有 `project.worktree` 元数据。
- 新 worktree 会绑定到源会话派生出的 session，继续沿用源会话上下文、模型 Profile、Agent、Skill 和 MCP 绑定。
- 用户点击“创建分支”之前，managed worktree 保持 detached HEAD。

## 存储元数据

`worktree_dispatches` 保存：

- worktree ID、父项目名称/路径、worktree 路径、base ref、base commit。
- mode/status、provider、session ID、branch name。
- 源会话派生出的 session ID、任务提示词，以及必要的上下文恢复信息。

真实聊天上下文仍然保存在普通 provider session 历史中。Agent/Skill/MCP/模型选择通过现有 session binding 链路恢复，不在项目级弹窗里重新选择。

## UI 行为

- Git 项目的会话项右侧和右键菜单显示“派生到新工作树”入口。
- “派生到本地”只回到原项目目录继续源会话，不创建 worktree。
- 父项目侧边栏只显示“工作树任务”管理入口，用于继续打开、进入会话、创建分支或删除已有 worktree。
- 派发弹窗加载源会话信息和父项目 Git 状态。
- 非 Git 项目不能创建 worktree。
- 父项目有未提交改动时仍可派发，但 UI 会说明 worktree 基于 `HEAD` 创建，不复制未提交改动。
- Worktree 项目头部显示父项目路径、detached/branch 状态、base commit、创建分支和 managed 删除入口。
- Managed 删除会检查 `git status --porcelain`；如果 worktree 有未提交改动，删除会被阻止，直到用户创建分支或手动处理改动。

## 不变约束

- v1 不自动创建分支、merge、push 或打开 PR。
- v1 不复制父项目未提交改动。
- 项目普通会话仍使用默认 Argus；派生 worktree 时沿用源会话已经保存的 Agent/Skill/MCP/模型绑定。
