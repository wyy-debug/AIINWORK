# Coordinator Mode

Argus 旧的 Coordinator ticket/WorkerRuntime 方案已经废弃。当前实现对齐 OpenAI Codex 的 collaborative agent tools。

## 可调用工具

新会话只暴露：

- `spawn_agent`
- `send_input`
- `wait_agent`
- `list_agents`
- `close_agent`
- `resume_agent`

旧的 `AgentSpawn`、`AgentWait`、`AgentSendInput`、`AgentCancel`、`AgentDispatchPlan`、`AgentResult` 不再作为 callable alias 暴露。

## Feature Gate

Subagents 默认关闭。用户在设置页或 `/subagents` 开启后，下一会话才会暴露协作工具。

默认禁止嵌套 subagents。高级配置可以打开 depth limit，但仍受并发上限和 duplicate objective guard 约束。

## OpenMythos

OpenMythos 不再自动派发。它只给父线程提供任务拆分建议和诊断预览，不能创建 ticket，也不能注入 worker plan。

## 状态恢复

历史恢复以 thread graph 为准：

```text
parent_thread_id -> child_thread_id
edge_status: open | closed
```

UI 根据 graph 和 runtime watcher 显示运行中、已完成、失败、已关闭和被中断状态。
