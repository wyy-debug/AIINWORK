# Argus 使用文档

This guide is for everyday Argus usage: projects, standalone conversations, models, Agent, Skill, MCP, Hub, Worktree, permissions, context compaction, and Argus Brain Runtime.

## 1. 基本概念

- 项目：绑定一个本地工作目录，适合读写代码、运行命令、查看 Git diff。
- 独立对话：不绑定项目目录，适合问答、规划、资料整理、Agent 工作流。
- Agent：一组角色、提示词、Skill、MCP 绑定和模型上下文配置。
- Skill：本地 `SKILL.md` 指令包，通常安装在 `~/.codex/skills` 或 `~/.mtl-code/skills`。
- MCP：外部工具服务器，运行时由 Argus / Claude Code 发现工具。
- Hub：独立的 Agent/Skill/MCP 远端仓库服务，Code UI 只消费 catalog 和调用 Hub API。
- Worktree：从 Git 项目中的某条会话派生出的独立工作树，默认 detached HEAD，主项目保持干净。

## 2. 模型配置

路径：`设置 > 智能体 > Argus > Model`

可以配置多个模型 Profile，每个 Profile 包含：

- 名称
- Base URL
- Model
- API Key / Auth Token
- Context window tokens
- 是否使用轻量启动

注意：

1. 模型 Profile 在设置页管理。
2. 对话和项目都可以在 composer 切换模型。
3. 模型按 session 绑定，A 对话可以用 MiMo，B 对话可以用 DeepSeek。
4. 对已有上下文的会话切换模型时，可能影响后续回复连续性，UI 会提示。
5. DeepSeek 1M 上下文需要显式配置 `1000000`，不要只在 Agent GUI 中改显示值。
6. MiMo 使用 Anthropic-compatible API 时，Model 必须写服务端实际支持的模型 id。

## 3. 项目会话

项目会话用于真实代码工作。

使用方式：

1. 在左侧选择 `项目`。
2. 点击文件夹图标新建项目，选择本地目录。
3. 在项目下新建会话。
4. 输入任务，必要时绑定 Skill 或切换模型。

注意：

1. 项目普通会话默认使用 Argus，不强制显示 Agent 配置。
2. 项目中可以直接添加 Skill，用于后续对话。
3. 项目和独立对话是两个空间，不应混用会话列表。
4. 需要 Agent 参与代码任务时，先在项目会话中保存 Agent/Skill/MCP/模型绑定，再从该会话派生 Worktree。

## 4. 独立对话

独立对话适合非项目绑定任务。

使用方式：

1. 切到左侧 `对话`。
2. 新建对话。
3. 根据提示选择是否使用 Agent。
4. 可以绑定 Skill、MCP、模型 Profile。

注意：

1. 独立对话默认没有项目路径。
2. 需要访问项目文件时，建议回到项目会话或 Worktree。
3. 选择 Agent 后必须保存到当前 session，诊断面板可确认 `agentId`、`effectiveSkills`、`mcpBindings`。

## 4.1 会话右键菜单

项目会话和独立对话都支持右键菜单。

常用动作：

1. `重命名对话`：保存一个自定义会话名。
2. `置顶对话` / `归档对话`：调整会话列表状态。
3. `标记为未读`：保存未读标记，侧边栏显示蓝点。
4. `复制会话 ID` / `复制深度链接`：用于排查或分享定位。
5. `在迷你窗口中打开`：用单独小窗口打开当前会话。

项目会话额外支持：

1. `在资源管理器中打开`：打开当前项目工作目录。
2. `复制工作目录`：复制当前项目路径。
3. `派生到本地`：回到原项目目录继续这条会话，不创建新 worktree。
4. `派生到新工作树`：从这条会话创建 detached worktree，并继承会话上下文和绑定配置。

## 5. Skill

Skill 是 Argus 追加给模型的本地能力说明，核心入口是 `SKILL.md`。

使用方式：

1. 在 composer 点击 `添加 Skill`。
2. 搜索真实已安装 Skill 或远端 Hub Skill。
3. 点击安装或绑定。
4. 已绑定 Skill 会显示为 chip，可点击解绑。
5. 发送消息后可在诊断面板查看本次传给后端的 Skill、`SKILL.md` 路径、是否存在、注入长度。

注意：

1. 缺失 Skill 不阻止发送，但 UI 会标记不可用，后端 prompt 会提示不要依赖它。
2. Hub 安装后不应继续显示“安装”，已安装内容只显示更新或卸载。
3. Skill 调用仍通过 prompt + 本地 `SKILL.md` 路径约束完成，没有单独 Skill 执行引擎。

## 6. Agent

Agent 类似 ChatGPT 自定义智能体：角色、提示词、应用槽位、Skill、MCP、模型配置的组合。

使用方式：

1. 打开 Agent Builder。
2. 从模板创建或新建 Agent。
3. 配置指令、Skill、MCP 槽位、模型与上下文。
4. 独立对话中选择 Agent；项目代码任务建议通过会话派生 Worktree 继承已保存的 Agent/Skill/MCP 绑定。
5. 首条消息后打开诊断面板，确认 Agent/Skill/MCP/model/context window 是否实际传到后端。

注意：

1. 项目普通会话默认不显示 Agent 配置，避免项目空间和 Agent 对话空间混用。
2. Agent 中绑定 MCP 只代表想使用该 MCP；真正工具由 runtime 启动后发现。
3. 如果 Agent 依赖 MCP token/root，安装后需要执行可用性检测。

## 7. MCP

MCP Server 用于扩展工具能力，例如 Redmine、代码搜索、本地服务等。

使用方式：

1. 在 `设置 > 智能体 > Argus > MCP 服务器` 配置 MCP。
2. 从 Hub 安装 MCP 时按 manifest 填写 required setup fields，例如 token、root。
3. 安装后点击 `检测可用性`。
4. 在 Agent 槽位中选择真实 `MCP: <serverName>`。

注意：

1. 密钥只显示是否 configured，不在 UI、日志、诊断中明文展示。
2. `root` 通常是 MCP 默认工作目录或默认代码根；如果工具调用时显式传了 `codeRoot`，以调用参数为准。
3. 如果提示缺少 `REDMINE_API_KEY`，说明 runtime 启动 MCP 时没有拿到该环境变量或配置字段。
4. MCP 工具列表不伪造；没有 runtime tool-list API 时，只显示“配置已绑定，工具列表将在会话启动后由 Argus 发现”。

## 8. Agent / Skill / MCP Hub

Hub 是独立服务，不内嵌在 Code UI 中。

启动建议：

```json
{
  "host": "0.0.0.0",
  "port": 4877,
  "dataDir": "D:\\mtl-agent-skill-hub-data",
  "adminToken": "test1234",
  "submitToken": "",
  "name": "Agent/Skill Hub",
  "description": "Shared Agent templates and Skills.",
  "publicBasePath": "/agent-repository",
  "adminBasePath": "/api/admin"
}
```

在 Code UI 中使用：

1. 打开 `设置 > Repository`。
2. 添加 catalog URL，例如 `http://<host>:4877/agent-repository/catalog.json`。
3. 同步 Repository。
4. 搜索并安装 Agent、Skill 或 MCP。
5. 上传时必须选择远端 Hub，并填写正确 token。

注意：

1. 本地兼容 catalog 不作为团队 Hub 上传目标，UI 中不应显示 `Local Remote Repository` 上传入口。
2. 远端返回 401 时，优先检查请求使用的 Hub、`adminToken`、`submitToken`。
3. Hub 数据保存在 `dataDir`，如果 dataDir 变了，之前上传的内容看起来就会“消失”。
4. 局域网访问需要 `host=0.0.0.0`，并确认防火墙放行端口。

## 9. Worktree 派发

Worktree 用于从 Git 项目里的某条会话派生隔离任务。项目提供仓库根目录，源会话提供上下文、模型、Agent、Skill 和 MCP 绑定。

默认行为：

- 根目录：`~/.mtl-code/worktrees`
- 创建方式：`git worktree add --detach <worktreePath> <baseRef>`
- 默认 detached HEAD，不自动创建分支。
- 会话上下文、Agent、Skill、MCP 和模型绑定来自源 session，并保存在派生 session 与 worktree 元数据中。

使用方式：

1. 在 Git 项目中展开目标会话。
2. 在会话右侧点击 `派生到新工作树`。
3. 确认任务说明和 base ref。
4. 创建后进入新 worktree，并继续使用源会话的上下文和绑定配置。
5. 需要保留成果时，手动创建分支。

注意：

1. 非 Git 项目会话不能派生 Worktree。
2. 父项目 dirty 时仍基于 HEAD 派发，不复制未提交改动。
3. 删除 managed worktree 前会检查 dirty；有改动会阻止删除。
4. v1 不自动 merge、不自动 PR、不自动 handoff。
5. 项目侧边栏的 `工作树任务` 是管理列表，不是创建入口。

## 10. 权限

权限设置在项目和独立对话中统一生效。

注意：

1. `skip permissions` 等价于高风险 bypass，只建议在可信项目和可信命令下使用。
2. `disallowedTools` 优先级高于 `allowedTools`。
3. 当前正在运行的请求可能不会立刻读取刚保存的权限，下一轮更稳定。
4. 如果仍然弹权限，查看诊断面板里的 permissionMode、skipPermissions、allowedTools、disallowedTools 和冲突提示。
5. MCP 或子进程工具可能需要单独规则匹配。

## 11. Context Compaction

Argus 当前有三类上下文能力：

1. 项目上下文：runtime 通过文件、Git、Shell、工具读取当前项目。
2. Agent knowledge/RAG: removed from the current product runtime; no upload, indexing, retrieval, or prompt injection.
3. 对话压缩：runtime 自动或手动 `/compact` 压缩长历史。

注意：

1. Claude Code / Argus does not expose a GUI-configurable traditional RAG knowledge base.
2. Argus no longer provides the Agent knowledge/RAG layer in the product runtime.
3. Normal code reading does not require a knowledge base.
4. 压缩摘要可能丢失细节，复杂任务压缩后建议先让 Agent 复述当前状态。

## 12. Argus Brain Runtime

Argus Brain is the current long-task working-memory layer. It captures local task events, compacts them into a short Mermaid task canvas, recalls the current goal, decisions, risks, and next action, and shows evidence refs in diagnostics.

Boundaries:

- Claude native memory handles user preferences and ordinary remember or forget requests.
- Obsidian is a Wiki and knowledge base. It is used for historical readback and explicit save-to-Wiki actions.
- Argus Brain handles task state only. It does not write Obsidian and does not override Claude native memory storage.
- Context diagnostics show which source injected Wiki, CodeGraph, or Brain context and how many tokens each source contributed.

For troubleshooting and migration, see [2026-05-19-brain-obsidian-context-guide.md](2026-05-19-brain-obsidian-context-guide.md).

OpenMythos Runtime has been removed from the active product surface. Historical notes remain only for migration context.

## 13. 常用命令

在输入框输入 `/` 可以查看内置命令。

- `/help`：查看帮助。
- `/clear`：清空当前会话上下文。
- `/model`：查看或切换模型。
- `/cost`：查看 token 和成本信息。
- `/memory`：查看记忆相关能力。
- `/compact`：手动压缩长对话。

## 14. 推荐工作流

普通代码修改：

1. 进入项目。
2. 新建项目会话。
3. 必要时绑定 Skill。
4. 描述任务。
5. 查看 diff、运行测试、继续修正。

复杂专题任务：

1. 安装或选择对应 Skill。
2. 需要专门角色时，新建独立对话并选择 Agent。
3. 需要动代码时，回到项目会话或从项目会话派生 Worktree。

隔离开发：

1. 从 Git 项目中的目标会话派生 Worktree。
2. 选择 Agent / Skill / 模型。
3. 在 worktree 中完成修改。
4. 需要保留时创建分支。
5. 回主项目手动合并或处理。

团队共享：

1. 启动 Agent/Skill Hub。
2. 团队成员添加 catalog URL。
3. 安装 Agent 模板、Skill 或 MCP。
4. 在对话或项目中绑定使用。
