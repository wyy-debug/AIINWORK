# Codex 风格 Subagent 迁移

日期：2026-05-05

本轮把 Argus Subagent 收敛到 OpenAI Codex 当前协作智能体协议：`spawn_agent`、`list_agents`、`wait_agent`、`send_message`、`close_agent`、`resume_agent`，以及 parent-child thread graph、Mailbox 通知和状态恢复。

早期实验性的自动派发路线已经退出新会话执行链路。Release 包默认关闭 Subagents；debug/test 通道可以开启，用于验证协议、状态、UI 和历史恢复。

## 当前规则

- Subagents 默认关闭；开启后只对新会话生效。
- 工具名只暴露 Codex 风格名称，不暴露旧 callable alias。
- `spawn_agent` 只接受 Codex 参数：`message`、`task_name`、`agent_type`、`fork_turns`、`model`、`reasoning_effort`。
- `wait_agent` 只接收 `timeout_ms`，由 Mailbox sequence 驱动。
- `send_message` 用于向指定 agent 发送具体补充信息，不能用来轮询“进度如何”。
- 只有用户明确要求 subagents、delegation 或 parallel agent work 时，模型才可以调用 `spawn_agent`。
- OpenMythos 只做任务拆分建议和诊断预览，不自动 spawn。
- 主聊天不显示内部控制 XML、output file、task id、agent id、worker 自述或等待废话。

## Codex Alignment Matrix

| 能力 | Codex 源码参考 | Argus 目标 | 当前状态 |
| --- | --- | --- | --- |
| `spawn_agent` | `multi_agents_v2/spawn.rs` | 创建独立 child thread，继承父会话模型、权限、cwd 和运行时策略，可按需覆盖 role/model/effort | 已对齐基础 schema，继续补历史恢复验收 |
| `list_agents` | `multi_agents_v2/list_agents.rs` | 从 SubagentManager / thread graph 读取 agent 列表，不从聊天文本推断 | 部分对齐 |
| `wait_agent` | `multi_agents_v2/wait.rs` | 等待 Mailbox sequence 变化，返回 compact 状态，不输出等待废话 | 部分对齐 |
| `send_message` | `multi_agents_v2/send_message.rs` | 向目标 agent 队列发送具体补充信息，不用于开放式轮询 | 部分对齐 |
| `close_agent` | `agent/control.rs` | 关闭目标 agent 及 descendants，释放并发槽位 | 部分对齐 |
| `resume_agent` | `agent/control.rs` | 恢复 closed/interrupted agent，继续原目标并返回结构化结果 | 部分对齐 |
| Thread graph | `agent/registry.rs`、state migrations | 持久化 parent-child edge、nickname、role、last task | 部分对齐 |
| Mailbox | `agent/mailbox.rs` | 由 typed event / sequence 通知父线程结果到达 | 部分对齐 |
| UI 噪声过滤 | TUI snapshots / collab events | 只展示计划摘要、运行摘要、证据和阻塞原因 | 部分对齐 |
| Release gate | Codex feature flags | Release 默认关闭，debug/test 可开启 | 已对齐 |

## 后端边界

工具发布入口在 `claude-code/src/tools.ts`：

- 关闭时不发布 subagent 工具。
- 开启时发布：`spawn_agent`、`list_agents`、`wait_agent`、`close_agent`、`send_message`、`resume_agent`。
- 旧会话 transcript 只做只读展示兼容，不再参与新工具列表。

Subagent 状态保存在 `claude-code/src/tasks/subagentRegistry.ts`，核心字段包括：

- `taskName`
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

必须保持：

- 文档不再把早期实验协议描述为现行模型。
- Focused subagent bun suites 通过。
- 前端消息恢复 smoke 通过。
- 打包后开启/关闭 subagents 的新会话工具列表 smoke 通过。
