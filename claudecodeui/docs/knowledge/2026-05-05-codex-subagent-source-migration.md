# Codex 风格 Subagent 迁移

日期：2026-05-05

本轮把 Argus Subagent 收敛到 OpenAI Codex 当前协作智能体协议：只保留 `spawn_agent`、`send_input`、`wait_agent`、`list_agents`、`close_agent`、`resume_agent` 这组工具，以及 parent-child thread graph 状态。旧的事件派发、ticket 授权和 OpenMythos 自动启动 worker 路线已经移除执行路径。

## 当前规则

- Subagents 默认关闭；在设置页开启后，只对下一次新会话生效。
- 工具名只暴露 Codex 风格名称，不暴露旧 callable alias。
- `spawn_agent` 只接受 Codex 参数：`message/items`、`agent_type`、`fork_context`、`model`、`reasoning_effort`。
- 只有用户明确要求 subagents、delegation 或 parallel agent work 时，模型才可以调用 `spawn_agent`。
- OpenMythos 只做任务拆分建议和诊断预览，不生成 ticket，不写 worker plan，不注入自动派发环境变量。
- 主聊天不显示内部控制 XML、output file、task id、worker 自述或控制失败自述。

## 后端边界

工具发布入口在 `claude-code/src/tools.ts`：

- 关闭时不发布 subagent 工具。
- 开启时发布：`spawn_agent`、`list_agents`、`wait_agent`、`close_agent`、`send_input`、`resume_agent`。
- 旧会话 transcript 只做只读展示兼容，不再参与新工具列表。

Subagent 状态保存在 `claude-code/src/tasks/subagentRegistry.ts`，核心字段：

- `threadId`
- `parentThreadId`
- `depth`
- `agentNickname`
- `agentRole`
- `graphStatus`
- `source`

`closeSubagentSubtree()` 会关闭目标 agent 及其 descendants，并释放运行槽位。

## OpenMythos 边界

OpenMythos 是策略层，不是执行层：

- 可以提示“建议拆分为 explorer / worker 等任务”。
- 不自动调用 `spawn_agent`。
- 不再输出旧派发协议。
- 不绕过 Codex 工具规则。

复杂任务只会得到建议；是否真的派发，必须由主模型在用户明确授权后按 Codex 规则调用 `spawn_agent`。

## 前端显示

消息归一化由 `claudecodeui/src/components/chat/hooks/useChatMessages.ts` 负责：

- `spawn_agent` 和旧历史工具名都归一为 subagent container。
- 内部 task notification 即使以 user text 形式进入历史，也要过滤，不渲染成蓝色用户气泡。
- Subagent 状态区显示运行中、已完成、已关闭、失败、被中断数量。

运行诊断面板显示：

- Subagents 是否启用。
- 单会话最大并发。
- 最大嵌套深度。
- OpenMythos 当前仅作为建议层。

## 设置页

`Model / Hub > 运行时` 只保留一组 Subagent 配置：

- 启用子智能体工具。
- 单会话最大并发。
- 最大嵌套深度。

这不是旧 Agent 管理页，也不是 OpenMythos 自动派发开关。

## 验证

本轮关键验证：

- `claude-code`：`tsc --noEmit`
- `claudecodeui`：`tsc --noEmit`

计划继续补的验证：

- focused subagent bun suites
- 前端消息恢复 smoke
- 打包后开启/关闭 subagents 的新会话工具列表 smoke
