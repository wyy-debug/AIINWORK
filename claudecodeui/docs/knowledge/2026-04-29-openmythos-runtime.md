# OpenMythos 运行时控制

日期：2026-04-29

## 已实现内容

- MTL-Code UI 在智能体设置区提供 OpenMythos 运行时设置页。
- 运行时设置保存到 `~/.mtl-code/settings.json`，并同步到 Claude Code 启动环境。
- Claude Code 会读取运行时环境，用于构造隐藏任务卡、选择自适应推理强度，并附加路由提示。
- Agent 运行诊断会显示本会话解析后的 OpenMythos 配置、预览卡片、阶段计划、专家路由和上下文账本。
- 当 `loopControl` 为 `enforced` 时，`loopBudget` 会映射到现有 `maxTurns`。
- 稳定重注入会把冻结任务卡带入后续轮次和子代理上下文。
- 阶段适配器会加入 `orient -> plan -> implement -> verify -> finalize` 指引；早期 `orient` 和 `plan` 阶段会阻止写入类工具。
- 专家路由是确定性的保守建议：会提示安全、验证、性能、架构、前端、Git 或本地路线；v1 不会静默派发可写专家。
- 上下文缓存诊断是基于压缩边界、microcompact 边界、RAG 摘要和工具摘要的轻量账本，不是 MLA 或 KV cache。

## 设置结构

保存后的配置块形如：

```json
{
  "openMythosRuntime": {
    "enabled": true,
    "adaptiveEffort": true,
    "taskCard": true,
    "routingHints": true,
    "loopControl": "enforced",
    "stableReinjection": true,
    "phaseAdapter": true,
    "expertRouting": true,
    "contextCacheDiagnostics": true,
    "minEffort": "low",
    "maxEffort": "xhigh"
  }
}
```

后端保存 MTL-Code 模型设置时，会把这些值同步到 `settings.env`：

```json
{
  "MTL_CODE_OPENMYTHOS_RUNTIME": "1",
  "MTL_CODE_OPENMYTHOS_ADAPTIVE_EFFORT": "1",
  "MTL_CODE_OPENMYTHOS_TASK_CARD": "1",
  "MTL_CODE_OPENMYTHOS_ROUTING_HINTS": "1",
  "MTL_CODE_OPENMYTHOS_LOOP_CONTROL": "enforced",
  "MTL_CODE_OPENMYTHOS_STABLE_REINJECTION": "1",
  "MTL_CODE_OPENMYTHOS_PHASE_ADAPTER": "1",
  "MTL_CODE_OPENMYTHOS_EXPERT_ROUTING": "1",
  "MTL_CODE_OPENMYTHOS_CONTEXT_CACHE_DIAGNOSTICS": "1",
  "MTL_CODE_OPENMYTHOS_MIN_EFFORT": "low",
  "MTL_CODE_OPENMYTHOS_MAX_EFFORT": "xhigh"
}
```

支持的推理强度为 `low`、`medium`、`high`、`xhigh`。

## 运行行为

- `enabled` 控制是否启用 OpenMythos 运行时引导。
- `adaptiveEffort` 允许 Claude Code 在用户没有显式设置 effort 时，根据任务风险和复杂度推断推理强度。
- `taskCard` 控制是否附加隐藏的冻结任务卡。
- `routingHints` 控制隐藏任务卡是否包含 skill/subagent 路由建议。
- `loopControl` 可选 `enforced` 或 `advisory`。`enforced` 会把 `loopBudget` 映射到 Claude Code 现有的 `maxTurns` 防护。
- `stableReinjection` 会在工具结果后、子代理上下文中重新注入冻结目标、约束、验收标准、阶段、专家路由和上下文账本。
- `phaseAdapter` 根据轮次计算当前阶段。`orient` 和 `plan` 是只读阶段；`implement`、`verify`、`finalize` 可在合适时使用写入类工具。
- `expertRouting` 记录确定性的建议专家路线。它是路由提示和使用检测面，不是隐藏的自动写入执行器。
- `contextCacheDiagnostics` 在诊断中显示 compact、RAG、工具摘要账本。
- `minEffort` 和 `maxEffort` 会限制自适应推理强度的范围。
- 用户显式选择的 `/effort`、会话 effort 和已有环境变量仍优先于自适应结果。

## 诊断面板

`agent_runtime_debug` 会包含解析后的 OpenMythos 运行时块。前端诊断面板显示：

- 运行时是否启用。
- 自适应推理、冻结任务卡、路由提示状态。
- 最低和最高推理强度。
- 循环控制模式。
- 稳定重注入、阶段适配器、专家路由、上下文缓存诊断开关。
- 运行时卡片：冻结目标、推理强度、风险分、循环预算、剩余预算、当前阶段、阶段计划。
- 专家路由和上下文账本计数。

## 实现边界

- 这不是 ACT halting。v1 在 `loopControl=enforced` 时使用现有 `maxTurns` 作为硬预算。
- 这不是 MLA/KV cache。v1 只暴露 compact、microcompact、RAG 和工具摘要周围的可恢复摘要与账本计数。
- 专家路由不会自动启动可写子代理。模型会被强提示使用合适的 skill/subagent，诊断面板会让路由可见。
- 阶段强制是粗粒度的：早期阶段会阻止现有 `isReadOnly()` 返回 false 的工具。

## 验证方式

Claude Code 检查：

```powershell
cd E:\AIINWORK\claude-code
bun test src/utils/__tests__/openmythosRuntime.test.ts
bun run benchmark:openmythos
bun run typecheck
```

MTL-Code UI 检查：

```powershell
cd E:\AIINWORK\claudecodeui
npm run typecheck
npm run check:mojibake
npm run package:electron-win
```

手动 UI 检查：

1. 打开设置 > MTLCode > 运行时。
2. 确认运行时页面文案为中文。
3. 切换每个运行时模块并保存。
4. 新建 MTL-Code 会话，确认诊断面板显示相同的 OpenMythos 运行时设置。
