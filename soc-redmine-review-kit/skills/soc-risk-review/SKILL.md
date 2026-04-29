---
name: soc-risk-review
description: 根据 Redmine 单据上下文、diff 和语义影响范围评审 SOC 代码风险。Use when Codex must judge regression risk, implementation risk, missing guards, rendering or platform side effects, and testing gaps for SOC Unity/render-pipeline changes. 输出必须使用中文。
---

# SOC 风险评审

## 输出语言

除代码标识、文件路径、函数名、类名、revision、命令、API 字段名和必要的英文日志片段外，所有评审结论、风险描述、影响范围、建议和未验证项都必须使用中文输出。

## 工作流

在 `redmine-issue-intake` 已采集单据、changesets 和 diff 证据后使用此 Skill。

1. 阅读单据意图：标题、描述、自定义字段、分支、平台、模块。
2. 阅读每一份可用 patch，识别变更文件、函数、类、配置项和行为分支。
3. 优先使用 MCP `ainwork-code-search` 语义工具，并且每次调用都把用户提供的 `codeRoot` 作为 `root` 参数：
   - `doctor`
   - `gitnexus_analyze`
   - `semantic_context`
   - `semantic_impact`
4. 如果语义影响分析失败，按顺序回退：
   - 用 `search_code` 查找变更符号、调用点、import、feature flag、配置 key。
   - 用 `read_file` 阅读周边实现。
   - MCP 不可用时使用 shell `rg`/`git show`。
5. 只输出有证据支撑的风险。无法确认时标记为 `待验证`，不要写成确定问题。

## 评审重点

优先关注以下 SOC 风险类型：

- 渲染 pass 过滤、pass index 合法性、pass 名称/序号映射。
- DrawCall、renderer list、render queue、材质 pass 过滤行为。
- `null`、`-1`、越界值、空列表、sentinel 值。
- 平台差异：PC、移动端、主机、Editor/Runtime、Development/Release。
- 性能退化：逐帧分配、额外遍历、shader/pass 查询成本、缓存失效。
- 与既有内容兼容性：Terrain、GBuffer、DynamicStreaming、SSR、Opaque/Depth pass。
- 数据异常时的静默行为变化。
- 缺少单元测试、功能测试或回归覆盖。

## 风险输出

每条发现必须使用下列表格：

```markdown
| ID | 优先级 | 风险类型 | 风险描述 | 影响范围 | 证据 | 建议 |
| --- | --- | --- | --- | --- | --- | --- |
```

优先级规则：

- `P0`：崩溃、数据破坏、构建失败，或大范围生产阻塞。
- `P1`：高概率用户可见回归、渲染错误、大范围平台风险。
- `P2`：边界问题、局部 bug、需要验证的性能或兼容性风险。
- `P3`：可维护性、命名、小范围测试缺口、低置信度疑点。

证据至少包含以下之一：

- 文件路径 + 函数/类名
- revision + diff 摘要
- 语义调用方/被调用方影响
- 文本搜索到的调用点证据

如果 GitNexus 或语义 MCP 失败，不要声称已完成完整语义覆盖；必须在报告中写明“语义影响图未验证”并列出回退证据。
