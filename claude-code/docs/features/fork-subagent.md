# Fork Context Subagents

Argus 当前不再使用旧的 `FORK_SUBAGENT` 自动路由说明作为产品协议。上下文继承通过 Codex 风格 `spawn_agent` 的 `fork_context` 参数表达。

## 用法

```json
{
  "message": "Investigate the failing auth tests.",
  "agent_type": "explorer",
  "fork_context": true
}
```

`fork_context: true` 表示 child thread 可以继承父线程上下文。未显式设置时，child thread 以独立任务输入启动。

## 限制

- 只有用户明确授权 subagents、delegation 或 parallel work 时才能 spawn。
- 默认禁止嵌套 child threads。
- 旧 transcript 里的 fork/subagent 文本只做只读降级展示。

## 与 OpenMythos 的关系

OpenMythos 只给出拆分建议，不会因为任务复杂就自动设置 `fork_context`，也不会自动创建 worker。
