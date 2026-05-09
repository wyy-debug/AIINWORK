---
name: "crash-ai-daily-investigation"
description: "CrashSight 日巡检或时间段排查工作流：按时间段扫描 CrashSight，保留跨版本重复命中，提取 Redmine 标签，查询状态和负责人，写入 Obsidian，并支持单 Crash 深度分析交接。"
---

# CrashSight 日巡检排查

所有面向用户的输出必须使用中文。CrashSight 字段名、issueId、crashHash、appId、platformId、Redmine 单号、文件路径、命令名和工具名保持原文。

## 必需绑定

- MCP: `crash-ai-crashsight`
- MCP: `crash-ai-obsidian`
- MCP: `soc-redmine`
- Skill: `crashsight-single-crash-analysis`，仅在用户要求单个 Crash 深度分析，或输入 `issueId/crashHash + codeRoot` 时使用。

如果 `soc-redmine` 不可用，不要阻断 CrashSight 分析；报告中把 Redmine 相关字段标注为 `Redmine 未验证`。

## 输入

- `date`: 单日筛查，`YYYYMMDD` 或 `YYYY-MM-DD`。
- `startDate` / `endDate`: 日期段筛查，`YYYYMMDD` 或 `YYYY-MM-DD`。
- `startTime` / `endTime`: 精确时间段筛查，`YYYY-MM-DD HH:mm:ss`。用户给出半天、当前时间、从某时到某时这类范围时优先使用它。
- `platforms`: 可选，默认 `PC, Android, iOS`。
- `versionFilters` 或 `branches`: 可选，默认使用 MCP 配置的 `trunk/weekly`。
- `obsidianProjectName`: 可选，默认 `CrashAI`。
- `obsidianVaultId`: 可选，多 vault 时传入。
- `codeRoot`: 单 Crash 深度分析时的 SOC 源码根目录。
- `issueId` / `crashHash`: 可选；提供时生成单 Crash 深度分析报告。

## 日巡检流程

1. 调用 `crash-ai-crashsight.health_check`，检查 CrashSight 环境和 appId。
2. 调用 `crash-ai-obsidian.obsidian_test_connection`；失败时继续生成完整 Markdown，并在聊天窗口输出失败原因。
3. 调用 `scan_daily_crashes` 获取指定日期或时间段内的 Crash 列表。
   - 必须传 `date`，或 `startDate/endDate`，或 `startTime/endTime`。
   - 不要传 `rows=500` 当作报告上限；新版 MCP 会用 `pageSize` 自动分页，直到没有更多结果或触发分页安全限制。
   - 如果用户给了 `2026-05-08 12:00 ~ 2026-05-09 当前`，必须传 `startTime="2026-05-08 12:00:00"` 和实际 `endTime`，不要只传日期。
4. 使用 `scan_daily_crashes.items` 作为明细来源。跨 `trunk/weekly` 命中的同一个 issue 不去重，必须保留多行。
5. 对每个 Crash 调用 `compare_issue_versions`，判断新增、仍在发生、疑似已解决或无法确认。
6. 从 CrashSight 标签、标题、消息中提取 Redmine 单号；如果扫描结果已经给出 `redmineRefs` 和 `redmineLinks`，优先使用这些字段。
7. 对每个 Redmine 单号调用 `soc-redmine.get_issue`。
8. 程序负责人提取规则：
   - 优先看 Redmine `custom_fields` 中名字包含 `程序`、`开发`、`负责人`、`owner` 的字段。
   - 没有自定义字段时使用 `assigned_to.name`。
   - 都没有时写 `未指定`。
9. 生成完整 Markdown 报告。
10. 调用 `crash-ai-obsidian.obsidian_write_crash_report` 写入 Obsidian。

## 统计口径

- `CrashSight 返回 Issue 数`: 使用 `summary.totalIssues`，表示最终明细行数，不是去重后的独立 issue 数。
- `原始命中行数`: 可使用 `summary.rawIssueCount`，表示本地时间过滤后的命中行数。
- 不要输出 `跨版本重复`、`去重后`、`含跨版本过滤重复` 这类扣减字段。
- 如果需要提示重复，只能写 `潜在重复命中`，使用 `summary.potentialDuplicateIssueCount` 或 `summary.crossVersionDuplicateIssueCount`，并明确说明：`仅提示，不参与扣减，明细已保留全部命中行`。
- `被日期过滤掉的 Issue`: 使用 `summary.filteredOutByDate`，只表示 CrashSight 返回后被本地精确时间校验剔除的数量。
- `崩溃次数(总计)`: 使用 `totalCrashNum`。
- `影响设备(总计)`: 使用 `totalAffectedUsersOrDevices`，优先取 CrashSight 设备类字段；不要把它写成全局唯一设备数。
- `崩溃次数(本期)` 和 `影响设备(本期)` 不再出现在报告表格中。
- `应用版本`: 使用 MCP 返回的 `applicationVersion`；不要用 `versionFilter`、`trunk`、`weekly` 或 `matchedVersionFilters` 冒充应用版本。

## 日巡检报告结构

报告必须包含以下章节：

1. `# CrashAI 巡检报告 - <date 或 startTime 至 endTime>`
2. `## 巡检范围`
3. `## Crash 总览`
4. `## Crash 明细表`
5. `## Redmine 关联状态表`
6. `## 版本延续/解决判断`
7. `## 需程序排查清单`
8. `## 单 Crash 深度分析入口`
9. `## 未验证项/阻塞项`

Crash 明细表列必须严格使用：

```markdown
| ID | 平台 | CrashSight | 崩溃次数(总计) | 影响设备(总计) | 最早出现时间 | 最近出现时间 | 首次版本 | 应用版本 | 延续版本数 | 标签 | Redmine | Redmine状态 | 程序负责人 | 判断 | 下一步 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
```

字段格式必须遵守：

- `CrashSight`: 不要输出裸 issueId。必须写成 Markdown 链接，例如 `[CrashSight](https://crashsight.qq.com/crash-reporting/crashes/<appId>/<issueId>?pid=<platformId>)`。链接优先使用 MCP 返回的 `crashSightLink`。
- `Redmine`: 不要输出裸单号。必须写成 Markdown 链接，例如 `[#116204](http://soc-redmine.wd.com/issues/116204)`。多个 Redmine 用 `, ` 分隔。链接优先使用 MCP 返回的 `redmineLinks`。
- `崩溃次数(总计)`: 使用 `totalCrashNum`，不要用 `periodCrashNum`。
- `影响设备(总计)`: 使用 `totalAffectedUsersOrDevices`，不要用 `periodAffectedUsersOrDevices`。
- `应用版本`: 使用 `applicationVersion`。如果缺失，填 `CrashSight未提供`，并在阻塞项说明。
- 不再单独放 `issueId` 或 `CrashSight链接` 列；CrashSight 入口必须放在 `CrashSight` 链接列。

完整明细规则必须遵守：

- `Crash 明细表` 必须逐条展开 `scan_daily_crashes.items` 的每一条结果；返回多少条 crash，就输出多少条明细行。
- 禁止把多条 crash 合并成范围行或汇总行，例如禁止 `20-32`、`其余12条单次崩溃`、`1 each`、`部分有Redmine`、`样本不足，持续观察` 这类写法。
- 即使 crash 只有 1 次、1 台设备，也必须单独输出一行，并保留独立的 `CrashSight` 链接、标签、Redmine、版本判断和下一步。
- 如果同一个 issue 同时命中 `trunk` 和 `weekly`，两行都要保留。
- 如果明细太多，不允许聚合；应拆成多个连续表格，例如 `Crash 明细表（1-50）`、`Crash 明细表（51-100）`，但每条 crash 仍必须逐行列出。
- `Top 风险` 可以摘要排序，但不能替代完整明细表。
- 如果 `summary.possiblyTruncated=true` 或 `duplicatePageBreaks>0`，必须在阻塞项说明 CrashSight 分页可能未取全，不能用合并行掩盖缺失数据。

## 判断规则

- `仍在发生`: 当前应用版本或最后一个对比版本仍命中该 crash。
- `新增`: 历史版本未命中，当前应用版本命中，且首次出现时间在本次日期范围内。
- `疑似已解决`: 早期版本命中，当前应用版本未命中；必须写清“仍需观察后续上报”。
- `无法确认`: 版本历史不足、CrashSight 接口失败、versionFilters 不完整或 Redmine 状态冲突。

不要只根据 Redmine 已关闭判断 Crash 已解决；必须结合 CrashSight 版本对比。

## 单 Crash 深度分析流程

当用户提供 `issueId` 且提供 `codeRoot`，或者明确要求分析某个 Crash：

1. 调用 `get_single_crash_analysis_context`，获取完整堆栈、线程、关键日志/custom KV 和 CrashSight 链接。
2. 不获取 dump，不要求用户上传 dump。
3. 把 CrashSight 上下文和 `codeRoot` 交给 `crashsight-single-crash-analysis`。
4. 深度分析必须保持顺序：堆栈 -> SOC 源码 -> Git 引入提交 -> 黑盒复现方案。
5. 调用 `crash-ai-obsidian.obsidian_write_crash_report` 写入 Obsidian，`reportType=single`。

## Obsidian 写入规则

- 写入前先调用 `obsidian_test_connection`。
- 写入工具固定使用 `obsidian_write_crash_report`。
- Obsidian 写入使用直接写入模式，不走 wiki ingest。
- 写入成功后，聊天窗口必须展示 Obsidian 返回的 `path`、vault 或 result id。
- 写入失败时，聊天窗口必须展示完整 Markdown 报告，避免报告丢失。
- 不再使用 `outputPath` 写普通文件，除非用户明确要求导出本地副本。

## 阻塞项

必须列出：

- CrashSight MCP 未配置或接口失败。
- Redmine MCP 未配置或无权限。
- 标签无法提取 Redmine。
- CrashSight 未返回应用版本。
- CrashSight 累计崩溃次数或影响设备字段缺失。
- 版本历史不足，无法判断是否已解决。
- Obsidian Bridge 未启用、Argus 后端不可达、token 错误或写入失败。

## 输出约束

- 默认写入 Obsidian Markdown 笔记。
- 聊天窗口必须给出 Obsidian 写入路径或失败原因。
- 不写 Excel。
- 不写普通本地 Markdown 文件，除非用户明确要求。
- 不读取或打印 CrashSight/Redmine token、`.env`、本地 MCP 配置或用户设置文件。
- 不自动修改 CrashSight、Redmine 或任何外部单据状态。
