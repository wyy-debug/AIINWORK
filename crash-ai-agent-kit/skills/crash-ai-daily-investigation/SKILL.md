---
name: "crash-ai-daily-investigation"
description: "CrashAI daily, date-range, and exact-time CrashSight investigation workflow. Use when an agent must call crash-ai-crashsight.generate_crash_ai_report to get a direct Markdown report plus same-response context, then generate a Chinese crash triage analysis without reading local tool-result files."
---

# CrashAI Daily Investigation

All user-visible output must be Chinese. Keep CrashSight field names, issueId, crashHash, appId, platformId, Redmine issue numbers, file paths, command names, and tool names unchanged.

## Core Principles

- For daily, date-range, and exact-time inspection, call only `crash-ai-crashsight.generate_crash_ai_report` to collect facts.
- Do not loop over `scan_daily_crashes`, `compare_issue_versions`, or `soc-redmine.get_issue`.
- The MCP returns a direct fact report, not the final complete analysis report. The Agent must generate judgement, next steps, version continuity assessment, engineering investigation queue, and unverified items/blockers from the same-response context.
- If the tool returns `errors`, still output the fact section and the analysis section; summarize those errors under `未验证项/阻塞项`.
- Legacy tools such as `scan_daily_crashes` and `compare_issue_versions` are compatibility tools only and are not part of the main workflow.
- Do not read or print CrashSight/Redmine tokens, `.env`, local MCP config, or user settings files.
- Do not use Python, PowerShell, Bash, Read, or any file operation to inspect saved tool-result JSON/Markdown files. Do not write a temporary `.md` file just to read the tool result back. Use `CRASH_AI_DIRECT_REPORT` and `CRASH_AI_AGENT_CONTEXT_JSON` directly from the current tool response text.

## Required Bindings

- MCP: `crash-ai-crashsight`
- Optional MCP: `soc-redmine`; Redmine lookup is already performed by the Rust core through env configuration.
- Skill: `crashsight-single-crash-analysis`, only when the user asks for single-crash deep analysis and provides `issueId/crashHash + codeRoot`.

## Input Mapping

Pass normalized user input directly to `generate_crash_ai_report`:

- `date`: single-day scan, `YYYYMMDD` or `YYYY-MM-DD`.
- `startDate` / `endDate`: date-range scan, `YYYYMMDD` or `YYYY-MM-DD`.
- `startTime` / `endTime`: exact time range, `YYYY-MM-DD HH:mm:ss`. Prefer this for partial-day ranges.
- `platforms`: optional, default `["PC", "Android", "iOS"]`.
- `versionFilters` or `branches`: optional, default from `CRASHSIGHT_BRANCH_FILTERS`, usually `trunk/weekly`.
- `includeRedmine`: default `true`.
- `topN`: optional, affects only the Agent-generated analysis sizing, not complete fact rows.
- `pageSize` / `maxPages`: pass only when the user explicitly asks to tune pagination or debug performance.

Do not pass `rows` as a report row limit; the MCP paginates internally.

## Daily / Range Workflow

1. Call `crash-ai-crashsight.generate_crash_ai_report`.
2. Read the tool response text directly:
   - `CRASH_AI_DIRECT_REPORT`: complete MCP fact Markdown.
   - `CRASH_AI_AGENT_CONTEXT_JSON`: compact same-response context JSON.
3. Use the context JSON:
   - `summary`: counts, pagination, filtering, duplicate hints.
   - `rows`: structured crash detail rows.
   - `redmine`: Redmine title, status, priority, owner, and error metadata.
   - `errors`: partial CrashSight/Redmine failures.
   - `timingMs`: total and stage timings.
4. Output the final report: direct fact report first, then Agent-generated analysis sections.
5. If `errors` is non-empty, do not paste raw error stacks into Redmine tables; summarize them under `未验证项/阻塞项`.

## Report Contract

The MCP fact Markdown contains only:

- `# CrashAI 巡检报告 - <time range>`
- `## 巡检范围`
- `## Crash 总览`
- `## Crash 明细表`
- `## Redmine 关联状态表`

The fact-section crash table schema is:

```markdown
| ID | 平台 | CrashSight | 崩溃次数(总计) | 影响设备(总计) | 最早出现时间 | 最近出现时间 | 首次版本 | 应用版本 | 延续版本数 | 标签 | Redmine | Redmine状态 | 程序负责人 |
```

The Agent must append:

```markdown
## AI 判断与下一步
| ID | 判断 | 下一步 |

## 版本延续/解决判断

## 需程序排查清单
| 优先级 | Crash链接 | 平台 | 描述 | 负责建议 |

## 未验证项/阻塞项
```

Rules:

- `CrashSight` must be a Markdown link such as `[CrashSight](https://crashsight.qq.com/crash-reporting/crashes/<appId>/<issueId>?pid=<platformId>)`.
- `Redmine` must be a Markdown link such as `[#116204](http://soc-redmine.wd.com/issues/116204)`; separate multiple links with `, `.
- `应用版本` must come from CrashSight application-version fields, not from `trunk`, `weekly`, or `versionFilter`.
- The fact table must stay complete. If the MCP returns 196 rows, output all 196 fact rows.
- The tool aggregates by `issueId + platform + application version`; keep separate application-version rows.
- Do not output range rows, grouped shortcut rows, or lazy rows such as `20-32`, `ID 61-196`, `remaining 12`, `其余 N 条`, `低频零散崩溃`, `每项 1-2 次`, `此处省略`, `控制篇幅`, `完整数据共`, `1 each`, or `some have Redmine`.
- The Redmine table must be `Redmine | 标题 | 状态 | 优先级 | 负责人`; do not add an `错误` column.
- Do not output a `单 Crash 深度分析入口` section in daily/range reports.
- `判断` and `下一步` must be generated from crash counts, affected devices, version continuity, Redmine status, tags, and errors. Do not copy blank/default MCP fields.
- Each engineering investigation row must trace to one context row. Do not collapse rows into `remaining N`.
- Use P0/P1/P2/P3 priority based on affected devices, total crashes, open/high-priority Redmine state, latest occurrence, and tool errors.

## Single Crash Deep Analysis

When the user explicitly asks to analyze one crash and provides `issueId` or `crashHash` plus `codeRoot`:

1. Call `crash-ai-crashsight.get_single_crash_analysis_context` to fetch full stacks, threads, key logs/custom KV, and the CrashSight link.
2. Do not fetch dumps and do not ask the user to upload a dump.
3. Pass the CrashSight context and `codeRoot` to `crashsight-single-crash-analysis`.
4. Preserve this order: stack -> SOC source -> Git-introducing commit -> black-box reproduction plan.

## Failure Handling

- If the Rust core is missing, show the tool error: `CrashAI Rust core missing; reinstall MCP package or check bin/win32-x64/crash-ai-core.exe`.
- If some CrashSight platforms fail, keep successful platforms and summarize failures under `未验证项/阻塞项`.
- If Redmine is not configured or fails, do not block the CrashSight report; mark Redmine fields as `Redmine 未验证` where applicable.
- Do not write Obsidian or local Markdown files by default; the main workflow outputs fact and analysis sections in chat only.
