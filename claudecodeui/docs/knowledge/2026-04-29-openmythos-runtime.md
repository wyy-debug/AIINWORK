# OpenMythos 运行时控制

日期：2026-04-29
更新：2026-05-04

## 定位

OpenMythos 是 Argus 的策略层。它负责根据用户任务生成冻结任务卡、自适应推理强度、阶段计划、专家路由和 `workerPlan`；真正的执行层是 WorkerRuntime，并继续复用现有 `AgentTool.call()` 与 async task notification。

本轮校准后，OpenMythos 不再只是“给路由建议”。当满足条件时，它会输出 `workerPlan`；Argus UI 会在发送前预览派发计划并请求用户确认，确认后才把同一份 plan 传给 CLI 由 WorkerRuntime 启动 worker。未确认、取消或预览失败时，本轮会通过环境变量降级为单 Agent 执行。

## 已实现内容

- 设置页 `Model / Hub > 运行时` 提供 OpenMythos 配置，保存到 `~/.mtl-code/settings.json` 的 `openMythosRuntime`。
- OpenMythos 默认关闭。只有用户在运行时设置里显式打开 `enabled`，后端才会注入启用态环境变量；自动派发也默认关闭。
- UI 后端读取配置后，在启动 Argus 时注入 `MTL_CODE_OPENMYTHOS_*` 环境变量。
- Argus CLI 根据运行时配置生成隐藏任务卡；Argus UI 确认自动派发后，会在 SDK/print 路径进入主模型循环前执行硬派发。
- `POST /api/settings/openmythos-dispatch-preview` 在聊天发送前使用后端同一套 OpenMythos 规则生成 `workerPlan`，确认后把该 plan 随 command options 传给 CLI。
- Agent 诊断面板展示 OpenMythos 开关、推理强度范围、自动派发策略、运行时卡片、专家路由、自动派发计划和上下文账本。
- `loopControl=enforced` 时，OpenMythos 的 `loopBudget` 会映射到现有 `maxTurns` 防护。
- `stableReinjection` 会把冻结目标、约束、验收标准、阶段、专家路由和上下文账本带入后续轮次和子代理上下文。
- `phaseAdapter` 会加入 `orient -> plan -> implement -> verify -> finalize` 指引；早期 `orient` 和 `plan` 阶段会阻止写入类工具。
- `expertRouting` 记录确定性的专家路线：安全、验证、性能、架构、前端、Git 或本地路线。
- `autoDispatchSubagents` 开启后，`medium/high/xhigh/max` 且 Coordinator 模式启用的任务会生成 worker 派发计划。
- Worker 回传的 `<task-notification>` 只进入主会话汇总阶段，不会再次生成 `workerPlan`，避免后台 worker 完成后触发循环派发。
- `contextCacheDiagnostics` 显示 compact、microcompact 和工具摘要账本；它不是 MLA 或 KV cache。

## 设置结构

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
    "autoDispatchSubagents": false,
    "autoDispatchMinEffort": "medium",
    "autoDispatchMaxWorkers": 3,
    "minEffort": "low",
    "maxEffort": "max"
  }
}
```

后端保存 Argus 模型配置时，会把这些值同步到 `settings.env`：

```json
{
  "MTL_CODE_OPENMYTHOS_RUNTIME": "0",
  "MTL_CODE_OPENMYTHOS_ADAPTIVE_EFFORT": "1",
  "MTL_CODE_OPENMYTHOS_TASK_CARD": "1",
  "MTL_CODE_OPENMYTHOS_ROUTING_HINTS": "1",
  "MTL_CODE_OPENMYTHOS_LOOP_CONTROL": "enforced",
  "MTL_CODE_OPENMYTHOS_STABLE_REINJECTION": "1",
  "MTL_CODE_OPENMYTHOS_PHASE_ADAPTER": "1",
  "MTL_CODE_OPENMYTHOS_EXPERT_ROUTING": "1",
  "MTL_CODE_OPENMYTHOS_CONTEXT_CACHE_DIAGNOSTICS": "1",
  "MTL_CODE_OPENMYTHOS_AUTO_DISPATCH": "0",
  "MTL_CODE_OPENMYTHOS_AUTO_DISPATCH_MIN_EFFORT": "medium",
  "MTL_CODE_OPENMYTHOS_AUTO_DISPATCH_MAX_WORKERS": "3",
  "MTL_CODE_OPENMYTHOS_MIN_EFFORT": "low",
  "MTL_CODE_OPENMYTHOS_MAX_EFFORT": "max"
}
```

支持的推理强度为 `low`、`medium`、`high`、`xhigh`、`max`。

## 自动派发规则

自动派发必须同时满足：

1. `enabled=true`。
2. `autoDispatchSubagents=true`。
3. Argus 以 Coordinator 模式启动，即 `MTL_CODE_COORDINATOR_MODE=1`。
4. 当前任务推断出的 effort 大于等于 `autoDispatchMinEffort`。
5. 当前任务命中专家路线，或命中实现类任务且需要 worker 兜底。

默认策略：

- `low`：不派发，保持单智能体本地处理。
- `medium/high/xhigh/max`：按专家路线生成 worker 任务。
- `autoDispatchMaxWorkers` 默认最多 3 个，最大可配置为 8。
- `<task-notification>`：永远不派发新 worker，只让 Coordinator 汇总现有 worker 结果或继续当前主线任务。

OpenMythos 先生成 `workerPlan`。在 Argus UI 中，发送前会弹出确认：确定则发送 `openMythosDispatchConfirmed=true` 和 `openMythosWorkerPlan`，后端注入 `MTL_CODE_OPENMYTHOS_DISPATCH_CONFIRMED=1` 与 `MTL_CODE_OPENMYTHOS_WORKER_PLAN`；取消、无计划或预览失败则发送 `openMythosAutoDispatch=false`，后端注入 `MTL_CODE_OPENMYTHOS_AUTO_DISPATCH=0`，本轮只用单 Agent。确认后，WorkerRuntime 在进入主模型循环前直接调用现有 `AgentTool.call()` 启动角色化 worker。同一个 runtime state 的派发只尝试一次；如果后续进入主模型循环，隐藏提醒会明确禁止重复启动同一批 worker。

## 运行行为

- `adaptiveEffort` 允许 Argus 在用户没有显式设置 effort 时，根据任务风险和复杂度推断推理强度。
- `taskCard` 控制是否附加隐藏的冻结任务卡。
- `routingHints` 控制隐藏任务卡是否包含 skill/subagent 路由建议。
- `loopControl` 可选 `enforced` 或 `advisory`；`enforced` 会把 `loopBudget` 映射到现有 `maxTurns` 防护。
- `stableReinjection` 会在工具结果后、子代理上下文中重新注入冻结目标、约束、验收标准、阶段、专家路由和上下文账本。
- `phaseAdapter` 根据轮次计算当前阶段；`orient` 和 `plan` 是只读阶段，`implement`、`verify`、`finalize` 可在合适时使用写入类工具。
- `expertRouting` 是确定性的专家路线检测面，不是隐藏的写入执行器。
- `autoDispatchSubagents` 把专家路线升级为 WorkerRuntime 可执行的 `workerPlan`。
- Argus UI 的自动派发是“先预览再确认”：设置页可以开启自动派发能力，但聊天本轮必须有用户确认才真正打开 worker 派发。
- `workerRuntimeAttempted` 是一次性状态开关，防止 SDK/print 路径在同一轮任务里重复派发。
- `minEffort` 和 `maxEffort` 限制自适应推理强度范围。
- 用户显式选择的 `/effort`、会话 effort 和已有环境变量仍优先于自适应结果。

## 诊断面板

`agent_runtime_debug` 会包含解析后的 OpenMythos 运行时块。前端诊断面板显示：

- 运行时是否启用。
- 自适应推理、冻结任务卡、路由提示状态。
- 最低和最高推理强度。
- 自动派发是否开启、最低派发强度、最大 worker 数。
- 循环控制模式。
- 稳定重注入、阶段适配器、专家路由、上下文缓存诊断开关。
- 运行时卡片：冻结目标、推理强度、风险分、循环预算、剩余预算、当前阶段、阶段计划。
- 专家路由、自动派发计划和上下文账本计数。
- Chat 输入框上方会在收到运行时诊断后显示一层 OpenMythos 状态提示：有 `workerPlan.assignments` 时显示将派发的 worker 数和摘要；没有派发计划时显示自动派发开启/关闭状态。
- 自动派发确认状态会进入 `agent_runtime_debug.openMythosRuntime.dispatchConfirmation`，用于区分“设置开启但本轮单 Agent”和“本轮确认派发”。
- 诊断按钮不再依赖 Agent 或 Skill 入口是否可见，只要后端返回 `agent_runtime_debug` 就允许打开。

## 实现边界

- OpenMythos 是策略层；Coordinator/Subagent 是执行层。
- 本轮新增 WorkerRuntime 执行层但不重写底层 AgentTool、async task、TaskOutput 和 notification 基础设施；SDK/print 路径会按确认后的 `workerPlan` 调用现有 `AgentTool.call()`。
- 自动派发使用现有 `Agent` 工具、现有 worker 生命周期和现有 `<task-notification>` 回传机制。
- 这不是 ACT halting；v1 在 `loopControl=enforced` 时使用现有 `maxTurns` 作为硬预算。
- 这不是 MLA/KV cache；v1 只暴露 compact、microcompact 和工具摘要周边的可恢复账本。
- 自动派发能力默认开启，但 Argus UI 发送前必须确认；未确认的任务不会自动启动 worker。

## 验证方式

Argus CLI 检查：

```powershell
cd C:\Users\Stan\Desktop\MTLCode\claude-code
bun test src/utils/__tests__/openmythosRuntime.test.ts
```

Argus UI 检查：

```powershell
cd C:\Users\Stan\Desktop\MTLCode\claudecodeui
npm run typecheck
npm run check:mojibake
```

手动 UI 检查：

1. 打开设置 > Model / Hub > 运行时。
2. 确认“自动分发子智能体”“最低派发强度”“最大 worker 数”能保存。
3. 新建 Argus 会话，发送简单“你好”，确认不会派发 worker。
4. 发送复杂重构或迁移验证任务，确认发送前出现 OpenMythos 派发确认。
5. 选择“取消”，确认本轮以单 Agent 执行，诊断面板显示 `dispatchConfirmation.mode=single-agent`。
6. 再次发送复杂任务并选择“确定”，确认 Coordinator 首轮启动 worker，worker 结果继续沿用现有 subagent 分组展示。
7. worker 完成后的 `<task-notification>` 不应再次触发新的 OpenMythos 派发计划，底部状态应在主会话汇总完成后结束。
