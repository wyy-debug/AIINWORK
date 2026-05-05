# OpenMythos 运行时控制

日期：2026-04-29
更新：2026-05-05

## 定位

OpenMythos 是 Argus 的策略层。它负责生成冻结任务卡、自适应推理强度、阶段计划、专家路线和上下文诊断。它不再负责启动子智能体，也不生成旧派发协议。

Subagent 执行层已经迁移到 Codex 风格协作工具：`spawn_agent`、`send_input`、`wait_agent`、`list_agents`、`close_agent`、`resume_agent`。只有用户明确要求 subagents、delegation 或 parallel agent work 时，模型才可以调用这些工具。

## 配置结构

保存后的配置块形如：

```json
{
  "openMythosRuntime": {
    "enabled": false,
    "adaptiveEffort": true,
    "taskCard": true,
    "routingHints": true,
    "loopControl": "enforced",
    "stableReinjection": true,
    "phaseAdapter": true,
    "expertRouting": true,
    "contextCacheDiagnostics": true,
    "minEffort": "low",
    "maxEffort": "max"
  },
  "subagents": {
    "enabled": false,
    "maxConcurrentThreadsPerSession": 3,
    "maxDepth": 1
  }
}
```

支持的推理强度为 `low`、`medium`、`high`、`xhigh`、`max`。

## 运行行为

- `adaptiveEffort` 允许 Argus 在用户没有显式设置 effort 时，根据任务风险和复杂度推断推理强度。
- `taskCard` 控制是否附加隐藏的冻结任务卡。
- `routingHints` 控制隐藏任务卡是否包含技能或子智能体路线建议。
- `loopControl` 可选 `enforced` 或 `advisory`；`enforced` 会把 loop budget 映射到现有 `maxTurns` 防护。
- `stableReinjection` 会在工具结果后重新注入目标、约束、验收标准、阶段和专家路线。
- `phaseAdapter` 根据轮次计算当前阶段；`orient` 和 `plan` 是只读阶段。
- `expertRouting` 是建议面，不是隐藏执行器。
- `contextCacheDiagnostics` 显示 compact、microcompact 和工具摘要账本；它不是 MLA 或 KV cache。

## Subagent 边界

OpenMythos 不自动派发子智能体。它只能提供类似“建议用 explorer 做只读调查、用 worker 做实现”的策略提示。

真正执行必须满足两个条件：

1. 用户明确要求 subagents、delegation 或 parallel agent work。
2. 模型按 Codex 工具规则调用 `spawn_agent`。

设置页里的“启用子智能体工具”只控制下一次新会话是否暴露 Codex 风格工具，不代表 OpenMythos 会自动启动 worker。

## 诊断面板

`agent_runtime_debug` 会包含解析后的 OpenMythos 运行时块。前端诊断面板显示：

- OpenMythos 是否启用。
- 自适应推理、冻结任务卡、路线建议状态。
- 最低和最高推理强度。
- 循环控制模式。
- 稳定重注入、阶段适配器、专家路线、上下文诊断开关。
- Subagents 是否启用、单会话最大并发、最大嵌套深度。

## 验证

- 简单问候不应启动子智能体。
- 复杂任务只显示 OpenMythos 建议，不应自动调用 `spawn_agent`。
- 关闭 Subagents 后，新会话不暴露协作工具。
- 开启 Subagents 后，下一次新会话暴露 Codex 风格工具。
