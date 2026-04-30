# Agent Template And Skill Repository

Date: 2026-04-27

## Goal

MTL-Code UI now has a repository surface for sharing prompt-based agent templates and Skills:

- Agent templates are prompt/system-instruction markdown files that install into MTL-Code custom agents.
- Skills can be a single `SKILL.md` or a complete Skill package directory containing `SKILL.md`, `agents/`, `references/`, `scripts/`, and other supporting files.
- Repository items can be uploaded into the local writable repository, pulled into user/project scope, and liked.
- External remote repositories are supported through an HTTP(S) `catalog.json` URL.

## Backend Ownership

Route: `server/routes/agent-repository.js`

Mounted at:

- `GET /api/agent-repository/catalog`
- `GET /api/agent-repository/sources`
- `POST /api/agent-repository/sources`
- `PUT /api/agent-repository/sources/:repoId`
- `DELETE /api/agent-repository/sources/:repoId`
- `GET /api/agent-repository/local/catalog`
- `GET /api/agent-repository/local/content?path=...`
- `POST /api/agent-repository/local/init`
- `POST /api/agent-repository/upload`
- `POST /api/agent-repository/items/:repoId/:itemId/like`
- `POST /api/agent-repository/install`

Local writable repository storage:

- `~/.mtl-code-ui/agent-repository/local/catalog.json`
- `~/.mtl-code-ui/agent-repository/local/agents/<name>/<name>.md`
- `~/.mtl-code-ui/agent-repository/local/skills/<name>/SKILL.md`
- `~/.mtl-code-ui/agent-repository/local/skills/<name>/**` for package-style Skills
- `~/.mtl-code-ui/agent-repository/sources.json`
- `~/.mtl-code-ui/agent-repository/likes.json`

## Catalog Contract

The normalized catalog shape is:

```json
{
  "schemaVersion": 1,
  "name": "Team Agent Repository",
  "description": "Shared prompt templates and skills.",
  "updatedAt": "2026-04-27T00:00:00.000Z",
  "items": [
    {
      "id": "frontend-reviewer",
      "kind": "agent-template",
      "name": "frontend-reviewer",
      "title": "Frontend Reviewer",
      "description": "Review React UI changes.",
      "author": "Team",
      "tags": ["react", "review"],
      "icon": "bot",
      "supportedApps": [
        { "id": "slack", "label": "Slack" },
        { "id": "notion", "label": "Notion" }
      ],
      "appSlots": [
        {
          "id": "chat",
          "label": "Chat",
          "placeholder": "Add application",
          "options": [{ "id": "slack", "label": "Slack" }]
        }
      ],
      "capabilities": ["Summarize work", "Draft review notes"],
      "version": "1.0.0",
      "likes": 0,
      "downloads": 0,
      "contentUrl": "./agents/frontend-reviewer/frontend-reviewer.md"
    },
    {
      "id": "rag-writer",
      "kind": "skill",
      "name": "rag-writer",
      "title": "RAG Writer",
      "description": "Write repository knowledge notes.",
      "contentUrl": "./skills/rag-writer/SKILL.md",
      "packageFiles": [
        {
          "path": "SKILL.md",
          "contentUrl": "./skills/rag-writer/SKILL.md"
        },
        {
          "path": "scripts/build-index.js",
          "contentUrl": "./skills/rag-writer/scripts/build-index.js"
        }
      ]
    }
  ]
}
```

Compatibility aliases:

- `kind: "agent"`, `"template"`, or `"agent-template"` normalize to `agent-template`.
- `items`, `agents`, `templates`, and `skills` arrays are accepted.
- `content` can be inline, but `contentUrl` is preferred for remote catalogs.
- Skill packages can add `packageFiles`. Each entry uses a package-relative `path` and a `contentUrl`. `SKILL.md` must exist at the package root.
- `likeUrl` is optional. If present for a remote item, the UI backend POSTs `{ itemId, kind, liked }` to it. If missing, likes are stored as a local overlay.
- Agent templates can define ChatGPT-style setup metadata:
  - `icon`: short display marker
  - `supportedApps`: array of app labels or `{ id, label, icon, category }`
  - `appSlots`: setup rows such as calendar/chat/email/knowledge/project tracker, each with `options`
  - `capabilities`: short bullet list shown in the template detail pane
- If a template has `supportedApps` but no `appSlots`, the UI derives default slots for calendar, chat, email, knowledge base, and project tracker.

## Install Contract

User-scope installs:

- Agent templates: `~/.mtl-code/agents/<name>.md`
- Skills: `~/.mtl-code/skills/<name>/SKILL.md`, or the full package under `~/.mtl-code/skills/<name>/`

Project-scope installs:

- Agent templates: `<project>/.claude/agents/<name>.md`
- Skills: `<project>/.claude/skills/<name>/SKILL.md`, or the full package under `<project>/.claude/skills/<name>/`

This matches the MTL-Code backend discovery rules:

- User config home is `MTL_CODE_CONFIG_DIR`, then `CLAUDE_CONFIG_DIR`, then `~/.mtl-code`.
- Project scope uses `.claude/agents` and `.claude/skills`.

## Frontend Ownership

Repository UI lives in:

- `src/components/settings/view/tabs/agents-settings/sections/content/RepositoryContent.tsx`

The Agent settings tabs now include:

- Model
- Permissions
- MCP
- Repository

The repository view supports:

- syncing enabled repositories
- adding HTTP(S) catalog URLs
- enabling/disabling/removing remote sources
- standalone Agent/Skill Hub catalog URL guidance
- ChatGPT-style agent template gallery with detail pane, supported app chips, capabilities, and setup dialog
- filtering agent templates vs skills
- liking/unliking items
- installing to user or project scope
- uploading agent prompt templates, single-file Skill markdown, or complete Skill package folders into the local writable repository

Shared upload/review/publish flows now belong to the standalone `agent-skill-hub` project. The desktop UI should not mount a public repository server; it consumes Hub catalogs as remote sources.

The Repository UI must not prefill a localhost Hub catalog URL. Hub URLs are user/team configuration, not built-in defaults. Localhost examples belong in docs and Hub README only.

When installing an Agent template, the UI can send:

```json
{
  "configuration": {
    "appBindings": {
      "calendar": "Google Calendar",
      "chat": "Slack"
    }
  }
}
```

The backend appends a `Configured applications` section to the installed Agent markdown. This records the selected applications as prompt context. It does not pretend to create OAuth or MCP connections; actual tools still depend on configured MCP servers/connectors.

When the guided setup installs an Agent template, the frontend also creates or updates a runtime Agent config through `/api/agents`. The runtime config uses the installed markdown content as `systemPrompt`, applies the selected app bindings, enables the Agent, and preserves template metadata such as capabilities and repository ID.

Skill installs preserve the package directory when `packageFiles` is present. They still do not create runtime Agent configs by themselves.

## Conversation Runtime Update

Date: 2026-04-28

- Project chat remains default MTL-Code for Agent selection. The composer does not expose Agent runtime controls in project mode, but it can expose installed Skills as prompt-time additions.
- Standalone conversations can bind an Agent and one or more installed Skills. The binding is persisted per conversation session and reloaded through `/api/sessions/:sessionId/agent`.
- When an Agent requires an application slot that matches MCP/tool usage, the setup dialog lists real configured MCP servers from the provider MCP API. The saved slot value is `MCP: <serverName>`.
- Generic placeholders such as `Custom MCP` or `自定义 MCP` are treated as setup prompts, not callable runtime bindings.
- The chat composer shows active runtime bindings for standalone conversations: Agent, MCP bindings, and Skills. Skills are marked callable only when discovered in the installed Skill registry.
- The server emits an `agent_runtime_debug` status event and a matching console log with `agentId`, `appBindings`, `mcpBindings`, `sessionSkills`, `effectiveSkills`, `appendSystemPromptLength`, model, context window, project path, session id, and a permission snapshot.
- The diagnostics payload also includes `modelProfileId`, Skill path/callable details, MCP binding summaries, RAG excerpt count, and RAG prompt length. Secret values are never included.
- The frontend does not render `agent_runtime_debug` as a chat message. It updates the composer diagnostics panel only.
- Missing Skills do not block sending. The UI marks them unavailable, and the backend prompt says they are not installed and must not be relied on.

## 功能状态表

| 功能 | 状态 | 说明 |
| --- | --- | --- |
| 项目会话默认 MTL-Code | 已实现 | 项目聊天不加载 Agent 选择；可在 composer 直接添加 Skill，并以空 Agent 绑定持久化到当前会话。 |
| 独立对话绑定 Agent | 已实现 | 新建独立对话时选择是否启用 Agent，绑定保存到 `/api/sessions/:sessionId/agent`。 |
| 对话绑定 Skill | 已实现 | Composer 读取真实已安装 Skill，项目会话和独立对话都支持选择、持久化、chip 解绑和缺失提示。 |
| Worktree 派发 | 已实现 | Git 项目会话可派生 managed detached worktree，作为独立项目进入并继承源会话的 Agent/Skill/MCP/模型绑定关系。 |
| Agent 运行诊断 | 已实现 | Composer 诊断面板显示最近一次后端收到的 Agent / Skill / MCP / 权限快照。 |
| MCP 绑定 | 部分实现 | 只绑定真实 `MCP: <serverName>` 配置；工具枚举由 MTL-Code runtime 启动会话后发现。 |
| Agent RAG | 部分实现 | 上传文件会进入本地轻量索引，运行时按当前问题注入 top excerpts；还不是正式向量库。 |
| Hub 远端仓库 | 已实现 | 独立 `agent-skill-hub` 服务提供 catalog、上传、审核、发布、点赞。 |
| Hub portable exe | 已实现 | 产物固定为 `agent-skill-hub/dist/agent-skill-hub.exe`，默认监听 `0.0.0.0`。 |
| 第三方渠道 | 隐藏 | 钉钉、Slack、Webhook 等渠道只保留配置语义，runtime 暂不启用。 |
| 未实现第三方应用 | 隐藏 | Google、Notion、Teams、SharePoint、Outlook 等无 runtime 的应用不在 Agent Builder 中展示。 |

## 操作手册

配置 MCP：

1. 打开 Agent Builder，进入“浏览应用 > 自定义 MCP”。
2. 新增或更新 MCP Server，选择 user 或 project 作用域。
3. stdio 填启动命令和参数；HTTP/SSE 填 URL 和 headers。
4. 保存后点击“测试”。测试只验证配置、命令或 URL；工具列表由 MTL-Code runtime 在会话启动后发现。
5. 点击“绑定”把该 Server 写入 Agent `appBindings`，格式为 `MCP: <serverName>`。

创建 Agent：

1. 在主界面进入 Agent Builder。
2. 新建或编辑 Agent，填写名称、说明、系统提示词、Skill、MCP app bindings、RAG 资料和 guardrails。
3. 模型和上下文优先读取 MTL-Code 设置；Agent 自身只在需要时保存明确覆盖值。

选择 Agent 对话：

1. 切换到“对话”空间，新建独立对话。
2. 空白对话会询问是否使用 Agent。
3. 选择 Agent 后，如果有槽位，先完成 MCP/应用槽位配置。
4. 发送首条消息后，Composer 的“诊断”按钮可查看本次实际传入后端的 Agent、Skill、MCP 和权限快照。

绑定 Skill：

1. 在项目会话或独立对话 Composer 底部打开 Skill 下拉。
2. 已安装 Skill 显示“已可调用”；选中后显示“已绑定”。
3. 点击已绑定 Skill chip 可解绑。
4. 如果会话记录里保留了缺失 Skill，它显示“不可用”，但不阻止发送；后端会提示模型不要依赖它。
5. 项目会话只保存 Skill，不启用 Agent 选择；独立对话可同时保存 Agent、MCP 和 Skill。

派生 Worktree：

1. 在 Git 项目中展开目标会话，并从会话右侧点击“派生到新工作树”。
2. 确认任务说明和 base ref。
3. 创建后生成 `~/.mtl-code/worktrees` 下的 detached worktree，并注册为独立项目。
4. 进入 worktree 后会继续使用源会话上下文，以及源会话已经保存的 Agent/Skill/MCP/模型绑定。
5. Worktree 头部可以手动创建分支；删除 managed worktree 前会检查 dirty 状态，有改动时阻止删除。

上传或安装 Skill：

1. 在 Settings > Agents > Repository 上传 `SKILL.md` 或完整 Skill 文件夹。
2. 完整包必须在根目录包含 `SKILL.md`，`agents/`、`references/`、`scripts/` 等子目录会保留。
3. 从远端 catalog 安装后，已安装项显示更新/卸载，不再显示“安装”。

启动 Hub：

1. 进入 `agent-skill-hub`。
2. 设置 `$env:HUB_ADMIN_TOKEN="change-me"`，必要时设置 `PORT`、`HOST`、`HUB_DATA_DIR`。
3. 开发运行用 `npm start`，portable 运行用 `dist\agent-skill-hub.exe`。
4. Catalog URL 示例：`http://<host>:4877/agent-repository/catalog.json`。
5. 局域网访问需要 Windows Firewall 放行端口。

## Safety Rules

- External repositories are read via HTTP(S) catalog URL only.
- Remote response text is capped at 2 MB.
- Skill package installs fetch package files individually and cap the aggregate package size at 20 MB.
- Local repository content paths are normalized and must stay inside `~/.mtl-code-ui/agent-repository/local`.
- Installed filenames are slugified before writing.
- Existing installed files are not overwritten unless the UI sends `overwrite: true`.
