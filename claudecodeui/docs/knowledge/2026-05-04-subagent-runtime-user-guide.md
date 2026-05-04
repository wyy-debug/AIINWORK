# Subagent Runtime 使用说明

## 当前行为

- 后台 Agent 是一等运行时任务，状态以 `taskId` 记录到 Subagent Manager，不再从聊天文本里反推。
- 同一条用户消息最多启动 3 个后台 Agent，最多 2 个同时运行；同一会话最多 3 个运行中任务。
- 同目标的运行中任务会被去重；后台 Agent 内默认不能再启动新的后台 Agent。
- 单个后台 Agent 默认最多 15 turns。重复读同一文件、重复相同工具、重复访问同一 URL、连续空结果或认证失败会被熔断为 `BLOCKED`。

## 如何看状态

- 输入框上方会显示紧凑状态条：运行数量、当前目标、最近工具、耗时和步数。
- 点击状态条可展开后台 Agent 管理视图，查看运行中、完成、阻塞、取消和历史任务。
- 完成后的任务默认不占用并发；可以复制 evidence，也可以把目标重新填入输入框再派发。
- “停止”会停止所有运行中的后台 Agent；每条任务也可以单独停止。

## 如何取结果

- 模型应使用 `AgentWait` 等待任务，使用 `AgentResult` 获取结构化结果。
- 结构化结果包含 `STATUS / SUMMARY / EVIDENCE / NEXT_ACTION / CHANGES / BLOCKERS`。
- `AgentSendInput` 只用于补充明确的新指令，并且必须带 `DONE / BLOCKED / NEED_PARENT_INPUT` 停止条件。
- 禁止用“进度如何 / 等一下 / 结果呢”这类消息轮询后台 Agent。

## 阻塞时怎么办

- 如果状态是 `BLOCKED`，界面会显示阻塞原因和下一步，例如登录目标系统、配置 MCP token/root、提供导出的页面数据，或取消旧任务后重新派发。
- CrashSight 这类登录受限页面无法自动读取时，后台 Agent 应只提示一次需要登录或导出数据，不应反复启动新的抓取任务。

## 发布验收点

- 聊天正文不应出现 `agentId`、`internal ID`、`output_file`、`Async agent launched successfully` 或等待废话。
- 后台 Agent 完成后状态条应消失或进入管理历史。
- 历史会话优先使用 Subagent Manager 的 snapshot/event 状态；旧 `agent-*.jsonl` 仅作为旧会话兼容兜底。
