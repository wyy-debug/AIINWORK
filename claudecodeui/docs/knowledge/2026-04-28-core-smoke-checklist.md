# MTL-Code 核心冒烟清单

日期：2026-04-28

当 Agent、Skill、MCP、Hub、Worktree、权限、会话列表或打包流程有改动时，发布 Windows 包前至少跑一遍这份清单。

## 自动化基线

1. 启动开发服务或已打包的预览目标。
2. 确认当前 checkout 可用 Playwright，例如执行 `npm install --no-save playwright`。
3. 执行 `npm run smoke:ui`。
4. 如果目标不是 `http://127.0.0.1:5173`，使用 `SMOKE_BASE_URL=http://host:port npm run smoke:ui`。
5. 脚本至少覆盖：主界面加载、项目/对话切换、输入框可输入、模型切换弹窗关闭后焦点恢复。

## Code UI

1. 启动已打包应用。
2. 确认安装图标、桌面图标、启动/任务栏图标都是蓝色 MTL-Code 图标。
3. 确认侧边栏在 `项目` 和 `对话` 之间切换时，不会闪到错误空间。
4. 创建或打开 `C:\Users\yckui` 之外的项目；除系统关键路径外不应被阻止。
5. 项目会话中不显示 Agent 配置控件，但可以显示 Skill 控件。
6. 项目会话中输入 `@`，确认文件选择器弹出，并能插入选中的文件 mention。
7. 删除会话后应立即从 UI 消失，刷新后不应恢复。
8. 重命名、置顶、归档、恢复会话；置顶会话应排在前面，归档会话应可恢复。
9. 上滑加载历史消息时只显示顶部悬浮加载状态，当前阅读位置不应闪回。
10. 已折叠的思考过程和工具调用默认不渲染明细，展开后再加载明细。

## Agent / Skill

1. 打开独立对话，并选择使用 Agent。
2. 填完必要槽位后启动对话。
3. 在输入框绑定一个已安装 Skill，然后发送消息。
4. 打开诊断面板，确认 Agent、Skill、MCP、模型、上下文长度和权限快照都可见。
5. 绑定一个不存在的 Skill，确认 UI 标记不可用，但不阻止发送。
6. 项目会话默认使用 MTL-Code；独立对话可显式选择 Agent，Worktree 从源会话继承已保存的 Agent/Skill/MCP/模型绑定。

## MCP / Hub

1. 添加远端 Hub catalog URL 并同步。
2. 在输入框的 Skill 菜单中搜索远端 Hub Skill，并直接安装。
3. 从仓库安装 `soc-redmine` 或 `ainwork-code-search` MCP。
4. 运行 MCP 可用性检测；缺少必填项时应显示字段缺失，但不能显示 secret 明文。
5. 配置 `REDMINE_API_KEY`、`root` 等必填字段，保存后重新检测。
6. 远端 Hub 返回 401 时，应明确说明当前请求的 Hub、缺少的是 admin token 还是 submit token。

## Worktree

1. 打开一个干净的 Git 项目，展开目标会话，并从会话右侧点击“派生到新工作树”。
2. 确认 worktree 作为独立项目出现在项目列表中，并能打开绑定到源会话上下文的新会话。
3. 确认 worktree 头部显示父项目、base ref/commit、detached 状态、创建分支、删除入口。
4. 从 worktree 头部创建分支。
5. 尝试删除有未提交改动的 worktree，确认删除被阻止。
6. 从非 Git 项目会话派生 worktree，应得到清晰错误。
7. 打开父项目的工作树任务列表，确认继续打开、进入会话、创建分支、删除动作可见。

## Permissions

1. 在设置中启用权限绕过。
2. 发送一个正常情况下会申请权限的命令。
3. 如果仍然弹出权限申请，打开诊断面板，确认最终权限模式、skip 标记、allowed tools、disallowed tools 和冲突来源。
