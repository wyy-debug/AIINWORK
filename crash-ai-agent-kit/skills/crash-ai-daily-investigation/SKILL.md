---
name: "crash-ai-daily-investigation"
description: "Call crash-ai-crashsight.generate_crash_ai_report, then output only current filed issues and missing-unfiled issues grouped by platform."
---

# CrashAI Daily Investigation

All user-visible output must be Chinese. Keep CrashSight links, Redmine issue numbers, app versions, and platform names unchanged.

## Required Tool

- Call only `crash-ai-crashsight.generate_crash_ai_report` for daily, date-range, and exact-time inspection.
- Do not call `scan_daily_crashes`, `compare_issue_versions`, or `soc-redmine.get_issue`.
- Do not use Python, PowerShell, Bash, Read, or local file operations to inspect saved tool-result JSON/Markdown files.
- Use `CRASH_AI_AGENT_CONTEXT_JSON` directly from the current tool response.

## Input Mapping

Pass normalized user input directly to `generate_crash_ai_report`:

- `date`, or `startTime` / `endTime`.
- `platforms`.
- `versionFilters` or `branches`.
- `includeRedmine`, normally `true`.

Do not pass `topN`, `rows`, or `maxPages` as report limits unless the user explicitly asks to debug pagination.

## Only Output Format

The final answer must contain only these two sections:

```markdown
目前存在问题
android
1. <问题描述> #<Redmine单号>，修复人：<修复人或修复人未验证>，版本：<应用版本>，CrashSight：<CrashSight链接>

pc
1. <问题描述> #<Redmine单号>，修复人：<修复人或修复人未验证>，版本：<应用版本>，CrashSight：<CrashSight链接>

iOS
无

遗漏未开单问题：
android
1. <问题描述或异常名>，原因：未提取到 Redmine，版本：<应用版本>，CrashSight：<CrashSight链接>

pc
1. <问题描述或异常名>，原因：未提取到 Redmine，版本：<应用版本>，CrashSight：<CrashSight链接>

iOS
无
```

Do not output any other section, table, summary, status block, analysis block, or tool/debug detail.

## Classification Rules

- Any row with `redmineRefs` goes under `目前存在问题`.
- Any row without `redmineRefs` goes under `遗漏未开单问题：`.
- Group by platform using exactly these headings: `android`, `pc`, `iOS`.
- If a section/platform has no matching rows, write `无`.
- Every filed item must include:
  - Problem description.
  - Redmine number as `#116204` or similar.
  - `修复人：<owner>`; use `修复人未验证` if Redmine owner is unavailable.
  - `版本：<applicationVersion>`.
  - `CrashSight：<link>`.
- Every missing-unfiled item must include:
  - Problem description.
  - `原因：未提取到 Redmine`.
  - `版本：<applicationVersion>`.
  - `CrashSight：<link>`.
- Use tags, Redmine title, exception name, or CrashSight context to create the problem description. If no useful text exists, use `CrashSight 崩溃问题`.
- Do not collapse, omit, or summarize rows. Forbidden patterns: `其余 N 条`, `ID 61-196`, `低频零散崩溃`, `每项 1-2 次`, `此处省略`, `控制篇幅`, `完整数据共`.

## Safety

- Do not read or output CrashSight/Redmine tokens.
- Do not read `.env`, `.mcp.json`, or user settings files.
- Do not modify CrashSight or Redmine.
