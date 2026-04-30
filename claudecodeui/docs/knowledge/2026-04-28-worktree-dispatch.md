# Codex 风格 Worktree 派发

日期：2026-04-28

MTL-Code UI 支持在 Git 项目中派发本地 managed worktree。目标是在独立 checkout 中执行任务，同时让父项目保持干净。

## 运行形态

- 默认根目录：`~/.mtl-code/worktrees`。
- 创建命令：`git worktree add --detach <worktreePath> <baseRef>`。
- `baseRef` 默认使用父仓库当前分支的 `HEAD`。
- 新 worktree 会注册为普通项目，并带有 `project.worktree` 元数据。
- 用户点击“创建分支”之前，managed worktree 保持 detached HEAD。

## 存储元数据

`worktree_dispatches` 保存：

- worktree ID、父项目名称/路径、worktree 路径、base ref、base commit。
- mode/status、provider、session ID、branch name。
- 选择的 Agent ID、Skill 名称、MCP/app 绑定和任务提示词。

真实聊天上下文仍然保存在普通 provider session 历史中。Agent/Skill/MCP 选择通过现有 session binding 链路恢复。

## UI 行为

- 非 worktree 项目的父项目侧边栏显示 worktree 派发入口。
- 派发弹窗加载已启用 Agent、已安装 Skill 和父项目 Git 状态。
- 非 Git 项目不能创建 worktree。
- 父项目有未提交改动时仍可派发，但 UI 会说明 worktree 基于 `HEAD` 创建，不复制未提交改动。
- Worktree 项目头部显示父项目路径、detached/branch 状态、base commit、创建分支和 managed 删除入口。
- Managed 删除会检查 `git status --porcelain`；如果 worktree 有未提交改动，删除会被阻止，直到用户创建分支或手动处理改动。

## 不变约束

- v1 不自动创建分支、merge、push 或打开 PR。
- v1 不复制父项目未提交改动。
- 除非派发时显式选择 Agent/Skill，否则项目会话仍使用默认 MTL-Code。
