---
name: redmine-issue-intake
description: 获取并规范化 SOC Redmine 单据上下文，用于代码评审。Use when reviewing a Redmine issue by issue id, especially when the workflow needs title, description, custom fields, journals, changesets, touched files, and revision diffs before risk analysis. 输入只需要 issueId 和 codeRoot，输出必须使用中文。
---

# Redmine 单据上下文采集

## 输出语言

除代码标识、文件路径、函数名、revision、命令和 API 字段名外，所有说明、摘要、风险判断、阻塞原因都必须使用中文输出。保留 Redmine 原始中文文本用于溯源，不要翻译或改写成英文。

## 输入

只要求以下两个输入：

- `issueId`
- `codeRoot`

不要要求 `outputPath`，不要写入报告文件。

## MCP 使用规则

必须通过调用已绑定的 MCP 工具获取 Redmine 数据：

- `soc-redmine.get_issue`
- `soc-redmine.get_issue_changesets`
- `soc-redmine.get_revision_diff`

禁止为了获取 Redmine token 或 MCP 配置而扫描本机文件。不要读取或搜索以下内容：

- `settings.json`
- `.mcp.json`
- `mcp.json`
- `.env`
- `project-config.json`
- `C:\Users\<user>\.mtl-code`
- `C:\Users\<user>\.claude`
- 任何可能包含 `REDMINE_API_KEY`、API key、token、secret 的文件

如果 `soc-redmine` MCP 工具不可见或调用失败，不要手写 JSON-RPC 启动 MCP server，也不要从磁盘寻找密钥。必须停止并用中文提示用户检查 MCP 是否已安装、启用并绑定到当前 Agent。

## 工作流

在任何 SOC Redmine 代码评审前使用此 Skill。

1. 从用户或调用 Agent 获取 `issueId`、`codeRoot`。
2. 直接调用 MCP `soc-redmine.get_issue`，参数为 `issueId`。
3. 直接调用 MCP `soc-redmine.get_issue_changesets`，参数为 `issueId`。
4. 对每个 changeset revision 直接调用 `soc-redmine.get_revision_diff`，参数为：
   - `root`: `codeRoot`
   - `revision`: changeset revision
   - `issueId`: 单据号
   - `repositoryId`: changeset 中存在仓库 id 时传入
   - `paths`: changeset 中存在文件路径时传入
5. 如果 `get_revision_diff` 失败，在报告上下文中保留失败原因和变更文件列表。不要伪造 patch。

## 规范化上下文

为后续评审构建紧凑的中文上下文对象：

- `issue.id`
- `issue.subject`
- `issue.description`
- `issue.project/tracker/status/priority`
- 关键自定义字段：
  - `提交分支`
  - `平台`
  - `所属模块`
  - `外放版本`
  - `复现概率`
  - `预计测试时间`
  - `回归范围`，如果出现在描述或 journals 中
- `journals[]`：只保留与需求、实现、回归范围、测试说明相关的摘要。
- `changesets[]`：
  - revision
  - branch
  - user
  - committed_on
  - comments
  - repository id/name
  - files path/action
- `diffs[]`：
  - revision
  - source: `local-git`、`redmine` 或 `unavailable`
  - diff 文本或失败原因

## 证据规则

- 将 Redmine 标题和描述视为需求意图，不视为实现证据。
- 将 `git show` patch 视为主要实现证据。
- 当完整 patch 不可用时，只将 Redmine changeset 文件列表作为降级证据。
- 不要在任何输出中暴露 `REDMINE_API_KEY`。
- 中文单据内容必须保留足够原文，便于追溯；长 journals 可以中文概括。
