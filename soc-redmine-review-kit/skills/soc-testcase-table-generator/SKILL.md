---
name: soc-testcase-table-generator
description: 根据 Redmine 评审风险生成 SOC 功能测试和单元测试 Markdown 表格。Use after reviewing a Redmine diff when the final deliverable must include Markdown tables with priority, steps, expected results, coverage mapping, and unresolved blockers. 只在聊天窗口输出完整中文报告，不写文件。
---

# SOC 测试用例表生成

## 输出语言

除代码标识、文件路径、函数名、类名、revision、命令和 API 字段名外，报告标题、章节、表头、测试场景、步骤、预期结果、备注、阻塞项都必须使用中文输出。

## 工作流

在 `soc-risk-review` 已生成风险发现后使用此 Skill。

1. 将每个 `P0/P1/P2` 风险至少转换为一条功能测试用例。
2. 当存在明确可测的函数、分支、guard 或 mock 点时，将代码级风险转换为单元测试用例。
3. 如果 diff 只修改渲染过滤、pass 选择或 sentinel 处理，必须包含正常数据和异常/边界数据用例。
4. 直接在当前聊天窗口输出完整 Markdown 报告。
5. 不要要求 `outputPath`，不要写入文件，不要调用写文件脚本。

## 输出要求

- 最终交付物是当前聊天窗口中的完整 Markdown 报告。
- 不能只输出文件路径、摘要、状态表或“已生成”。
- 不要调用任何写文件命令，也不要创建 `redmine-<issueId>-review.md`。

## 必须输出的报告结构

最终聊天报告必须包含以下中文章节：

1. `# Redmine <issueId> 评审报告`
2. `## 单据信息摘要`
3. `## Diff 摘要`
4. `## 语义影响范围`
5. `## Review 风险表`
6. `## 功能测试用例表`
7. `## 单元测试用例表`
8. `## 未验证项/阻塞项`

## 必须输出的表格

Review 风险表：

```markdown
| ID | 优先级 | 风险类型 | 风险描述 | 影响范围 | 证据 | 建议 |
| --- | --- | --- | --- | --- | --- | --- |
```

功能测试用例表：

```markdown
| 用例ID | 优先级 | 场景 | 前置条件 | 操作步骤 | 预期结果 | 覆盖风险 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- |
```

单元测试用例表：

```markdown
| 用例ID | 优先级 | 测试对象 | 输入/Mock | 断言 | 覆盖分支 | 关联风险 |
| --- | --- | --- | --- | --- | --- | --- |
```

## 质量要求

- 每条测试用例必须引用风险 ID 或 diff 证据。
- 优先级统一使用 `P0/P1/P2/P3`。
- 对变更过滤逻辑至少包含一条正向路径和一条异常/sentinel 路径。
- 不要生成无法落地的单元测试。如果看不到单元测试接入点，将该项写入 `未验证项/阻塞项`。
- 表格单元格保持简洁，不要在表格里写多段文字。
